import { z } from 'zod';
import { objectIdSchema } from './entities.js';

// ---------------------------------------------------------------------------
// Citations: every AI answer maps its [n] markers to real stored content.
// ---------------------------------------------------------------------------

export const citationSchema = z.object({
  index: z.number().int().min(1),
  kind: z.enum(['message', 'doc']),
  roomId: objectIdSchema,
  messageId: objectIdSchema.optional(),
  docId: objectIdSchema.optional(),
  chunkIndex: z.number().int().min(0).optional(),
  page: z.number().int().min(1).optional(),
  snippet: z.string(),
  senderName: z.string().optional(),
  createdAt: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

// ---------------------------------------------------------------------------
// Client-to-server AI payloads
// ---------------------------------------------------------------------------

export const aiQuestionSchema = z.string().trim().min(3).max(600);

export const aiAskPayloadSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('room'), roomId: objectIdSchema, question: aiQuestionSchema }),
  z.object({ scope: z.literal('global'), question: aiQuestionSchema }),
]);
export type AiAskPayload = z.infer<typeof aiAskPayloadSchema>;

export const aiCatchupPayloadSchema = z.object({
  roomId: objectIdSchema,
  // The read boundary captured when the room was opened, before the open
  // itself advanced the live cursor. Server falls back to the stored cursor.
  sinceMessageId: objectIdSchema.optional(),
});
export type AiCatchupPayload = z.infer<typeof aiCatchupPayloadSchema>;

export const aiDecisionsPayloadSchema = z.object({ roomId: objectIdSchema });
export type AiDecisionsPayload = z.infer<typeof aiDecisionsPayloadSchema>;

export const aiFeedbackPayloadSchema = z.object({
  streamId: z.string().uuid(),
  verdict: z.enum(['up', 'down']),
});
export type AiFeedbackPayload = z.infer<typeof aiFeedbackPayloadSchema>;

// ---------------------------------------------------------------------------
// Structured extraction: decisions
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  decision: z.string(),
  decidedBy: z.string(),
  date: z.string(),
  sourceMessageIds: z.array(objectIdSchema),
});
export type Decision = z.infer<typeof decisionSchema>;

export const decisionsResultSchema = z.object({ decisions: z.array(decisionSchema) });
export type DecisionsResult = z.infer<typeof decisionsResultSchema>;

// ---------------------------------------------------------------------------
// Server-to-client AI stream events
// ---------------------------------------------------------------------------

export interface AiStreamStartEvent {
  streamId: string;
  scope: 'room' | 'global' | 'catchup';
  roomId?: string;
  question: string;
  askedBy: string;
}

export interface AiStreamDeltaEvent {
  streamId: string;
  delta: string;
}

export interface AiStreamDoneEvent {
  streamId: string;
  answer: string;
  citations: Citation[];
  cached: boolean;
  // Set when the answer was persisted into the room as an ai message.
  messageId?: string;
}

export interface AiStreamErrorEvent {
  streamId: string;
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentWireSchema = z.object({
  id: objectIdSchema,
  roomId: objectIdSchema,
  filename: z.string(),
  size: z.number().int(),
  status: z.enum(['processing', 'ready', 'failed']),
  chunkCount: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type DocumentWire = z.infer<typeof documentWireSchema>;

// Doc ingestion status pushed to room members.
export interface AiDocStatusEvent {
  roomId: string;
  docId: string;
  filename: string;
  status: 'processing' | 'ready' | 'failed';
  chunkCount?: number;
  error?: string;
}
