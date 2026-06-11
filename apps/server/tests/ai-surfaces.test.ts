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
import { AiCall } from '../src/models/ai-call.model.js';
import { Message } from '../src/models/message.model.js';

let ctx: TestContext;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: TestClientSocket;
let bobSocket: TestClientSocket;

async function createRoomAndJoin(
  creator: TestUser,
  joinerSocket: TestClientSocket,
  name: string,
): Promise<string> {
  const created = await request(ctx.app)
    .post('/rooms')
    .set('Authorization', `Bearer ${creator.accessToken}`)
    .send({ name });
  const roomId = created.body.room.id as string;
  const ack = await joinerSocket.emitWithAck('room:join', { roomId });
  if (!ack.ok) throw new Error('join failed');
  return roomId;
}

async function send(socket: TestClientSocket, roomId: string, body: string): Promise<string> {
  const ack = await socket.emitWithAck('message:send', {
    roomId,
    clientMsgId: randomUUID(),
    body,
  });
  if (!ack.ok) throw new Error(`send failed: ${ack.error.code}`);
  return ack.data.message.id;
}

async function waitIngested(roomId: string, text: string, messageId: string): Promise<void> {
  const [vector] = await getEmbedder().embed([text]);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const hits = await searchVectors(vector as number[], { roomIds: [roomId], limit: 10 });
    if (hits.some((h) => h.payload.messageId === messageId)) return;
    if (Date.now() > deadline) throw new Error('never ingested');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

beforeAll(async () => {
  ctx = await startTestServer();
  startIngestWorker();
  alice = await registerUser(ctx, { username: 'alice_surf' });
  bob = await registerUser(ctx, { username: 'bob_surf' });
  aliceSocket = await connectSocket(ctx.url, alice.accessToken);
  bobSocket = await connectSocket(ctx.url, bob.accessToken);
});

afterAll(async () => {
  aliceSocket.disconnect();
  bobSocket.disconnect();
  await stopTestServer(ctx);
});

describe('per-room memory switch', () => {
  it('skips ingestion, blocks asks, and filters retrieval when off', async () => {
    const roomId = await createRoomAndJoin(alice, bobSocket, 'memory switch room');

    // Seed a fact while memory is on; it becomes retrievable.
    const factText = 'the staging environment password rotates on fridays';
    const factId = await send(aliceSocket, roomId, factText);
    await waitIngested(roomId, factText, factId);

    // Switch memory off.
    const patched = await request(ctx.app)
      .patch(`/rooms/${roomId}/settings`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ aiEnabled: false });
    expect(patched.status).toBe(200);
    expect(patched.body.room.aiEnabled).toBe(false);

    // New messages are not ingested.
    const offText = 'this sentence must never reach the vector store xylophone';
    await send(aliceSocket, roomId, offText);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const [offVector] = await getEmbedder().embed([offText]);
    const offHits = await searchVectors(offVector as number[], { roomIds: [roomId], limit: 10 });
    expect(offHits.find((h) => h.payload.text === offText)).toBeUndefined();

    // Room-scoped asks refuse with a calm specific code.
    const roomAsk = await aliceSocket.emitWithAck('ai:ask', {
      scope: 'room',
      roomId,
      question: 'what rotates on fridays?',
    });
    expect(roomAsk.ok).toBe(false);
    if (!roomAsk.ok) expect(roomAsk.error.code).toBe('AI_DISABLED_ROOM');

    // Global asks no longer retrieve the room's earlier content.
    const doneOff = waitForEvent(bobSocket, 'ai:stream:done');
    const globalAsk = await bobSocket.emitWithAck('ai:ask', {
      scope: 'global',
      question: 'when does the staging environment password rotate?',
    });
    expect(globalAsk.ok).toBe(true);
    const resultOff = await doneOff;
    expect(resultOff.citations.every((c) => c.roomId !== roomId)).toBe(true);

    // Switching memory back on restores retrieval of the indexed fact.
    await request(ctx.app)
      .patch(`/rooms/${roomId}/settings`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ aiEnabled: true });
    const doneOn = waitForEvent(bobSocket, 'ai:stream:done');
    await bobSocket.emitWithAck('ai:ask', {
      scope: 'global',
      question: 'when does the staging environment password rotate?',
    });
    const resultOn = await doneOn;
    expect(resultOn.citations.some((c) => c.messageId === factId)).toBe(true);
  });
});

