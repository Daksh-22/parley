import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { objectIdSchema, type DocumentWire } from '@parley/shared';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { requireAuth } from '../../auth/middleware.js';
import { Membership } from '../../models/membership.model.js';
import { DocumentModel, type DocumentDoc } from '../../models/document.model.js';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, parseUpload } from '../../ai/ingest/parse-doc.js';
import { enqueueDocIngest } from '../../ai/ingest/queue.js';

export const documentsRouter = Router();
documentsRouter.use('/rooms/:id/documents', requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const listQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function toDocumentWire(doc: DocumentDoc): DocumentWire {
  return {
    id: doc._id.toHexString(),
    roomId: doc.roomId.toHexString(),
    filename: doc.filename,
    size: doc.size,
    status: doc.status,
    chunkCount: doc.chunkCount,
    error: doc.error,
    createdAt: doc.createdAt.toISOString(),
  };
}

async function requireMembership(userId: string, roomId: string): Promise<void> {
  const member = await Membership.exists({ userId, roomId });
  if (!member) throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room');
}

// Extension fallback because browsers send text/plain for .md files sometimes.
function effectiveMimetype(filename: string, mimetype: string): string {
  if (mimetype === 'application/octet-stream' || mimetype === 'text/x-markdown') {
    if (filename.endsWith('.md')) return 'text/markdown';
    if (filename.endsWith('.txt')) return 'text/plain';
    if (filename.endsWith('.pdf')) return 'application/pdf';
  }
  return mimetype;
}

documentsRouter.post('/rooms/:id/documents', upload.single('file'), async (req, res) => {
  if (!env.AI_ENABLED) {
    throw new HttpError(503, 'AI_UNAVAILABLE', 'Memory features are turned off on this server');
  }
  const userId = req.userId as string;
  const roomId = parseOrThrow(objectIdSchema, req.params.id);
  await requireMembership(userId, roomId);

  const file = req.file;
  if (!file) throw new HttpError(400, 'VALIDATION', 'Attach one file under the "file" field');
  const mimetype = effectiveMimetype(file.originalname, file.mimetype);
  if (!ALLOWED_UPLOAD_TYPES.has(mimetype)) {
    throw new HttpError(400, 'UNSUPPORTED_TYPE', 'Only pdf, md, and txt files are supported');
  }

  let parsed;
  try {
    parsed = await parseUpload(file.buffer, mimetype);
  } catch {
    throw new HttpError(400, 'PARSE_FAILED', 'The file could not be read. Try a different export');
  }
  if (parsed.text.trim().length === 0) {
    throw new HttpError(400, 'EMPTY_DOCUMENT', 'The file contains no extractable text');
  }

  const doc = await DocumentModel.create({
    roomId,
    uploaderId: userId,
    filename: file.originalname.slice(0, 200),
    mimetype,
    size: file.size,
    status: 'processing',
    text: parsed.text,
    pageOffsets: parsed.pageOffsets,
  });
  await enqueueDocIngest(doc._id.toHexString());
  res.status(201).json({ document: toDocumentWire(doc) });
});

documentsRouter.get('/rooms/:id/documents', async (req, res) => {
  const userId = req.userId as string;
  const roomId = parseOrThrow(objectIdSchema, req.params.id);
  await requireMembership(userId, roomId);
  const { cursor, limit } = parseOrThrow(listQuerySchema, req.query);

  const docs = await DocumentModel.find({
    roomId,
    ...(cursor ? { _id: { $lt: cursor } } : {}),
  })
    .sort({ _id: -1 })
    .limit(limit + 1);
  const page = docs.slice(0, limit);
  res.json({
    documents: page.map(toDocumentWire),
    nextCursor: docs.length > limit ? page[page.length - 1]?._id.toHexString() : null,
  });
});
