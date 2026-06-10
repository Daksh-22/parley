import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface MessageFields {
  roomId: Types.ObjectId;
  senderId: Types.ObjectId;
  body: string;
  // Client-generated uuid. The unique (senderId, clientMsgId) index makes
  // message sends idempotent: at-least-once delivery, exactly-once persistence.
  clientMsgId: string;
  // 'ai' marks a persisted Recall answer. AI messages are never ingested
  // into the vector store, which prevents feedback loops.
  kind: 'user' | 'ai';
  // Citations are constructed server-side and validated against the shared
  // zod schema before persist; stored as plain subdocuments.
  citations?: unknown[];
  aiQuestion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDoc = HydratedDocument<MessageFields>;

const messageSchema = new Schema<MessageFields>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 8000 },
    clientMsgId: { type: String, required: true, maxlength: 64 },
    kind: { type: String, enum: ['user', 'ai'], default: 'user' },
    citations: { type: [Schema.Types.Mixed], default: undefined },
    aiQuestion: { type: String, maxlength: 600 },
  },
  { timestamps: true },
);

// Lexical leg of hybrid retrieval.
messageSchema.index({ body: 'text' });

// Cursor pagination: newest first within a room, tie-broken by _id.
messageSchema.index({ roomId: 1, createdAt: -1, _id: -1 });
// Unread counts and reconnect sync: _id range scans within a room.
messageSchema.index({ roomId: 1, _id: -1 });
// Idempotent dedup for at-least-once sends.
messageSchema.index({ senderId: 1, clientMsgId: 1 }, { unique: true });

export const Message = model('Message', messageSchema);
