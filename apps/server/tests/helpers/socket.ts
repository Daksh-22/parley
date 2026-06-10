import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@parley/shared';

export type TestClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connects and resolves once the server has finished post-connect setup.
 * The server emits presence:state only after subscribing the socket to all
 * of its rooms, so tests that await this helper can rely on broadcasts.
 */
export function connectSocket(url: string, token: string): Promise<TestClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: TestClientSocket = ioClient(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect_error', (err) => reject(err));
    socket.on('presence:state', () => resolve(socket));
  });
}

/** Like connectSocket, but also returns the initial presence snapshot. */
export function connectSocketCapturingState(
  url: string,
  token: string,
): Promise<{ socket: TestClientSocket; online: string[] }> {
  return new Promise((resolve, reject) => {
    const socket: TestClientSocket = ioClient(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect_error', (err) => reject(err));
    socket.on('presence:state', (state) => resolve({ socket, online: state.online }));
  });
}

export function waitForEvent<K extends keyof ServerToClientEvents>(
  socket: TestClientSocket,
  event: K,
  predicate?: (payload: Parameters<ServerToClientEvents[K]>[0]) => boolean,
  timeoutMs = 5000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    type Payload = Parameters<ServerToClientEvents[K]>[0];
    const handler = (payload: Payload): void => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    function cleanup(): void {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket.io's off() cannot infer the listener type back from K
      socket.off(event, handler as any);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as above for on()
    socket.on(event, handler as any);
  });
}

/** Resolves if the event does NOT arrive within the window, rejects if it does. */
export function expectNoEvent<K extends keyof ServerToClientEvents>(
  socket: TestClientSocket,
  event: K,
  predicate?: (payload: Parameters<ServerToClientEvents[K]>[0]) => boolean,
  windowMs = 800,
): Promise<void> {
  return waitForEvent(socket, event, predicate, windowMs).then(
    () => {
      throw new Error(`Expected no ${event} event but one arrived`);
    },
    () => undefined,
  );
}
