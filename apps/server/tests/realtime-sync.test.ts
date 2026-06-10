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
import {
  connectSocket,
  connectSocketCapturingState,
  waitForEvent,
  expectNoEvent,
  type TestClientSocket,
} from './helpers/socket.js';

let ctx: TestContext;
let alice: TestUser;
let bob: TestUser;
let aliceSocket: TestClientSocket;
let bobSocket: TestClientSocket;
let generalId: string;

async function sendMessage(
  socket: TestClientSocket,
  roomId: string,
  body: string,
): Promise<string> {
  const ack = await socket.emitWithAck('message:send', {
    roomId,
    clientMsgId: randomUUID(),
    body,
  });
  if (!ack.ok) throw new Error(`send failed: ${ack.error.code}`);
  return ack.data.message.id;
}

beforeAll(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx, { username: 'alice_sync' });
  bob = await registerUser(ctx, { username: 'bob_sync' });

  const roomsRes = await request(ctx.app)
    .get('/rooms')
    .set('Authorization', `Bearer ${alice.accessToken}`);
  generalId = roomsRes.body.rooms.find((r: { slug: string }) => r.slug === 'general').id as string;

  aliceSocket = await connectSocket(ctx.url, alice.accessToken);
  bobSocket = await connectSocket(ctx.url, bob.accessToken);
});

afterAll(async () => {
  aliceSocket.disconnect();
  bobSocket.disconnect();
  await stopTestServer(ctx);
});

describe('typing indicators', () => {
  it('reaches everyone in the room except the sender', async () => {
    const bobSees = waitForEvent(bobSocket, 'typing:update', (e) => e.roomId === generalId);
    const aliceDoesNot = expectNoEvent(aliceSocket, 'typing:update', (e) => e.roomId === generalId);

    const ack = await aliceSocket.emitWithAck('typing:start', { roomId: generalId });
    expect(ack.ok).toBe(true);

    const event = await bobSees;
    expect(event.userId).toBe(alice.userId);
    expect(event.isTyping).toBe(true);
    await aliceDoesNot;

    // Explicit stop clears it immediately.
    const bobSeesStop = waitForEvent(
      bobSocket,
      'typing:update',
      (e) => e.roomId === generalId && !e.isTyping,
    );
    await aliceSocket.emitWithAck('typing:stop', { roomId: generalId });
    const stopEvent = await bobSeesStop;
    expect(stopEvent.userId).toBe(alice.userId);
  });

  it('expires server-side after 3 seconds without a stop', async () => {
    await aliceSocket.emitWithAck('typing:start', { roomId: generalId });
    const expired = await waitForEvent(
      bobSocket,
      'typing:update',
      (e) => e.roomId === generalId && !e.isTyping,
      5000,
    );
    expect(expired.userId).toBe(alice.userId);
  });
});

describe('presence', () => {
  it('announces connect, survives multiple tabs, and announces final disconnect', async () => {
    const dana = await registerUser(ctx, { username: 'dana_presence' });

    // First connection: everyone hears dana come online.
    const aliceSeesOnline = waitForEvent(
      aliceSocket,
      'presence:update',
      (e) => e.userId === dana.userId && e.online,
    );
    const danaTab1 = await connectSocket(ctx.url, dana.accessToken);
    await aliceSeesOnline;

    // Second tab: no flicker, no duplicate online broadcast.
    const noDuplicate = expectNoEvent(
      aliceSocket,
      'presence:update',
      (e) => e.userId === dana.userId,
    );
    const danaTab2 = await connectSocket(ctx.url, dana.accessToken);
    await noDuplicate;

    // Closing one of two tabs: still online, no offline broadcast.
    const noOffline = expectNoEvent(
      aliceSocket,
      'presence:update',
      (e) => e.userId === dana.userId,
    );
    danaTab1.disconnect();
    await noOffline;

    // Closing the last tab: offline broadcast with lastSeenAt stamped.
    const aliceSeesOffline = waitForEvent(
      aliceSocket,
      'presence:update',
      (e) => e.userId === dana.userId && !e.online,
    );
    danaTab2.disconnect();
    const offline = await aliceSeesOffline;
    expect(offline.lastSeenAt).toBeTypeOf('string');
  });

  it('includes already-online users in the initial presence snapshot', async () => {
    const erin = await registerUser(ctx, { username: 'erin_presence' });
    // alice connected in beforeAll and is still online.
    const { socket, online } = await connectSocketCapturingState(ctx.url, erin.accessToken);
    expect(online).toContain(alice.userId);
    socket.disconnect();
  });
});

describe('reconnect sync', () => {
  it('returns exactly the messages missed while disconnected', async () => {
    const lastSeenId = await sendMessage(aliceSocket, generalId, 'bob saw this one');

    bobSocket.disconnect();
    const missedIds = [
      await sendMessage(aliceSocket, generalId, 'missed 1'),
      await sendMessage(aliceSocket, generalId, 'missed 2'),
      await sendMessage(aliceSocket, generalId, 'missed 3'),
    ];

    bobSocket = await connectSocket(ctx.url, bob.accessToken);
    const ack = await bobSocket.emitWithAck('sync:since', {
      cursors: [{ roomId: generalId, lastMessageId: lastSeenId }],
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;

    const room = ack.data.rooms.find((r) => r.roomId === generalId);
    expect(room).toBeDefined();
    expect(room?.refetch).toBe(false);
    expect(room?.messages.map((m) => m.id)).toEqual(missedIds);
    expect(room?.messages.map((m) => m.body)).toEqual(['missed 1', 'missed 2', 'missed 3']);
  });

  it('omits rooms the requester is not a member of', async () => {
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'alice only sync' });
    const privateRoomId = created.body.room.id as string;
    const seedId = await sendMessage(aliceSocket, privateRoomId, 'private seed');

    const ack = await bobSocket.emitWithAck('sync:since', {
      cursors: [{ roomId: privateRoomId, lastMessageId: seedId }],
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.rooms).toHaveLength(0);
  });
});

describe('history pagination', () => {
  it('walks newest-first pages via cursors with no gaps or overlaps', async () => {
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'pagination room' });
    const roomId = created.body.room.id as string;

    const sentIds: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      sentIds.push(await sendMessage(aliceSocket, roomId, `message ${i}`));
    }

    const pageOne = await request(ctx.app)
      .get(`/rooms/${roomId}/messages?limit=2`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(pageOne.status).toBe(200);
    expect(pageOne.body.messages.map((m: { id: string }) => m.id)).toEqual([
      sentIds[4],
      sentIds[3],
    ]);
    expect(pageOne.body.nextCursor).toBeTypeOf('string');

    const pageTwo = await request(ctx.app)
      .get(
        `/rooms/${roomId}/messages?limit=2&cursor=${encodeURIComponent(pageOne.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(pageTwo.body.messages.map((m: { id: string }) => m.id)).toEqual([
      sentIds[2],
      sentIds[1],
    ]);

    const pageThree = await request(ctx.app)
      .get(
        `/rooms/${roomId}/messages?limit=2&cursor=${encodeURIComponent(pageTwo.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(pageThree.body.messages.map((m: { id: string }) => m.id)).toEqual([sentIds[0]]);
    expect(pageThree.body.nextCursor).toBeNull();
  });

  it('refuses history to non-members', async () => {
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'no peeking' });
    const res = await request(ctx.app)
      .get(`/rooms/${created.body.room.id}/messages`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(res.status).toBe(403);
  });
});
