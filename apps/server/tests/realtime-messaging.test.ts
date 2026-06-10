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

beforeAll(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx, { username: 'alice_rt' });
  bob = await registerUser(ctx, { username: 'bob_rt' });

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

describe('message exchange', () => {
  it('persists, broadcasts to the room, and acks the sender with the canonical message', async () => {
    const clientMsgId = randomUUID();
    const bobReceives = waitForEvent(bobSocket, 'message:new');

    const ack = await aliceSocket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId,
      body: 'hello from alice',
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.message.sender.id).toBe(alice.userId);
    expect(ack.data.message.body).toBe('hello from alice');
    expect(ack.data.message.clientMsgId).toBe(clientMsgId);
    expect(ack.data.message.id).toMatch(/^[a-f0-9]{24}$/);

    const broadcast = await bobReceives;
    expect(broadcast.id).toBe(ack.data.message.id);
    expect(broadcast.sender.id).toBe(alice.userId);
  });

  it('delivers in both directions', async () => {
    const aliceReceives = waitForEvent(aliceSocket, 'message:new');
    const ack = await bobSocket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'hello back from bob',
    });
    expect(ack.ok).toBe(true);
    const received = await aliceReceives;
    expect(received.sender.id).toBe(bob.userId);
    expect(received.body).toBe('hello back from bob');
  });

  it('ignores a forged senderId: identity always comes from the socket', async () => {
    const bobReceives = waitForEvent(bobSocket, 'message:new');
    const forged = {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'forged message',
      // Hostile extras: zod strips unknown keys before the handler runs.
      senderId: bob.userId,
      sender: { id: bob.userId, username: 'bob_rt' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately sending an over-typed hostile payload
    const ack = await aliceSocket.emitWithAck('message:send', forged as any);

    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.message.sender.id).toBe(alice.userId);

    const broadcast = await bobReceives;
    expect(broadcast.sender.id).toBe(alice.userId);

    // The persisted record agrees.
    const history = await request(ctx.app)
      .get(`/rooms/${generalId}/messages?limit=1`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(history.body.messages[0].sender.id).toBe(alice.userId);
  });

  it('dedupes a retried clientMsgId: same canonical message, no second broadcast', async () => {
    const clientMsgId = randomUUID();
    const payload = { roomId: generalId, clientMsgId, body: 'sent exactly once' };

    const first = await aliceSocket.emitWithAck('message:send', payload);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const noRebroadcast = expectNoEvent(
      bobSocket,
      'message:new',
      (m) => m.clientMsgId === clientMsgId,
    );
    const second = await aliceSocket.emitWithAck('message:send', payload);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.message.id).toBe(first.data.message.id);
    await noRebroadcast;
  });

  it('rejects sends to rooms the user is not a member of', async () => {
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'alice private corner' });
    expect(created.status).toBe(201);
    const privateRoomId = created.body.room.id as string;

    const ack = await bobSocket.emitWithAck('message:send', {
      roomId: privateRoomId,
      clientMsgId: randomUUID(),
      body: 'should not land',
    });
    expect(ack.ok).toBe(false);
    if (ack.ok) return;
    expect(ack.error.code).toBe('FORBIDDEN');
  });

  it('rejects invalid payloads with a validation ack, not a dropped event', async () => {
    const malformed = { roomId: generalId, clientMsgId: 'not-a-uuid', body: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed
    const ack = await aliceSocket.emitWithAck('message:send', malformed as any);
    expect(ack.ok).toBe(false);
    if (ack.ok) return;
    expect(ack.error.code).toBe('VALIDATION');
  });
});

describe('delivery and read receipts', () => {
  it('fans out message:delivered to the rest of the room', async () => {
    const bobReceives = waitForEvent(bobSocket, 'message:new');
    const sendAck = await aliceSocket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'confirm receipt please',
    });
    expect(sendAck.ok).toBe(true);
    if (!sendAck.ok) return;
    const message = await bobReceives;

    const aliceSeesDelivery = waitForEvent(
      aliceSocket,
      'message:delivered',
      (e) => e.messageId === message.id,
    );
    const deliveredAck = await bobSocket.emitWithAck('message:delivered', {
      roomId: generalId,
      messageId: message.id,
    });
    expect(deliveredAck.ok).toBe(true);

    const event = await aliceSeesDelivery;
    expect(event.userId).toBe(bob.userId);
    expect(event.roomId).toBe(generalId);
  });

  it('updates the read cursor, broadcasts read state, and zeroes the unread count', async () => {
    // Fresh room so unread counts are deterministic.
    const created = await request(ctx.app)
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'receipts room' });
    const roomId = created.body.room.id as string;
    const joinAck = await bobSocket.emitWithAck('room:join', { roomId });
    expect(joinAck.ok).toBe(true);

    const sendAcks = [];
    for (const body of ['one', 'two', 'three']) {
      const ack = await aliceSocket.emitWithAck('message:send', {
        roomId,
        clientMsgId: randomUUID(),
        body,
      });
      expect(ack.ok).toBe(true);
      sendAcks.push(ack);
    }
    const lastAck = sendAcks[2];
    if (!lastAck?.ok) return;
    const lastMessageId = lastAck.data.message.id;

    const unreadBefore = await request(ctx.app)
      .get('/rooms')
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const roomBefore = unreadBefore.body.rooms.find((r: { id: string }) => r.id === roomId);
    expect(roomBefore.unreadCount).toBe(3);

    const aliceSeesRead = waitForEvent(aliceSocket, 'room:readState', (e) => e.roomId === roomId);
    const readAck = await bobSocket.emitWithAck('room:read', {
      roomId,
      lastReadMessageId: lastMessageId,
    });
    expect(readAck.ok).toBe(true);

    const readState = await aliceSeesRead;
    expect(readState.userId).toBe(bob.userId);
    expect(readState.lastReadMessageId).toBe(lastMessageId);

    const unreadAfter = await request(ctx.app)
      .get('/rooms')
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const roomAfter = unreadAfter.body.rooms.find((r: { id: string }) => r.id === roomId);
    expect(roomAfter.unreadCount).toBe(0);

    // The cursor never moves backwards: re-reading an older message is a no-op.
    const firstAck = sendAcks[0];
    if (!firstAck?.ok) return;
    const noRewind = expectNoEvent(aliceSocket, 'room:readState', (e) => e.roomId === roomId);
    await bobSocket.emitWithAck('room:read', {
      roomId,
      lastReadMessageId: firstAck.data.message.id,
    });
    await noRewind;
  });
});
