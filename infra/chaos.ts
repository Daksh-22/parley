// Chaos run: two real server instances share Redis and Mongo through the
// redis adapter (the same topology as the compose scale profile, minus the
// nginx hop). Two socket clients hold a scripted conversation, instance A is
// SIGKILLed mid-conversation, the orphaned client reconnects to the survivor
// (standing in for the load balancer), resyncs, and the run asserts zero
// message loss. Method documented in docs/RESILIENCE.md.
//
// Run with: pnpm chaos
/* eslint-disable no-console -- operational script, stdout is the interface */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { io as ioClient, type Socket } from 'socket.io-client';

const PORT_A = 4101;
const PORT_B = 4102;
const MONGO_URI = 'mongodb://127.0.0.1:27017/parley-chaos';
const TOTAL_MESSAGES = 20;
const KILL_AFTER = 10;

const SECRETS = {
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
};

function spawnServer(port: number): ChildProcess {
  return spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../apps/server', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      MONGO_URI,
      REDIS_URL: 'redis://127.0.0.1:6379',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'error',
      AI_ENABLED: 'false',
      CONN_RATE_LIMIT: '100000',
      MSG_RATE_LIMIT: '100000',
      ...SECRETS,
    },
    stdio: 'ignore',
    detached: false,
  });
}

async function waitHealthy(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`server on :${port} never became healthy`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

interface ApiUser {
  accessToken: string;
  username: string;
}

async function register(port: number, username: string): Promise<ApiUser> {
  const res = await fetch(`http://127.0.0.1:${port}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'chaos-password-1', displayName: username }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, username };
}

function connect(port: number, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function send(socket: Socket, roomId: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.emit(
      'message:send',
      { roomId, clientMsgId: randomUUID(), body },
      (ack: { ok: boolean; data?: { message: { id: string } }; error?: { code: string } }) => {
        if (ack.ok && ack.data) resolve(ack.data.message.id);
        else reject(new Error(`send refused: ${ack.error?.code}`));
      },
    );
  });
}

async function main(): Promise<void> {
  console.log('chaos: starting two instances sharing redis and mongo');
  const started = Date.now();
  const serverA = spawnServer(PORT_A);
  const serverB = spawnServer(PORT_B);
  const cleanup = (): void => {
    serverA.kill('SIGKILL');
    serverB.kill('SIGKILL');
  };
  process.on('exit', cleanup);

  try {
    await Promise.all([waitHealthy(PORT_A), waitHealthy(PORT_B)]);
    console.log(`chaos: both healthy in ${Date.now() - started}ms`);

    const stamp = randomBytes(3).toString('hex');
    const alice = await register(PORT_A, `chaos_alice_${stamp}`);
    const bob = await register(PORT_A, `chaos_bob_${stamp}`);
    const roomsRes = await fetch(`http://127.0.0.1:${PORT_A}/rooms`, {
      headers: { Authorization: `Bearer ${alice.accessToken}` },
    });
    const rooms = (await roomsRes.json()) as { rooms: { id: string; slug: string }[] };
    const general = rooms.rooms.find((r) => r.slug === 'general');
    if (!general) throw new Error('no #general room');
    const roomId = general.id;

    // alice on instance A, bob on instance B: cross-instance from the start.
    let aliceSocket = await connect(PORT_A, alice.accessToken);
    const bobSocket = await connect(PORT_B, bob.accessToken);

    const aliceReceived = new Map<string, string>();
    const bobReceived = new Map<string, string>();
    const sentIds: string[] = [];
    const listen = (socket: Socket, sink: Map<string, string>): void => {
      socket.on('message:new', (m: { id: string; body: string }) => sink.set(m.id, m.body));
    };
    listen(aliceSocket, aliceReceived);
    listen(bobSocket, bobReceived);

    console.log(`chaos: conversation begins, killing instance A after message ${KILL_AFTER}`);
    let killedAt = 0;
    let resyncedAt = 0;

    for (let i = 1; i <= TOTAL_MESSAGES; i += 1) {
      // Alternate senders. After the kill, alice speaks through instance B.
      const fromAlice = i % 2 === 1;
      const socket = fromAlice ? aliceSocket : bobSocket;
      const id = await send(socket, roomId, `chaos message ${i}`);
      sentIds.push(id);
      const sender = fromAlice ? aliceReceived : bobReceived;
      sender.set(id, `chaos message ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 120));

      if (i === KILL_AFTER) {
        console.log('chaos: SIGKILL instance A');
        killedAt = Date.now();
        serverA.kill('SIGKILL');
        // The load balancer's job, played by this script: reconnect the
        // orphaned client to the survivor and resync from the last seen id.
        const lastSeen = [...aliceReceived.keys()].sort().at(-1);
        aliceSocket = await connect(PORT_B, alice.accessToken);
        listen(aliceSocket, aliceReceived);
        const sync = await new Promise<{
          ok: boolean;
          data?: { rooms: { messages: { id: string; body: string }[]; refetch: boolean }[] };
        }>((resolve) => {
          aliceSocket.emit(
            'sync:since',
            { cursors: [{ roomId, lastMessageId: lastSeen }] },
            resolve,
          );
        });
        if (sync.ok && sync.data) {
          for (const room of sync.data.rooms) {
            for (const message of room.messages) aliceReceived.set(message.id, message.body);
          }
        }
        resyncedAt = Date.now();
        console.log(`chaos: alice reconnected to B and resynced in ${resyncedAt - killedAt}ms`);
      }
    }

    // Let the last broadcasts land.
    await new Promise((resolve) => setTimeout(resolve, 800));

    const aliceMissing = sentIds.filter((id) => !aliceReceived.has(id));
    const bobMissing = sentIds.filter((id) => !bobReceived.has(id));
    const pass = aliceMissing.length === 0 && bobMissing.length === 0;

    console.log('');
    console.log('chaos report');
    console.log(`  messages sent          ${sentIds.length}`);
    console.log(
      `  alice received         ${sentIds.length - aliceMissing.length}/${sentIds.length}`,
    );
    console.log(`  bob received           ${sentIds.length - bobMissing.length}/${sentIds.length}`);
    console.log(`  kill to resync         ${resyncedAt - killedAt}ms`);
    console.log(`  total run              ${Date.now() - started}ms`);
    console.log(`  result                 ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) {
      if (aliceMissing.length > 0) console.log(`  alice missing: ${aliceMissing.join(', ')}`);
      if (bobMissing.length > 0) console.log(`  bob missing: ${bobMissing.join(', ')}`);
    }

    aliceSocket.disconnect();
    bobSocket.disconnect();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('chaos run errored:', err);
    process.exit(1);
  }
}

void main();
