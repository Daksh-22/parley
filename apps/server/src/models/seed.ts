import { Room } from './room.model.js';
import { logger } from '../lib/logger.js';

export const GENERAL_SLUG = 'general';

// Idempotent: upsert keyed on the unique slug, safe across multiple instances
// booting concurrently.
export async function ensureSeedRooms(): Promise<void> {
  const result = await Room.updateOne(
    { slug: GENERAL_SLUG },
    { $setOnInsert: { name: 'general', slug: GENERAL_SLUG, isDM: false, creatorId: null } },
    { upsert: true },
  );
  if (result.upsertedCount > 0) {
    logger.info('seeded #general room');
  }
}
