import { Types } from 'mongoose';
import {
  messageDeliveredPayloadSchema,
  messageSendPayloadSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema,
  roomReadPayloadSchema,
  syncSincePayloadSchema,
  typingPayloadSchema,
  type SyncRoomResult,
} from '@parley/shared';
import { WsError, isDuplicateKeyError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { enqueueMessageEmbed } from '../ai/ingest/queue.js';
import { preflight, roomEmitter, startAsk } from '../ai/ask.js';
import { Room } from '../models/room.model.js';
import { Membership } from '../models/membership.model.js';
import { Message, type MessageDoc } from '../models/message.model.js';
import { toRoomWire } from '../services/room-service.js';
import { wrapHandler } from './ack.js';
import { checkMessageRate, checkJoinRate } from './rate-limit.js';
import { getPublicUser } from './user-cache.js';
import { ghostUser, roomChannel, toMessageWire } from './serialize.js';
import type { AppServer, AppSocket } from './types.js';

const TYPING_EXPIRY_MS = 3_000;
const SYNC_MESSAGES_CAP = 200;
export const MAX_ROOMS_PER_USER = 100;

export function registerHandlers(io: AppServer, socket: AppSocket): void {
  const { userId } = socket.data;
  // roomId -> server-side typing expiry timer for this socket.
  const typingTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Membership gate for room-scoped events. The socket's channel set is the
   * fast path; on a miss (for example an event racing the post-connect room
   * subscription) the database is authoritative and the channel is healed.
   */
  async function requireMembership(roomId: string): Promise<void> {
    if (socket.rooms.has(roomChannel(roomId))) return;
    const isMember = await Membership.exists({ userId, roomId });
    if (!isMember) {
      throw new WsError('FORBIDDEN', 'You are not a member of this room');
    }
    await socket.join(roomChannel(roomId));
  }

  async function wireMessage(message: MessageDoc): Promise<ReturnType<typeof toMessageWire>> {
    const senderId = message.senderId.toHexString();
    const sender = (await getPublicUser(senderId)) ?? ghostUser(senderId);
    return toMessageWire(message, sender);
  }

  socket.on(
    'room:join',
    wrapHandler(socket, 'room:join', roomJoinPayloadSchema, async ({ roomId }) => {
      const joinRate = await checkJoinRate(userId);
      if (!joinRate.allowed) {
        throw new WsError(
          'RATE_LIMITED',
          `Joining rooms too quickly. Try again in ${joinRate.retryAfterSeconds}s`,
        );
      }
      const room = await Room.findById(roomId);
      if (!room) throw new WsError('NOT_FOUND', 'Room not found');

      const existing = await Membership.findOne({ userId, roomId });
      if (!existing) {
        const joinedCount = await Membership.countDocuments({ userId });
        if (joinedCount >= MAX_ROOMS_PER_USER) {
          throw new WsError('ROOM_LIMIT', `You can join at most ${MAX_ROOMS_PER_USER} rooms`);
        }
        try {
          await Membership.create({ userId, roomId });
        } catch (err) {
          // Two tabs joining simultaneously is fine: membership exists either way.
          if (!isDuplicateKeyError(err)) throw err;
        }
      }
      await socket.join(roomChannel(roomId));
      return { room: await toRoomWire(room, userId) };
    }),
  );

  socket.on(
    'room:leave',
    wrapHandler(socket, 'room:leave', roomLeavePayloadSchema, async ({ roomId }) => {
      await Membership.deleteOne({ userId, roomId });
      await socket.leave(roomChannel(roomId));
      return { left: true as const };
    }),
  );

  socket.on(
    'message:send',
    wrapHandler(socket, 'message:send', messageSendPayloadSchema, async (payload) => {
      const rate = await checkMessageRate(userId);
      if (!rate.allowed) {
        throw new WsError(
          'RATE_LIMITED',
          `You are sending messages too quickly. Muted for ${rate.retryAfterSeconds}s`,
        );
      }
      await requireMembership(payload.roomId);

      let message: MessageDoc;
      try {
        // Persist first: the server-assigned id and timestamp are canonical.
        message = await Message.create({
          roomId: payload.roomId,
          senderId: userId,
          body: payload.body,
          clientMsgId: payload.clientMsgId,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // At-least-once delivery: a retry of an already persisted send
          // returns the canonical message without inserting or rebroadcasting.
          const existing = await Message.findOne({
            senderId: userId,
            clientMsgId: payload.clientMsgId,
          });
          if (existing) return { message: await wireMessage(existing) };
        }
        throw err;
      }

      const wire = await wireMessage(message);
      // Then broadcast to everyone else in the room. The sender's canonical
      // copy arrives via the ack.
      socket.to(roomChannel(payload.roomId)).emit('message:new', wire);
      // Fire-and-forget into the memory pipeline; chat never waits on AI.
      enqueueMessageEmbed(message._id.toHexString()).catch((err: unknown) => {
        logger.warn({ err }, 'embed enqueue failed');
      });

      // "@recall <question>" inside a room triggers a cited answer streamed
      // to the whole room and persisted as an ai message.
      if (env.AI_ENABLED && payload.body.startsWith('@recall ')) {
        const question = payload.body.slice('@recall '.length).trim();
        if (question.length >= 3 && question.length <= 600) {
          preflight(userId)
            .then(() => {
              startAsk({
                userId,
                question,
                scope: 'room',
                roomId: payload.roomId,
                persistToRoom: true,
                emitter: roomEmitter(payload.roomId),
              });
            })
            .catch((err: unknown) => {
              // Quota or availability refusals go quietly to the asker only.
              socket.emit('ai:stream:error', {
                streamId: `preflight-${message._id.toHexString()}`,
                code: err instanceof WsError ? err.code : 'AI_FAILED',
                message: err instanceof WsError ? err.message : 'Recall is unavailable right now',
              });
            });
        }
      }
      return { message: wire };
    }),
  );

  socket.on(
    'message:delivered',
    wrapHandler(socket, 'message:delivered', messageDeliveredPayloadSchema, async (payload) => {
      await requireMembership(payload.roomId);
      socket.to(roomChannel(payload.roomId)).emit('message:delivered', {
        roomId: payload.roomId,
        messageId: payload.messageId,
        userId,
      });
      return { recorded: true as const };
    }),
  );

  socket.on(
    'room:read',
    wrapHandler(socket, 'room:read', roomReadPayloadSchema, async (payload) => {
      await requireMembership(payload.roomId);
      const lastReadAt = new Date();
      // The cursor only moves forward. ObjectIds order by creation time, so a
      // stale read receipt from a lagging tab can never rewind the cursor.
      const result = await Membership.updateOne(
        {
          userId,
          roomId: payload.roomId,
          $or: [
            { lastReadMessageId: null },
            { lastReadMessageId: { $lt: new Types.ObjectId(payload.lastReadMessageId) } },
          ],
        },
        { lastReadMessageId: payload.lastReadMessageId, lastReadAt },
      );
      if (result.modifiedCount > 0) {
        io.to(roomChannel(payload.roomId)).emit('room:readState', {
          roomId: payload.roomId,
          userId,
          lastReadMessageId: payload.lastReadMessageId,
          lastReadAt: lastReadAt.toISOString(),
        });
      }
      return { recorded: true as const };
    }),
  );

  function emitTyping(roomId: string, isTyping: boolean): void {
    socket.to(roomChannel(roomId)).emit('typing:update', { roomId, userId, isTyping });
  }

  socket.on(
    'typing:start',
    wrapHandler(socket, 'typing:start', typingPayloadSchema, async ({ roomId }) => {
      await requireMembership(roomId);
      emitTyping(roomId, true);
      // Server-side expiry: a client that crashes mid-keystroke must not
      // leave a phantom typing indicator behind.
      clearTimeout(typingTimers.get(roomId));
      typingTimers.set(
        roomId,
        setTimeout(() => {
          typingTimers.delete(roomId);
          emitTyping(roomId, false);
        }, TYPING_EXPIRY_MS),
      );
      return { recorded: true as const };
    }),
  );

  socket.on(
    'typing:stop',
    wrapHandler(socket, 'typing:stop', typingPayloadSchema, async ({ roomId }) => {
      await requireMembership(roomId);
      clearTimeout(typingTimers.get(roomId));
      typingTimers.delete(roomId);
      emitTyping(roomId, false);
      return { recorded: true as const };
    }),
  );

  socket.on(
    'sync:since',
    wrapHandler(socket, 'sync:since', syncSincePayloadSchema, async ({ cursors }) => {
      const roomIds = cursors.map((c) => c.roomId);
      const memberships = await Membership.find({ userId, roomId: { $in: roomIds } }).select(
        'roomId',
      );
      const memberRoomIds = new Set(memberships.map((m) => m.roomId.toHexString()));

      const rooms: SyncRoomResult[] = [];
      for (const cursor of cursors) {
        // Rooms the user is not a member of are silently omitted rather than
        // erroring the whole sync.
        if (!memberRoomIds.has(cursor.roomId)) continue;
        const missed = await Message.find({
          roomId: cursor.roomId,
          _id: { $gt: cursor.lastMessageId },
        })
          .sort({ _id: 1 })
          .limit(SYNC_MESSAGES_CAP + 1);

        if (missed.length > SYNC_MESSAGES_CAP) {
          rooms.push({ roomId: cursor.roomId, messages: [], refetch: true });
        } else {
          rooms.push({
            roomId: cursor.roomId,
            messages: await Promise.all(missed.map((m) => wireMessage(m))),
            refetch: false,
          });
        }
      }
      return { rooms };
    }),
  );

  socket.on('disconnect', () => {
    for (const [roomId, timer] of typingTimers) {
      clearTimeout(timer);
      emitTyping(roomId, false);
    }
    typingTimers.clear();
  });
}
