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
import { startIngestWorker } from '../src/ai/ingest/queue.js';
import { getEmbedder } from '../src/ai/provider.js';
import { searchVectors } from '../src/ai/vector-store.js';

// The MCP tools are a thin bridge over these PAT-authenticated endpoints,
// so these tests ARE the MCP permission leak tests: same filters, same code.

let ctx: TestContext;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: TestClientSocket;
let bobSocket: TestClientSocket;
let bobPat: string;
let secretRoomId: string;
const SECRET = 'the incident bridge number is 4471 say nothing outside this room';

async function sendAndIngest(
  socket: TestClientSocket,
  roomId: string,
  body: string,
): Promise<void> {
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
    if (hits.some((h) => h.payload.messageId === messageId)) return;
    if (Date.now() > deadline) throw new Error('never ingested');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

beforeAll(async () => {
  ctx = await startTestServer();
  startIngestWorker();
  alice = await registerUser(ctx, { username: 'alice_mcp' });
  bob = await registerUser(ctx, { username: 'bob_mcp' });
  aliceSocket = await connectSocket(ctx.url, alice.accessToken);
  bobSocket = await connectSocket(ctx.url, bob.accessToken);

  // bob's PAT, created through the real endpoint.
  const created = await request(ctx.app)
    .post('/tokens')
    .set('Authorization', `Bearer ${bob.accessToken}`)
    .send({ name: 'claude desktop' });
  expect(created.status).toBe(201);
  bobPat = created.body.token as string;
  expect(bobPat.startsWith('pat_')).toBe(true);

  // A room bob belongs to, holding a secret.
  const room = await request(ctx.app)
    .post('/rooms')
    .set('Authorization', `Bearer ${alice.accessToken}`)
    .send({ name: 'mcp secret room' });
  secretRoomId = room.body.room.id as string;
  const join = await bobSocket.emitWithAck('room:join', { roomId: secretRoomId });
  expect(join.ok).toBe(true);
  await sendAndIngest(aliceSocket, secretRoomId, SECRET);
});

afterAll(async () => {
  aliceSocket.disconnect();
  bobSocket.disconnect();
  await stopTestServer(ctx);
});

describe('PAT auth', () => {
  it('rejects missing, malformed, and revoked tokens', async () => {
    expect((await request(ctx.app).post('/memory/search').send({ query: 'x' })).status).toBe(401);
    expect(
      (
        await request(ctx.app)
          .post('/memory/search')
          .set('Authorization', 'Bearer pat_definitelywrong')
          .send({ query: 'x' })
      ).status,
    ).toBe(401);

    const created = await request(ctx.app)
      .post('/tokens')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ name: 'to revoke' });
    const tokenId = created.body.id as string;
    const plaintext = created.body.token as string;

    const before = await request(ctx.app)
      .post('/memory/search')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({ query: 'anything' });
    expect(before.status).toBe(200);

    await request(ctx.app)
      .post(`/tokens/${tokenId}/revoke`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const after = await request(ctx.app)
      .post('/memory/search')
      .set('Authorization', `Bearer ${plaintext}`)
      .send({ query: 'anything' });
    expect(after.status).toBe(401);
  });
});

describe('MCP-path permission leaks', () => {
  it('search respects membership at query time, including revocation', async () => {
    // Member: the secret is findable.
    const asMember = await request(ctx.app)
      .post('/memory/search')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ query: 'incident bridge number' });
    expect(asMember.status).toBe(200);
    expect(asMember.body.results.some((r: { text: string }) => r.text.includes('4471'))).toBe(true);

    // Revoked membership: the same query loses the room instantly.
    await bobSocket.emitWithAck('room:leave', { roomId: secretRoomId });
    const afterLeave = await request(ctx.app)
      .post('/memory/search')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ query: 'incident bridge number' });
    expect(afterLeave.body.results.every((r: { text: string }) => !r.text.includes('4471'))).toBe(
      true,
    );

    // Rejoin for the following tests.
    const rejoin = await bobSocket.emitWithAck('room:join', { roomId: secretRoomId });
    expect(rejoin.ok).toBe(true);
  });

  it('ask answers with citations only from member rooms', async () => {
    const res = await request(ctx.app)
      .post('/memory/ask')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ question: 'what is the incident bridge number?' });
    expect(res.status).toBe(200);
    expect(res.body.answer.length).toBeGreaterThan(0);

    // An outsider PAT gets nothing from the secret room.
    const outsider = await registerUser(ctx, { username: 'eve_mcp' });
    const evePat = (
      await request(ctx.app)
        .post('/tokens')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ name: 'eve token' })
    ).body.token as string;
    const eveAsk = await request(ctx.app)
      .post('/memory/ask')
      .set('Authorization', `Bearer ${evePat}`)
      .send({ question: 'what is the incident bridge number?' });
    expect(eveAsk.status).toBe(200);
    expect(JSON.stringify(eveAsk.body.citations)).not.toContain('4471');
    expect(eveAsk.body.answer).not.toContain('4471');
  });

  it('catchup enforces membership and the room gate', async () => {
    const room = await request(ctx.app)
      .get('/rooms')
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const secretSlug = room.body.rooms.find((r: { id: string }) => r.id === secretRoomId)
      .slug as string;

    const asMember = await request(ctx.app)
      .post('/memory/catchup')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ room: secretSlug });
    expect(asMember.status).toBe(200);
    expect(asMember.body.digest.length).toBeGreaterThan(0);

    const outsider = await registerUser(ctx, { username: 'mallory_mcp' });
    const malloryPat = (
      await request(ctx.app)
        .post('/tokens')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ name: 'mallory token' })
    ).body.token as string;
    const denied = await request(ctx.app)
      .post('/memory/catchup')
      .set('Authorization', `Bearer ${malloryPat}`)
      .send({ room: secretSlug });
    expect(denied.status).toBe(403);
  });

  it('excludes rooms whose memory switch is off', async () => {
    await request(ctx.app)
      .patch(`/rooms/${secretRoomId}/settings`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ aiEnabled: false });

    const search = await request(ctx.app)
      .post('/memory/search')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ query: 'incident bridge number' });
    expect(search.body.results.every((r: { text: string }) => !r.text.includes('4471'))).toBe(true);

    const catchup = await request(ctx.app)
      .post('/memory/catchup')
      .set('Authorization', `Bearer ${bobPat}`)
      .send({ room: 'mcp-secret-room' });
    expect(catchup.status).toBe(403);
  });
});
