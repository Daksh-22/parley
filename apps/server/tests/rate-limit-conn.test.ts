import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';

vi.hoisted(() => {
  process.env['CONN_RATE_LIMIT'] = '3';
  process.env['CONN_RATE_WINDOW_MS'] = '60000';
  process.env['CONN_MUTE_SECONDS'] = '60';
});

import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
} from './helpers/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

function attempt(url: string, token: string): Promise<'connected' | string> {
  return new Promise((resolve) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => {
      socket.disconnect();
      resolve('connected');
    });
    socket.on('connect_error', (err) => resolve(err.message));
  });
}

describe('connection rate limiting per IP', () => {
  it('refuses handshakes beyond the per-IP budget', async () => {
    const user = await registerUser(ctx, { username: 'conn_flood' });

    for (let i = 0; i < 3; i += 1) {
      expect(await attempt(ctx.url, user.accessToken)).toBe('connected');
    }

    // Fourth attempt within the window: refused before token verification.
    expect(await attempt(ctx.url, user.accessToken)).toBe('rate_limited');
  });
});
