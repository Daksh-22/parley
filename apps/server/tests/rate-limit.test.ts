import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Strict limits must be in place before src/config/env.ts is imported by the
// harness. vi.hoisted runs ahead of this module's imports.
vi.hoisted(() => {
  process.env['MSG_RATE_LIMIT'] = '5';
  process.env['MSG_RATE_WINDOW_MS'] = '10000';
  process.env['MSG_MUTE_SECONDS'] = '2';
  process.env['JOIN_RATE_LIMIT'] = '3';
  process.env['JOIN_RATE_WINDOW_MS'] = '10000';
  process.env['JOIN_MUTE_SECONDS'] = '2';
  process.env['CONN_RATE_LIMIT'] = '10000';
});

import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
} from './helpers/harness.js';
import { connectSocket, type TestClientSocket } from './helpers/socket.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

function send(socket: TestClientSocket, roomId: string) {
  return socket.emitWithAck('message:send', {
    roomId,
    clientMsgId: randomUUID(),
    body: 'rate limit probe',
  });
}

describe('message rate limiting', () => {
  it('mutes after the limit, refuses with retry seconds, and recovers after the mute', async () => {
    const alice = await registerUser(ctx, { username: 'alice_rl' });
    const socket = await connectSocket(ctx.url, alice.accessToken);
    const rooms = await request(ctx.app)
      .get('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    const generalId = rooms.body.rooms[0].id as string;

    for (let i = 0; i < 5; i += 1) {
      const ack = await send(socket, generalId);
      expect(ack.ok).toBe(true);
    }

    const sixth = await send(socket, generalId);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.error.code).toBe('RATE_LIMITED');
      expect(sixth.error.message).toMatch(/muted for \ds/i);
    }

    // Still muted while the mute key lives.
    const seventh = await send(socket, generalId);
    expect(seventh.ok).toBe(false);

    // After the mute expires the user can speak again.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const recovered = await send(socket, generalId);
    expect(recovered.ok).toBe(true);

    socket.disconnect();
  });
});

describe('join flood protection', () => {
  it('limits how quickly a user can join rooms', async () => {
    const creator = await registerUser(ctx, { username: 'creator_rl' });
    const joiner = await registerUser(ctx, { username: 'joiner_rl' });

    const roomIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await request(ctx.app)
        .post('/rooms')
        .set('Authorization', `Bearer ${creator.accessToken}`)
        .send({ name: `flood room ${i}` });
      roomIds.push(res.body.room.id as string);
    }

    const socket = await connectSocket(ctx.url, joiner.accessToken);
    for (let i = 0; i < 3; i += 1) {
      const ack = await socket.emitWithAck('room:join', { roomId: roomIds[i] as string });
      expect(ack.ok).toBe(true);
    }

    const fourth = await socket.emitWithAck('room:join', { roomId: roomIds[3] as string });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.error.code).toBe('RATE_LIMITED');

    socket.disconnect();
  });
});
