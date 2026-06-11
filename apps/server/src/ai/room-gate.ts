import { Room } from '../models/room.model.js';

// The per-room memory switch, enforced at every AI touchpoint: ingestion,
// retrieval scoping, and the ask surfaces. Sixty seconds of staleness is
// acceptable for a settings toggle; flipping it also re-checks at the next
// query anyway because retrieval refilters on every call.

const cache = new Map<string, { enabled: boolean; expiresAt: number }>();
const TTL_MS = 60_000;

export async function roomAiEnabled(roomId: string): Promise<boolean> {
  const hit = cache.get(roomId);
  if (hit && hit.expiresAt > Date.now()) return hit.enabled;
  const room = await Room.findById(roomId).select('aiEnabled');
  const enabled = room?.aiEnabled ?? true;
  cache.set(roomId, { enabled, expiresAt: Date.now() + TTL_MS });
  return enabled;
}

/** Filters a membership-derived room list down to memory-enabled rooms. */
export async function filterAiEnabledRooms(roomIds: string[]): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const rooms = await Room.find({
    _id: { $in: roomIds },
    aiEnabled: { $ne: false },
  }).select('_id');
  return rooms.map((r) => r._id.toHexString());
}

export function invalidateRoomGate(roomId: string): void {
  cache.delete(roomId);
}
