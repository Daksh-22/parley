import { aiAskPayloadSchema, aiFeedbackPayloadSchema } from '@parley/shared';
import { WsError } from '../lib/errors.js';
import { AiCall } from '../models/ai-call.model.js';
import { preflight, startAsk, roomEmitter, type StreamEmitter } from '../ai/ask.js';
import { getUserRoomIds } from '../ai/retrieval.js';
import { wrapHandler } from './ack.js';
import type { AppServer, AppSocket } from './types.js';

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
        // Membership is verified here, at ask time. The retrieval pipeline
        // checks again; defense in depth costs one indexed query.
        const roomIds = await getUserRoomIds(userId, payload.roomId);
        if (roomIds.length === 0) {
          throw new WsError('FORBIDDEN', 'You are not a member of this room');
        }
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
        emitter: socketEmitter(socket),
      });
      return { streamId };
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
