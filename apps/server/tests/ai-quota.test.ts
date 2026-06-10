import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// A quota small enough that one mock answer exhausts it.
vi.hoisted(() => {
  process.env['AI_DAILY_TOKEN_QUOTA'] = '5';
});

import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
} from './helpers/harness.js';
import { connectSocket, waitForEvent } from './helpers/socket.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

describe('daily token quota', () => {
  it('lets the first ask through, then refuses with QUOTA_EXHAUSTED', async () => {
    const user = await registerUser(ctx, { username: 'quota_user' });
    await request(ctx.app).get('/rooms').set('Authorization', `Bearer ${user.accessToken}`);
    const socket = await connectSocket(ctx.url, user.accessToken);

    const done = waitForEvent(socket, 'ai:stream:done');
    const first = await socket.emitWithAck('ai:ask', {
      scope: 'global',
      question: 'what happened this week?',
    });
    expect(first.ok).toBe(true);
    await done;

    const second = await socket.emitWithAck('ai:ask', {
      scope: 'global',
      question: 'and what about last week?',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('QUOTA_EXHAUSTED');
      expect(second.error.message).toMatch(/resets at midnight/i);
    }
    socket.disconnect();
  });
});
