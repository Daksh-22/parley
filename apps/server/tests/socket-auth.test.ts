import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
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

function connect(token?: string): ClientSocket {
  return ioClient(ctx.url, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    reconnection: false,
    timeout: 5000,
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
  });
}

describe('socket handshake auth', () => {
  it('rejects a connection without a token', async () => {
    const socket = connect();
    await expect(waitForConnect(socket)).rejects.toThrow('unauthorized');
    socket.disconnect();
  });

  it('rejects a connection with a garbage token', async () => {
    const socket = connect('definitely-not-a-jwt');
    await expect(waitForConnect(socket)).rejects.toThrow('unauthorized');
    socket.disconnect();
  });

  it('rejects a refresh token used for the socket handshake', async () => {
    const user = await registerUser(ctx);
    const refreshJwt = user.refreshCookie?.split(';')[0]?.split('=')[1];
    expect(refreshJwt).toBeDefined();
    const socket = connect(refreshJwt);
    await expect(waitForConnect(socket)).rejects.toThrow('unauthorized');
    socket.disconnect();
  });

  it('accepts a connection with a valid access token', async () => {
    const user = await registerUser(ctx);
    const socket = connect(user.accessToken);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });
});
