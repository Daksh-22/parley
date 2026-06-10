import { z } from 'zod';
import { objectIdSchema, publicUserSchema } from './entities.js';

// Canonical message shape on the wire. The sender summary is embedded so
// clients never need a follow-up user lookup to render a message.
export const messageWireSchema = z.object({
  id: objectIdSchema,
  roomId: objectIdSchema,
  sender: publicUserSchema,
  body: z.string(),
  clientMsgId: z.string(),
  createdAt: z.string().datetime(),
});
export type MessageWire = z.infer<typeof messageWireSchema>;

export const roomWireSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  isDM: z.boolean(),
  isMember: z.boolean(),
  unreadCount: z.number().int().min(0),
});
export type RoomWire = z.infer<typeof roomWireSchema>;

export const memberWireSchema = z.object({
  user: publicUserSchema,
  lastReadMessageId: objectIdSchema.nullable(),
  lastReadAt: z.string().datetime().nullable(),
});
export type MemberWire = z.infer<typeof memberWireSchema>;
