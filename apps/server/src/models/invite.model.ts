import { createHash, randomBytes } from 'node:crypto';
import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

// Room invite links: expiring, redemption-limited, revocable. The token is
// stored only as a hash; the full link is shown at creation.

export interface InviteFields {
  roomId: Types.ObjectId;
  createdBy: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  maxRedemptions: number;
  redemptionCount: number;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InviteDoc = HydratedDocument<InviteFields>;

const inviteSchema = new Schema<InviteFields>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    maxRedemptions: { type: Number, required: true },
    redemptionCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

inviteSchema.index({ roomId: 1 });

export const Invite = model('Invite', inviteSchema);

export function generateInviteToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
