import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface MessageFields {
  roomId: Types.ObjectId;
  senderId: Types.ObjectId;
  body: string;
  // Client-generated uuid. The unique (senderId, clientMsgId) index makes
  // message sends idempotent: at-least-once delivery, exactly-once persistence.
  clientMsgId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDoc = HydratedDocument<MessageFields>;

const messageSchema = new Schema<MessageFields>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    clientMsgId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);

// Cursor pagination: newest first within a room, tie-broken by _id.
messageSchema.index({ roomId: 1, createdAt: -1, _id: -1 });
// Idempotent dedup for at-least-once sends.
messageSchema.index({ senderId: 1, clientMsgId: 1 }, { unique: true });

export const Message = model('Message', messageSchema);
