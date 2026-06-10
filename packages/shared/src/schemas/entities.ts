import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

export const publicUserSchema = z.object({
  id: objectIdSchema,
  username: z.string(),
  displayName: z.string(),
  avatarSeed: z.string(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const createRoomRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Room name is required')
    .max(48, 'Room name must be at most 48 characters'),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
