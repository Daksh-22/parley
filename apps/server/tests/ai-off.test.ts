import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// The chat core must run perfectly with the AI layer disabled.
vi.hoisted(() => {
  process.env['AI_ENABLED'] = 'false';
});

import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
} from './helpers/harness.js';
import { connectSocket } from './helpers/socket.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

describe('AI disabled', () => {
  it('healthz reports ai disabled and stays healthy', async () => {
    const res = await request(ctx.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ai).toEqual({ enabled: false });
  });

  it('chat works end to end without any AI infrastructure', async () => {
    const alice = await registerUser(ctx, { username: 'alice_noai' });
    const rooms = await request(ctx.app)
      .get('/rooms')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    const generalId = rooms.body.rooms[0].id as string;

    const socket = await connectSocket(ctx.url, alice.accessToken);
    const ack = await socket.emitWithAck('message:send', {
      roomId: generalId,
      clientMsgId: randomUUID(),
      body: 'chat without ai works',
    });
    expect(ack.ok).toBe(true);
    socket.disconnect();
  });
});
