import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  createRoomRequestSchema,
  objectIdSchema,
  type MemberWire,
  type MessageWire,
  type PublicUser,
} from '@parley/shared';
import { HttpError, isDuplicateKeyError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { requireAuth } from '../../auth/middleware.js';
import { toPublicUser } from '../../auth/serialize.js';
import { Room } from '../../models/room.model.js';
import { Membership } from '../../models/membership.model.js';
import { Message } from '../../models/message.model.js';
import { User } from '../../models/user.model.js';
import { toRoomWire } from '../../services/room-service.js';
import { ghostUser, toMessageWire } from '../../realtime/serialize.js';

export const roomsRouter = Router();
roomsRouter.use('/rooms', requireAuth);

const MAX_ROOMS_CREATED_PER_USER = 50;

const listQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const messagesQuerySchema = z.object({
  // Cursor format: "<createdAt ISO>_<id>", taken verbatim from a previous
  // response's nextCursor.
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z_[a-f0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

async function requireMembership(userId: string, roomId: string): Promise<void> {
  if (!Types.ObjectId.isValid(roomId)) {
    throw new HttpError(400, 'VALIDATION', 'Invalid room id');
  }
  const member = await Membership.exists({ userId, roomId });
  if (!member) {
    throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room');
  }
}

/** Batch-load public sender summaries for a page of messages. */
async function senderMap(
  messages: { senderId: Types.ObjectId }[],
): Promise<Map<string, PublicUser>> {
  const ids = [...new Set(messages.map((m) => m.senderId.toHexString()))];
  const users = await User.find({ _id: { $in: ids } });
  return new Map(users.map((u) => [u._id.toHexString(), toPublicUser(u)]));
}

// GET /rooms: the room directory. Paginated; member rooms carry live unread counts.
roomsRouter.get('/rooms', async (req, res) => {
  const userId = req.userId as string;
  const { cursor, limit } = parseOrThrow(listQuerySchema, req.query);

  const rooms = await Room.find({ isDM: false, ...(cursor ? { _id: { $gt: cursor } } : {}) })
    .sort({ _id: 1 })
    .limit(limit + 1);
  const page = rooms.slice(0, limit);

  const memberships = await Membership.find({
    userId,
    roomId: { $in: page.map((r) => r._id) },
  });
  const byRoom = new Map(memberships.map((m) => [m.roomId.toHexString(), m]));

  const wires = await Promise.all(
    page.map((room) => toRoomWire(room, userId, byRoom.get(room._id.toHexString()) ?? null)),
  );
  res.json({
    rooms: wires,
    nextCursor: rooms.length > limit ? page[page.length - 1]?._id.toHexString() : null,
  });
});

// POST /rooms: create a room and join it.
roomsRouter.post('/rooms', async (req, res) => {
  const userId = req.userId as string;
  const { name } = parseOrThrow(createRoomRequestSchema, req.body);

  const created = await Room.countDocuments({ creatorId: userId });
  if (created >= MAX_ROOMS_CREATED_PER_USER) {
    throw new HttpError(
      403,
      'ROOM_LIMIT',
      `You can create at most ${MAX_ROOMS_CREATED_PER_USER} rooms`,
    );
  }

  const baseSlug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'room';

  let room;
  try {
    room = await Room.create({ name, slug: baseSlug, isDM: false, creatorId: userId });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Slug collision: retry once with a random suffix.
    room = await Room.create({
      name,
      slug: `${baseSlug}-${randomBytes(3).toString('hex')}`,
      isDM: false,
      creatorId: userId,
    });
  }
  await Membership.create({ userId, roomId: room._id });
  res.status(201).json({ room: await toRoomWire(room, userId) });
});

const settingsBodySchema = z.object({ aiEnabled: z.boolean() });

// PATCH /rooms/:id/settings: the per-room memory switch. Any member may flip
// it; the product stance is documented in docs/PRODUCT.md.
roomsRouter.patch('/rooms/:id/settings', async (req, res) => {
  const userId = req.userId as string;
  const roomId = req.params.id as string;
  await requireMembership(userId, roomId);
  const { aiEnabled } = parseOrThrow(settingsBodySchema, req.body);

  const room = await Room.findByIdAndUpdate(roomId, { aiEnabled }, { new: true });
  if (!room) throw new HttpError(404, 'NOT_FOUND', 'Room not found');
  const { invalidateRoomGate } = await import('../../ai/room-gate.js');
  invalidateRoomGate(roomId);
  res.json({ room: await toRoomWire(room, userId) });
});

// GET /rooms/:id/messages: cursor-paginated history, newest first.
roomsRouter.get('/rooms/:id/messages', async (req, res) => {
  const userId = req.userId as string;
  const roomId = req.params.id as string;
  await requireMembership(userId, roomId);
  const { cursor, limit } = parseOrThrow(messagesQuerySchema, req.query);

  let filter: Record<string, unknown> = { roomId };
  if (cursor) {
    const [iso, id] = cursor.split('_') as [string, string];
    const createdAt = new Date(iso);
    filter = {
      roomId,
      $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }],
    };
  }

  const docs = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1);
  const page = docs.slice(0, limit);
  const senders = await senderMap(page);

  const messages: MessageWire[] = page.map((m) =>
    toMessageWire(m, senders.get(m.senderId.toHexString()) ?? ghostUser(m.senderId.toHexString())),
  );
  const last = page[page.length - 1];
  res.json({
    messages,
    nextCursor:
      docs.length > limit && last
        ? `${last.createdAt.toISOString()}_${last._id.toHexString()}`
        : null,
  });
});

// GET /rooms/:id/members: the room roster with read cursors.
roomsRouter.get('/rooms/:id/members', async (req, res) => {
  const userId = req.userId as string;
  const roomId = req.params.id as string;
  await requireMembership(userId, roomId);
  const { cursor, limit } = parseOrThrow(listQuerySchema, req.query);

  const memberships = await Membership.find({
    roomId,
    ...(cursor ? { _id: { $gt: cursor } } : {}),
  })
    .sort({ _id: 1 })
    .limit(limit + 1);
  const page = memberships.slice(0, limit);

  const users = await User.find({ _id: { $in: page.map((m) => m.userId) } });
  const byId = new Map(users.map((u) => [u._id.toHexString(), toPublicUser(u)]));

  const members: MemberWire[] = page.map((m) => ({
    user: byId.get(m.userId.toHexString()) ?? ghostUser(m.userId.toHexString()),
    lastReadMessageId: m.lastReadMessageId?.toHexString() ?? null,
    lastReadAt: m.lastReadAt?.toISOString() ?? null,
  }));

  res.json({
    members,
    nextCursor: memberships.length > limit ? page[page.length - 1]?._id.toHexString() : null,
  });
});
