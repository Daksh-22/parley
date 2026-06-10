import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface DocumentFields {
  roomId: Types.ObjectId;
  uploaderId: Types.ObjectId;
  filename: string;
  mimetype: string;
  size: number;
  status: 'processing' | 'ready' | 'failed';
  chunkCount: number;
  error: string | null;
  // Raw text is kept so re-indexing never needs the original file.
  text: string;
  // Page boundaries as character offsets into text, for pdf page citations.
  pageOffsets: number[];
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentDoc = HydratedDocument<DocumentFields>;

const documentSchema = new Schema<DocumentFields>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
    chunkCount: { type: Number, default: 0 },
    error: { type: String, default: null },
    text: { type: String, default: '' },
    pageOffsets: { type: [Number], default: [] },
  },
  { timestamps: true },
);

// Listing documents per room, newest first.
documentSchema.index({ roomId: 1, _id: -1 });

export const DocumentModel = model('Document', documentSchema);
