import type { PublicUser } from '@parley/shared';
import type { UserDoc } from '../models/user.model.js';

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toHexString(),
    username: user.username,
    displayName: user.displayName,
    avatarSeed: user.avatarSeed,
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
  };
}
