import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers/harness.js';
import { connectSocket, waitForEvent, type TestClientSocket } from './helpers/socket.js';
import { startIngestWorker } from '../src/ai/ingest/queue.js';
import { getEmbedder } from '../src/ai/provider.js';
import { searchVectors } from '../src/ai/vector-store.js';

let ctx: TestContext;
let bob: TestUser;
let bobSocket: TestClientSocket;
let owner: TestUser;
let ownerSocket: TestClientSocket;

async function sendAndIngest(
  socket: TestClientSocket,
  roomId: string,
  body: string,
): Promise<string> {
  const ack = await socket.emitWithAck('message:send', {
    roomId,
    clientMsgId: randomUUID(),
    body,
  });
  if (!ack.ok) throw new Error('send failed');
  const messageId = ack.data.message.id;
  const [vector] = await getEmbedder().embed([body]);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const hits = await searchVectors(vector as number[], { roomIds: [roomId], limit: 10 });
    if (hits.some((h) => h.payload.messageId === messageId)) return messageId;
    if (Date.now() > deadline) throw new Error('never ingested');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function askGlobal(
  socket: TestClientSocket,
  question: string,
  bypassCache = false,
): Promise<{ answer: string; cached: boolean; citations: { roomId: string }[] }> {
  const done = waitForEvent(socket, 'ai:stream:done');
  const ack = await socket.emitWithAck('ai:ask', {
    scope: 'global',
    question,
    ...(bypassCache ? { bypassCache: true } : {}),
  });
  if (!ack.ok) throw new Error(`ask failed: ${ack.error.code}`);
  return done;
}

beforeAll(async () => {
  ctx = await startTestServer();
  startIngestWorker();
  owner = await registerUser(ctx, { username: 'owner_cache' });
  bob = await registerUser(ctx, { username: 'bob_cache' });
  ownerSocket = await connectSocket(ctx.url, owner.accessToken);
  bobSocket = await connectSocket(ctx.url, bob.accessToken);
});

afterAll(async () => {
  ownerSocket.disconnect();
  bobSocket.disconnect();
  await stopTestServer(ctx);
});

describe('semantic answer cache', () => {
  it('serves repeats from cache, honors regenerate, and misses on any membership change', async () => {
    // A room with a distinctive fact, bob is a member.
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'cache fact room' });
    const roomId = created.body.room.id as string;
    const join = await bobSocket.emitWithAck('room:join', { roomId });
    expect(join.ok).toBe(true);
    const factId = await sendAndIngest(
      ownerSocket,
      roomId,
      'the backup restore drill is scheduled for the first monday of july',
    );

    const question = 'when is the backup restore drill scheduled?';

    // First ask: fresh, cites the room.
    const first = await askGlobal(bobSocket, question);
    expect(first.cached).toBe(false);
    expect(first.citations.some((c) => c.roomId === roomId)).toBe(true);

    // Identical repeat: served from cache with identical content.
    const second = await askGlobal(bobSocket, question);
    expect(second.cached).toBe(true);
    expect(second.answer).toBe(first.answer);

    // Regenerate skips the cache.
    const regenerated = await askGlobal(bobSocket, question, true);
    expect(regenerated.cached).toBe(false);

    // The leak test: bob leaves the room. The fingerprint changes, so the
    // cached answer derived from that room is unreachable by construction,
    // and the fresh answer cannot cite the room either.
    await bobSocket.emitWithAck('room:leave', { roomId });
    const afterLeave = await askGlobal(bobSocket, question);
    expect(afterLeave.cached).toBe(false);
    expect(afterLeave.citations.every((c) => c.roomId !== roomId)).toBe(true);
    expect(afterLeave.answer).not.toBe(first.answer);

    // And the indexed fact is still there for members: owner asks, gets it.
    const ownerAsk = await askGlobal(ownerSocket, question);
    expect(ownerAsk.citations.some((c) => c.roomId === roomId)).toBe(true);
    void factId;
  });
});
