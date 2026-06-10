import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Redis } from 'ioredis';
import { createApp } from '../src/http/app.js';
import { createIo } from '../src/realtime/io.js';
import { redisPub, redisSub } from '../src/lib/redis.js';
import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers/harness.js';
import { connectSocket, waitForEvent, type TestClientSocket } from './helpers/socket.js';

// Two Socket.IO servers sharing Mongo and Redis, joined by the redis
// adapter: the in-process equivalent of the two-instance nginx compose
// profile. A broadcast on instance A must reach sockets on instance B.

let ctx: TestContext; // instance A
let httpB: HttpServer;
let ioB: ReturnType<typeof createIo>;
let urlB: string;
let pubB: Redis;
let subB: Redis;

let alice: TestUser;
let bob: TestUser;
let aliceOnA: TestClientSocket;
let bobOnB: TestClientSocket;
let generalId: string;

beforeAll(async () => {
  ctx = await startTestServer();

  // Instance B with its own adapter subscriber pair.
  pubB = redisPub.duplicate();
  subB = redisSub.duplicate();
  await Promise.all([pubB.connect(), subB.connect()]);
  httpB = createServer(createApp());
  ioB = createIo(httpB, { redisClients: { pub: pubB, sub: subB } });
  await new Promise<void>((resolve) => httpB.listen(0, resolve));
  urlB = `http://127.0.0.1:${(httpB.address() as AddressInfo).port}`;

  alice = await registerUser(ctx, { username: 'alice_multi' });
  bob = await registerUser(ctx, { username: 'bob_multi' });

  const { default: request } = await import('supertest');
  const rooms = await request(ctx.app)
    .get('/rooms')
    .set('Authorization', `Bearer ${alice.accessToken}`);
  generalId = rooms.body.rooms.find((r: { slug: string }) => r.slug === 'general').id as string;

  aliceOnA = await connectSocket(ctx.url, alice.accessToken);
  bobOnB = await connectSocket(urlB, bob.accessToken);
});

afterAll(async () => {
  aliceOnA.disconnect();
  bobOnB.disconnect();
  await new Promise<void>((resolve, reject) => {
    ioB.close((err) => (err ? reject(err) : resolve()));
  });
  await Promise.all([pubB.quit(), subB.quit()]);
  await stopTestServer(ctx);
});

describe('two instances behind the redis adapter', () => {
  it('delivers messages from instance A to a socket on instance B', async () => {
    const bobReceives = waitForEvent(bobOnB, 'message:new');
    const ack = await aliceOnA.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'crossing instances',
    });
    expect(ack.ok).toBe(true);
    const received = await bobReceives;
    expect(received.body).toBe('crossing instances');
    expect(received.sender.id).toBe(alice.userId);
  });

  it('delivers messages from instance B back to instance A', async () => {
    const aliceReceives = waitForEvent(aliceOnA, 'message:new');
    const ack = await bobOnB.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'return trip',
    });
    expect(ack.ok).toBe(true);
    const received = await aliceReceives;
    expect(received.sender.id).toBe(bob.userId);
  });

  it('propagates presence across instances', async () => {
    const carol = await registerUser(ctx, { username: 'carol_multi' });
    const aliceSees = waitForEvent(
      aliceOnA,
      'presence:update',
      (e) => e.userId === carol.userId && e.online,
    );
    // carol connects to instance B; alice (on A) hears about it via the adapter.
    const carolSocket = await connectSocket(urlB, carol.accessToken);
    await aliceSees;
    const aliceSeesOffline = waitForEvent(
      aliceOnA,
      'presence:update',
      (e) => e.userId === carol.userId && !e.online,
    );
    carolSocket.disconnect();
    await aliceSeesOffline;
  });

  it('fans out typing indicators across instances, still excluding the sender', async () => {
    const bobSees = waitForEvent(bobOnB, 'typing:update', (e) => e.roomId === generalId);
    await aliceOnA.emitWithAck('typing:start', { roomId: generalId });
    const event = await bobSees;
    expect(event.userId).toBe(alice.userId);
    expect(event.isTyping).toBe(true);
  });
});
