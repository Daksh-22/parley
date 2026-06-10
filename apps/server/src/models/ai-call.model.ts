import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

// Structured log of every AI call: the source of truth for pnpm ai:metrics,
// quota accounting audits, and the feedback flywheel export.

export interface AiCallFields {
  streamId: string;
  userId: Types.ObjectId;
  kind: 'room-ask' | 'global-ask' | 'catchup' | 'decisions' | 'rerank';
  provider: string;
  model: string;
  question: string;
  answer: string;
  sourceKeys: string[];
  retrievalHits: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  cached: boolean;
  ok: boolean;
  errorCode: string | null;
  verdict: 'up' | 'down' | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AiCallDoc = HydratedDocument<AiCallFields>;

const aiCallSchema = new Schema<AiCallFields>(
  {
    streamId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: {
      type: String,
      enum: ['room-ask', 'global-ask', 'catchup', 'decisions', 'rerank'],
      required: true,
    },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    question: { type: String, default: '' },
    answer: { type: String, default: '' },
    sourceKeys: { type: [String], default: [] },
    retrievalHits: { type: Number, default: 0 },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    cached: { type: Boolean, default: false },
    ok: { type: Boolean, default: true },
    errorCode: { type: String, default: null },
    verdict: { type: String, enum: ['up', 'down', null], default: null },
  },
  { timestamps: true },
);

// Metrics scans by time window.
aiCallSchema.index({ createdAt: -1 });

export const AiCall = model('AiCall', aiCallSchema);
