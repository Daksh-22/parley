import { Fragment, type ReactNode } from 'react';
import type { Citation } from '@parley/shared';

// Renders AI answer text as a safe markdown subset built from React nodes:
// paragraphs, lists, bold, italic, inline code, and [n] citation chips.
// No HTML is ever parsed or injected; React escaping is the sanitizer.

interface Props {
  text: string;
  citations?: Citation[];
  onCitationClick?: (citation: Citation) => void;
}

function renderInline(
  text: string,
  citations: Citation[] | undefined,
  onCitationClick: ((c: Citation) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  // Tokenize on citations, bold, italic, and code spans.
  const pattern = /(\[\d{1,2}\])|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}-${i}`;
    i += 1;
    if (token.startsWith('[')) {
      const n = Number(token.slice(1, -1));
      const citation = citations?.find((c) => c.index === n);
      if (citation) {
        nodes.push(
          // Signature wash, place one of five: citation chips.
          <button
            key={key}
            onClick={() => onCitationClick?.(citation)}
            title={citation.snippet}
            aria-label={`Source ${n}: ${citation.snippet.slice(0, 80)}`}
            className="tabular mx-px inline-flex -translate-y-[3px] items-center rounded-full bg-wash px-1.5 font-mono text-[10px] font-medium text-text-primary transition-opacity duration-120 hover:opacity-80"
          >
            {n}
          </button>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(
        <code key={key} className="rounded bg-row-hover px-1 font-mono text-[12px]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function AiMarkdown({ text, citations, onCitationClick }: Props) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-[14px] leading-[1.55] text-text-primary">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^[-*] /.test(l.trim()) || l.trim() === '');
        if (isList) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {lines
                .filter((l) => l.trim())
                .map((line, lineIndex) => (
                  <li key={lineIndex}>
                    {renderInline(
                      line.trim().replace(/^[-*] /, ''),
                      citations,
                      onCitationClick,
                      `${blockIndex}-${lineIndex}`,
                    )}
                  </li>
                ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(line, citations, onCitationClick, `${blockIndex}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
