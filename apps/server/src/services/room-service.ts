import type { RoomWire } from '@parley/shared';
import { Membership, type MembershipDoc } from '../models/membership.model.js';
import { Message } from '../models/message.model.js';
import type { RoomDoc } from '../models/room.model.js';

/**
 * Unread = messages in the room newer than the member's read cursor, not sent
 * by the member. Derived entirely from the Membership cursor; nothing is
 * stored per message. Served by the (roomId, _id) index.
 */
export async function unreadCountFor(
  userId: string,
  roomId: string,
  lastReadMessageId: string | null,
): Promise<number> {
  return Message.countDocuments({
    roomId,
    ...(lastReadMessageId ? { _id: { $gt: lastReadMessageId } } : {}),
    senderId: { $ne: userId },
  });
}

export async function toRoomWire(
  room: RoomDoc,
  userId: string,
  membership?: MembershipDoc | null,
): Promise<RoomWire> {
  const roomId = room._id.toHexString();
  const member = membership ?? (await Membership.findOne({ userId, roomId }));
  return {
    id: roomId,
    name: room.name,
    slug: room.slug,
    isDM: room.isDM,
    isMember: member !== null,
    aiEnabled: room.aiEnabled ?? true,
    unreadCount: member
      ? await unreadCountFor(userId, roomId, member.lastReadMessageId?.toHexString() ?? null)
      : 0,
  };
}
