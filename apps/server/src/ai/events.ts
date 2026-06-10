import type { AppServer } from '../realtime/types.js';

// The AI layer needs to broadcast (doc status, answer streams) without the
// realtime module importing AI code. The io instance is injected once at
// boot; everything in src/ai reads it through this accessor and tolerates
// its absence.
let io: AppServer | null = null;

export function setAiIo(server: AppServer): void {
  io = server;
}

export function getAiIo(): AppServer | null {
  return io;
}
