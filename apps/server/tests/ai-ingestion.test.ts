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
import { connectSocket, type TestClientSocket } from './helpers/socket.js';
import { buildPdf } from './helpers/pdf-fixture.js';
import { startIngestWorker, processMessageJob } from '../src/ai/ingest/queue.js';
import { searchVectors } from '../src/ai/vector-store.js';
import { getEmbedder } from '../src/ai/provider.js';
import { Membership } from '../src/models/membership.model.js';

let ctx: TestContext;
let alice: TestUser;
let aliceSocket: TestClientSocket;
let generalId: string;

async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function vectorHitsFor(text: string, roomIds: string[]) {
  const [vector] = await getEmbedder().embed([text]);
  return searchVectors(vector as number[], { roomIds, limit: 5 });
}

beforeAll(async () => {
  ctx = await startTestServer();
  startIngestWorker();
  alice = await registerUser(ctx, { username: 'alice_ingest' });
  const rooms = await request(ctx.app)
    .get('/rooms')
    .set('Authorization', `Bearer ${alice.accessToken}`);
  generalId = rooms.body.rooms[0].id as string;
  aliceSocket = await connectSocket(ctx.url, alice.accessToken);
});

afterAll(async () => {
  aliceSocket.disconnect();
  await stopTestServer(ctx);
});

describe('message ingestion', () => {
  it('makes a sent message retrievable from the vector store', async () => {
    const body = 'the deployment freeze starts next thursday at noon';
    const ack = await aliceSocket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body,
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    const messageId = ack.data.message.id;

    const hit = await waitFor(async () => {
      const hits = await vectorHitsFor(body, [generalId]);
      return hits.find((h) => h.payload.messageId === messageId);
    }, 'message vector');
    expect(hit.payload.kind).toBe('message');
    expect(hit.payload.roomId).toBe(generalId);
    expect(hit.score).toBeGreaterThan(0.99);
  });

  it('is idempotent: reprocessing a message never duplicates its vector', async () => {
    const body = 'idempotency check message with unique words zanzibar quokka';
    const ack = await aliceSocket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body,
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    const messageId = ack.data.message.id;

    await waitFor(async () => {
      const hits = await vectorHitsFor(body, [generalId]);
      return hits.find((h) => h.payload.messageId === messageId);
    }, 'first ingestion');

    // Simulate redeliveries: the deterministic point id makes these no-ops.
    await processMessageJob(messageId);
    await processMessageJob(messageId);

    const hits = await vectorHitsFor(body, [generalId]);
    expect(hits.filter((h) => h.payload.messageId === messageId)).toHaveLength(1);
  });

  it('stops retrieving a room content after the membership is gone', async () => {
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'ingest leave room' });
    const roomId = created.body.room.id as string;
    const joinAck = await aliceSocket.emitWithAck('room:join', { roomId });
    expect(joinAck.ok).toBe(true);

    const body = 'secret plan stored in the leavable room';
    const sendAck = await aliceSocket.emitWithAck('message:send', {
      roomId,
      clientMsgId: randomUUID(),
      body,
    });
    expect(sendAck.ok).toBe(true);

    await waitFor(async () => {
      const hits = await vectorHitsFor(body, [roomId]);
      return hits.length > 0 ? hits : null;
    }, 'leavable room vector');

    await aliceSocket.emitWithAck('room:leave', { roomId });

    // Retrieval is scoped to current memberships at query time: the vector
    // still exists, but alice's room set no longer grants access to it.
    const memberships = await Membership.find({ userId: alice.userId });
    const roomIds = memberships.map((m) => m.roomId.toHexString());
    expect(roomIds).not.toContain(roomId);
    const hits = await vectorHitsFor(body, roomIds);
    expect(hits.find((h) => h.payload.roomId === roomId)).toBeUndefined();
  });
});

describe('document ingestion', () => {
  it('uploads a pdf and yields retrievable, page-cited chunks', async () => {
    const pdfText =
      'Project Atlas timeline. The migration to Postgres was approved by Dana in March 2026. Rollout begins in the third quarter.';
    const upload = await request(ctx.app)
      .post(`/rooms/${generalId}/documents`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .attach('file', buildPdf(pdfText), { filename: 'atlas.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const docId = upload.body.document.id as string;
    expect(upload.body.document.status).toBe('processing');

    const ready = await waitFor(async () => {
      const list = await request(ctx.app)
        .get(`/rooms/${generalId}/documents`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      const doc = list.body.documents.find((d: { id: string }) => d.id === docId);
      return doc && doc.status === 'ready' ? doc : null;
    }, 'document ready');
    expect(ready.chunkCount).toBeGreaterThan(0);

    const hits = await vectorHitsFor('migration to Postgres approved by Dana', [generalId]);
    const chunk = hits.find((h) => h.payload.docId === docId);
    expect(chunk).toBeDefined();
    expect(chunk?.payload.kind).toBe('doc');
    expect(chunk?.payload.page).toBe(1);
    expect(chunk?.payload.chunkIndex).toBe(0);
    expect(chunk?.payload.text).toContain('Postgres');
  });

  it('rejects unsupported types and enforces membership', async () => {
    const bad = await request(ctx.app)
      .post(`/rooms/${generalId}/documents`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .attach('file', Buffer.from('<html></html>'), {
        filename: 'page.html',
        contentType: 'text/html',
      });
    expect(bad.status).toBe(400);

    const outsider = await registerUser(ctx, { username: 'outsider_docs' });
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'docs members only' });
    const denied = await request(ctx.app)
      .post(`/rooms/${created.body.room.id}/documents`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .attach('file', Buffer.from('hello world'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });
    expect(denied.status).toBe(403);
  });
});
