import { createHash, randomBytes } from 'node:crypto';
import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

// Personal access tokens for the MCP server: scoped read-only, revocable,
// stored only as a hash. The plaintext is shown exactly once at creation.

export interface PatFields {
  userId: Types.ObjectId;
  name: string;
  tokenHash: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PatDoc = HydratedDocument<PatFields>;

const patSchema = new Schema<PatFields>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 64 },
    tokenHash: { type: String, required: true, unique: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

patSchema.index({ userId: 1 });

export const Pat = model('Pat', patSchema);

export function generatePatPlaintext(): string {
  return `pat_${randomBytes(24).toString('hex')}`;
}

export function hashPat(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
