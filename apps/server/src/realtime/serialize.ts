import type { MessageWire, PublicUser } from '@parley/shared';
import type { MessageDoc } from '../models/message.model.js';

export const roomChannel = (roomId: string): string => `room:${roomId}`;

/** Placeholder identity for messages whose sender account no longer exists. */
export function ghostUser(userId: string): PublicUser {
  return {
    id: userId,
    username: 'deleted',
    displayName: 'Deleted user',
    avatarSeed: userId,
    lastSeenAt: null,
  };
}

export function toMessageWire(message: MessageDoc, sender: PublicUser): MessageWire {
  return {
    id: message._id.toHexString(),
    roomId: message.roomId.toHexString(),
    sender,
    body: message.body,
    clientMsgId: message.clientMsgId,
    createdAt: message.createdAt.toISOString(),
  };
}
