import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError, isDuplicateKeyError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { requireAuth } from '../../auth/middleware.js';
import { Invite, generateInviteToken, hashInviteToken } from '../../models/invite.model.js';
import { Room } from '../../models/room.model.js';
import { Membership } from '../../models/membership.model.js';
import { toRoomWire } from '../../services/room-service.js';
import { MAX_ROOMS_PER_USER } from '../../realtime/handlers.js';
import { checkConnectionRate } from '../../realtime/rate-limit.js';

export const invitesRouter = Router();

const createInviteSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
  maxRedemptions: z.coerce.number().int().min(1).max(500).default(20),
});

const tokenSchema = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid invite token');

// POST /rooms/:id/invites: any member can invite to the room.
invitesRouter.post('/rooms/:id/invites', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const roomId = req.params.id as string;
  const member = await Membership.exists({ userId, roomId });
  if (!member) throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room');
  const { expiresInHours, maxRedemptions } = parseOrThrow(createInviteSchema, req.body ?? {});

  const token = generateInviteToken();
  const invite = await Invite.create({
    roomId,
    createdBy: userId,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000),
    maxRedemptions,
  });
  res.status(201).json({
    id: invite._id.toHexString(),
    url: `${env.CORS_ORIGIN}/invite/${token}`,
    expiresAt: invite.expiresAt.toISOString(),
    maxRedemptions,
  });
});

// GET /invites/:token: public preview for the landing page. Reveals only the
// room name of a currently valid invite.
invitesRouter.get('/invites/:token', async (req, res) => {
  const token = parseOrThrow(tokenSchema, req.params.token);
  const invite = await Invite.findOne({ tokenHash: hashInviteToken(token) });
  const valid =
    invite !== null &&
    invite.revokedAt === null &&
    invite.expiresAt > new Date() &&
    invite.redemptionCount < invite.maxRedemptions;
  if (!valid) {
    res.json({ valid: false });
    return;
  }
  const room = await Room.findById(invite.roomId);
  res.json({ valid: true, roomName: room?.name ?? 'a room' });
});

// POST /invites/:token/redeem: signed-in users join the room.
invitesRouter.post('/invites/:token/redeem', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const token = parseOrThrow(tokenSchema, req.params.token);

  // Redemption shares the per-IP sliding window limiter family.
  const rate = await checkConnectionRate(`invite:${req.ip ?? 'unknown'}`);
  if (!rate.allowed) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again in a minute');
  }

  // Atomic redemption: the filter enforces validity and the counter ceiling
  // in one conditional update, so concurrent redemptions cannot overshoot.
  const invite = await Invite.findOneAndUpdate(
    {
      tokenHash: hashInviteToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
      $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] },
    },
    { $inc: { redemptionCount: 1 } },
    { new: true },
  );
  if (!invite) {
    throw new HttpError(410, 'INVITE_INVALID', 'This invite has expired or was revoked');
  }

  const roomId = invite.roomId.toHexString();
  const existing = await Membership.exists({ userId, roomId });
  if (!existing) {
    const joined = await Membership.countDocuments({ userId });
    if (joined >= MAX_ROOMS_PER_USER) {
      // Undo the redemption we consumed.
      await Invite.updateOne({ _id: invite._id }, { $inc: { redemptionCount: -1 } });
      throw new HttpError(403, 'ROOM_LIMIT', `You can join at most ${MAX_ROOMS_PER_USER} rooms`);
    }
    try {
      await Membership.create({ userId, roomId });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
  } else {
    // Already a member: do not consume a redemption.
    await Invite.updateOne({ _id: invite._id }, { $inc: { redemptionCount: -1 } });
  }

  const room = await Room.findById(roomId);
  if (!room) throw new HttpError(404, 'NOT_FOUND', 'Room not found');
  res.json({ room: await toRoomWire(room, userId) });
});

// POST /invites/:id/revoke: the creator, or any member of the room.
invitesRouter.post('/invites/:id/revoke', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const invite = await Invite.findById(req.params.id);
  if (!invite) throw new HttpError(404, 'NOT_FOUND', 'Invite not found');
  const member = await Membership.exists({ userId, roomId: invite.roomId });
  if (!member) throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room');
  await Invite.updateOne({ _id: invite._id, revokedAt: null }, { revokedAt: new Date() });
  res.json({ revoked: true });
});
