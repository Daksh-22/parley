import { z } from 'zod';
import { objectIdSchema } from './entities.js';
import type { MessageWire, RoomWire } from './wire.js';

// ---------------------------------------------------------------------------
// Acks. Every client-to-server event is acknowledged with this envelope.
// ---------------------------------------------------------------------------

export type AckOk<T> = { ok: true; data: T };
export type AckErr = { ok: false; error: { code: string; message: string } };
export type Ack<T> = AckOk<T> | AckErr;

// ---------------------------------------------------------------------------
// Client-to-server payloads. Every payload is zod-validated server-side.
// Note: no payload carries a sender identity. The server takes the sender
// from the authenticated socket, which makes impersonation structurally
// impossible rather than merely checked.
// ---------------------------------------------------------------------------

export const roomJoinPayloadSchema = z.object({ roomId: objectIdSchema });
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>;

export const roomLeavePayloadSchema = z.object({ roomId: objectIdSchema });
export type RoomLeavePayload = z.infer<typeof roomLeavePayloadSchema>;

export const messageSendPayloadSchema = z.object({
  roomId: objectIdSchema,
  clientMsgId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});
export type MessageSendPayload = z.infer<typeof messageSendPayloadSchema>;

export const messageDeliveredPayloadSchema = z.object({
  roomId: objectIdSchema,
  messageId: objectIdSchema,
});
export type MessageDeliveredPayload = z.infer<typeof messageDeliveredPayloadSchema>;

export const roomReadPayloadSchema = z.object({
  roomId: objectIdSchema,
  lastReadMessageId: objectIdSchema,
});
export type RoomReadPayload = z.infer<typeof roomReadPayloadSchema>;

export const typingPayloadSchema = z.object({ roomId: objectIdSchema });
export type TypingPayload = z.infer<typeof typingPayloadSchema>;

export const syncSincePayloadSchema = z.object({
  cursors: z
    .array(z.object({ roomId: objectIdSchema, lastMessageId: objectIdSchema }))
    .min(1)
    .max(50),
});
export type SyncSincePayload = z.infer<typeof syncSincePayloadSchema>;

// ---------------------------------------------------------------------------
// Server-to-client payloads
// ---------------------------------------------------------------------------

export interface MessageDeliveredEvent {
  roomId: string;
  messageId: string;
  userId: string;
}

export interface RoomReadStateEvent {
  roomId: string;
  userId: string;
  lastReadMessageId: string;
  lastReadAt: string;
}

export interface TypingUpdateEvent {
  roomId: string;
  userId: string;
  isTyping: boolean;
}

export interface PresenceUpdateEvent {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface PresenceStateEvent {
  online: string[];
}

export interface SyncRoomResult {
  roomId: string;
  // Either the missed messages (ascending), or refetch=true when more than
  // the cap were missed and the client should reload history instead.
  messages: MessageWire[];
  refetch: boolean;
}

// ---------------------------------------------------------------------------
// Socket.IO event maps, shared by server and client for end-to-end typing.
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  'message:new': (message: MessageWire) => void;
  'message:delivered': (event: MessageDeliveredEvent) => void;
  'room:readState': (event: RoomReadStateEvent) => void;
  'typing:update': (event: TypingUpdateEvent) => void;
  'presence:update': (event: PresenceUpdateEvent) => void;
  'presence:state': (event: PresenceStateEvent) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload, ack: (response: Ack<{ room: RoomWire }>) => void) => void;
  'room:leave': (payload: RoomLeavePayload, ack: (response: Ack<{ left: true }>) => void) => void;
  'message:send': (
    payload: MessageSendPayload,
    ack: (response: Ack<{ message: MessageWire }>) => void,
  ) => void;
  'message:delivered': (
    payload: MessageDeliveredPayload,
    ack: (response: Ack<{ recorded: true }>) => void,
  ) => void;
  'room:read': (payload: RoomReadPayload, ack: (response: Ack<{ recorded: true }>) => void) => void;
  'typing:start': (
    payload: TypingPayload,
    ack: (response: Ack<{ recorded: true }>) => void,
  ) => void;
  'typing:stop': (payload: TypingPayload, ack: (response: Ack<{ recorded: true }>) => void) => void;
  'sync:since': (
    payload: SyncSincePayload,
    ack: (response: Ack<{ rooms: SyncRoomResult[] }>) => void,
  ) => void;
}
