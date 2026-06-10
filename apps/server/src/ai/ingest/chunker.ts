// Document chunking: roughly 500 tokens per chunk (about 2000 characters at
// the 4 chars per token heuristic) with 15 percent overlap so a sentence
// split across a boundary still retrieves. Paragraph boundaries are
// preferred; oversized paragraphs fall back to a hard character split.

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = Math.round(CHUNK_CHARS * 0.15);

export interface DocChunk {
  text: string;
  /** 1-based page number for pdf citations; 1 for plain text and markdown. */
  page: number;
}

export function chunkDocument(text: string, pageOffsets: number[]): DocChunk[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const chunks: DocChunk[] = [];
  const paragraphs = clean.split(/\n{2,}/);
  let buffer = '';
  let bufferStart = 0;
  let cursor = 0;

  const flush = (): void => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      chunks.push({ text: trimmed, page: pageForOffset(bufferStart, pageOffsets) });
    }
  };

  for (const paragraph of paragraphs) {
    const start = clean.indexOf(paragraph, cursor);
    cursor = start + paragraph.length;

    if (paragraph.length > CHUNK_CHARS) {
      // Oversized paragraph: flush what we have, then hard-split it.
      flush();
      buffer = '';
      for (let i = 0; i < paragraph.length; i += CHUNK_CHARS - OVERLAP_CHARS) {
        const piece = paragraph.slice(i, i + CHUNK_CHARS);
        chunks.push({ text: piece.trim(), page: pageForOffset(start + i, pageOffsets) });
        if (i + CHUNK_CHARS >= paragraph.length) break;
      }
      bufferStart = cursor;
      continue;
    }

    if (buffer.length + paragraph.length + 2 > CHUNK_CHARS) {
      flush();
      // Carry the overlap tail into the next chunk for boundary continuity.
      buffer = buffer.slice(-OVERLAP_CHARS) + '\n\n' + paragraph;
      bufferStart = Math.max(0, cursor - paragraph.length - OVERLAP_CHARS);
    } else {
      if (buffer.length === 0) bufferStart = start;
      buffer = buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  flush();
  return chunks.filter((c) => c.text.length > 0);
}

function pageForOffset(offset: number, pageOffsets: number[]): number {
  if (pageOffsets.length === 0) return 1;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i += 1) {
    const boundary = pageOffsets[i];
    if (boundary !== undefined && offset >= boundary) page = i + 1;
  }
  return page;
}
