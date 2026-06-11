import {
  aiAskPayloadSchema,
  aiCatchupPayloadSchema,
  aiDecisionsPayloadSchema,
  aiFeedbackPayloadSchema,
} from '@parley/shared';
import { WsError } from '../lib/errors.js';
import { AiCall } from '../models/ai-call.model.js';
import { Membership } from '../models/membership.model.js';
import { preflight, startAsk, roomEmitter, type StreamEmitter } from '../ai/ask.js';
import { startCatchup, extractDecisions } from '../ai/digest.js';
import { roomAiEnabled } from '../ai/room-gate.js';
import { wrapHandler } from './ack.js';
import type { AppServer, AppSocket } from './types.js';

async function requireAiRoom(userId: string, roomId: string): Promise<void> {
  const isMember = await Membership.exists({ userId, roomId });
  if (!isMember) throw new WsError('FORBIDDEN', 'You are not a member of this room');
  if (!(await roomAiEnabled(roomId))) {
    throw new WsError('AI_DISABLED_ROOM', 'Memory is off in this room');
  }
}

function socketEmitter(socket: AppSocket): StreamEmitter {
  return {
    start: (e) => socket.emit('ai:stream:start', e),
    delta: (e) => socket.emit('ai:stream:delta', e),
    done: (e) => socket.emit('ai:stream:done', e),
    error: (e) => socket.emit('ai:stream:error', e),
  };
}

export function registerAiHandlers(_io: AppServer, socket: AppSocket): void {
  const { userId } = socket.data;

  socket.on(
    'ai:ask',
    wrapHandler(socket, 'ai:ask', aiAskPayloadSchema, async (payload) => {
      await preflight(userId);

      if (payload.scope === 'room') {
        // Membership and the room memory gate, verified at ask time. The
        // retrieval pipeline checks both again; defense in depth.
        await requireAiRoom(userId, payload.roomId);
        const streamId = startAsk({
          userId,
          question: payload.question,
          scope: 'room',
          roomId: payload.roomId,
          persistToRoom: true,
          emitter: roomEmitter(payload.roomId),
        });
        return { streamId };
      }

      // Global ask: private to the asker, searches all their current rooms.
      const streamId = startAsk({
        userId,
        question: payload.question,
        scope: 'global',
        persistToRoom: false,
        bypassCache: payload.bypassCache,
        emitter: socketEmitter(socket),
      });
      return { streamId };
    }),
  );

  socket.on(
    'ai:catchup',
    wrapHandler(
      socket,
      'ai:catchup',
      aiCatchupPayloadSchema,
      async ({ roomId, sinceMessageId }) => {
        await preflight(userId);
        await requireAiRoom(userId, roomId);
        // Private to the asker: the digest reflects their personal read cursor.
        const streamId = startCatchup({
          userId,
          roomId,
          sinceMessageId,
          emitter: socketEmitter(socket),
        });
        return { streamId };
      },
    ),
  );

  socket.on(
    'ai:decisions',
    wrapHandler(socket, 'ai:decisions', aiDecisionsPayloadSchema, async ({ roomId }) => {
      await preflight(userId);
      await requireAiRoom(userId, roomId);
      try {
        return await extractDecisions(userId, roomId);
      } catch {
        throw new WsError('AI_FAILED', 'Recall could not extract decisions. Try again');
      }
    }),
  );

  socket.on(
    'ai:feedback',
    wrapHandler(socket, 'ai:feedback', aiFeedbackPayloadSchema, async ({ streamId, verdict }) => {
      // Scoped to the asker's own calls: nobody grades answers they never saw.
      await AiCall.updateOne({ streamId, userId }, { verdict });
      return { recorded: true as const };
    }),
  );
}
