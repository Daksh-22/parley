// Builds a minimal valid one-page PDF containing the given text, with a
// correct xref table. Text is wrapped into lines that fit the page width;
// extractors drop glyphs positioned outside the MediaBox, so a single long
// run would silently truncate. Enough for pdfjs-based parsers; no dependency.

const LINE_CHARS = 80;
const LINE_HEIGHT = 16;

function wrapText(text: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > LINE_CHARS && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function buildPdf(text: string): Buffer {
  const escape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines = wrapText(text);
  const body =
    `BT /F1 12 Tf 72 720 Td ${LINE_HEIGHT} TL ` +
    lines.map((line, i) => `(${escape(line)}) Tj${i < lines.length - 1 ? ' T*' : ''}`).join(' ') +
    ' ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((content, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefStart = out.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(out + xref + trailer, 'latin1');
}
