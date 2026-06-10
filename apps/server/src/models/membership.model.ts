import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface MembershipFields {
  userId: Types.ObjectId;
  roomId: Types.ObjectId;
  // Read state lives here as a cursor, never as arrays on messages. Unread
  // counts derive from "messages in room newer than lastReadMessageId".
  lastReadMessageId: Types.ObjectId | null;
  lastReadAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MembershipDoc = HydratedDocument<MembershipFields>;

const membershipSchema = new Schema<MembershipFields>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    lastReadMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    lastReadAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One membership per user per room.
membershipSchema.index({ userId: 1, roomId: 1 }, { unique: true });
// Listing the members of a room.
membershipSchema.index({ roomId: 1 });

export const Membership = model('Membership', membershipSchema);
