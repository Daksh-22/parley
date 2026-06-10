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
