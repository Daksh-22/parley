import { PDFParse } from 'pdf-parse';

export interface ParsedUpload {
  text: string;
  // Character offsets where each page begins, for pdf page citations.
  pageOffsets: number[];
}

export const ALLOWED_UPLOAD_TYPES = new Set(['application/pdf', 'text/markdown', 'text/plain']);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function parseUpload(buffer: Buffer, mimetype: string): Promise<ParsedUpload> {
  if (mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const pageOffsets: number[] = [];
      let text = '';
      for (const page of result.pages) {
        pageOffsets.push(text.length);
        text += `${page.text}\n\n`;
      }
      return { text: text.trim(), pageOffsets };
    } finally {
      await parser.destroy();
    }
  }
  // Markdown and plain text are already text.
  return { text: buffer.toString('utf8'), pageOffsets: [] };
}