describe('catch me up', () => {
  it('digests exactly the missed window, privately', async () => {
    const roomId = await createRoomAndJoin(alice, bobSocket, 'catchup room');

    const seenId = await send(aliceSocket, roomId, 'bob saw this opening message');
    const missedIds = [
      await send(aliceSocket, roomId, 'we agreed the digest covers missed messages'),
      await send(aliceSocket, roomId, 'and it cites each point it makes'),
    ];

    const bobDone = waitForEvent(bobSocket, 'ai:stream:done');
    const bobStart = waitForEvent(bobSocket, 'ai:stream:start', (e) => e.scope === 'catchup');
    const ack = await bobSocket.emitWithAck('ai:catchup', { roomId, sinceMessageId: seenId });
    expect(ack.ok).toBe(true);

    const start = await bobStart;
    expect(start.roomId).toBe(roomId);
    const done = await bobDone;
    expect(done.answer.length).toBeGreaterThan(0);
    // Citations come only from the missed window.
    for (const citation of done.citations) {
      expect(missedIds).toContain(citation.messageId);
    }

    // Caught up: the same boundary at the latest message yields the calm
    // nothing-new path with no model call.
    const lastId = missedIds[missedIds.length - 1] as string;
    const doneEmpty = waitForEvent(bobSocket, 'ai:stream:done');
    await bobSocket.emitWithAck('ai:catchup', { roomId, sinceMessageId: lastId });
    const empty = await doneEmpty;
    expect(empty.answer).toContain('Nothing new');
    expect(empty.citations).toHaveLength(0);
  });
});

describe('extract decisions', () => {
  it('returns structured decisions whose sources are real room messages', async () => {
    const roomId = await createRoomAndJoin(alice, bobSocket, 'decisions room');
    await send(aliceSocket, roomId, 'should we use qdrant or pgvector for the vector store?');
    const decisionId = await send(
      aliceSocket,
      roomId,
      'Decision: we are going with qdrant for vectors, pgvector stays on the roadmap.',
    );
    await send(bobSocket, roomId, 'sounds good, qdrant it is');

    const ack = await bobSocket.emitWithAck('ai:decisions', { roomId });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.decisions.length).toBeGreaterThan(0);

    const roomMessageIds = new Set(
      (await Message.find({ roomId })).map((m) => m._id.toHexString()),
    );
    for (const decision of ack.data.decisions) {
      expect(decision.sourceMessageIds.length).toBeGreaterThan(0);
      for (const id of decision.sourceMessageIds) {
        expect(roomMessageIds.has(id)).toBe(true);
      }
    }
    expect(ack.data.decisions.some((d) => d.sourceMessageIds.includes(decisionId))).toBe(true);
  });
});

describe('feedback loop', () => {
  it('persists a verdict tied to the call record', async () => {
    const done = waitForEvent(aliceSocket, 'ai:stream:done');
    const ask = await aliceSocket.emitWithAck('ai:ask', {
      scope: 'global',
      question: 'a question to grade for the feedback loop',
    });
    expect(ask.ok).toBe(true);
    if (!ask.ok) return;
    await done;

    const feedback = await aliceSocket.emitWithAck('ai:feedback', {
      streamId: ask.data.streamId,
      verdict: 'down',
    });
    expect(feedback.ok).toBe(true);

    const call = await AiCall.findOne({ streamId: ask.data.streamId });
    expect(call?.verdict).toBe('down');
    expect(call?.question).toBe('a question to grade for the feedback loop');

    // Another user cannot grade a call they never made.
    await bobSocket.emitWithAck('ai:feedback', {
      streamId: ask.data.streamId,
      verdict: 'up',
    });
    const unchanged = await AiCall.findOne({ streamId: ask.data.streamId });
    expect(unchanged?.verdict).toBe('down');
  });
});
