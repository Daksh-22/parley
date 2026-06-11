import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { sendAiFeedback } from '../state/chat-store';

/** Thumbs on every AI answer; feeds the eval candidate set. */
export function FeedbackThumbs({ streamId }: { streamId: string }) {
  const [verdict, setVerdict] = useState<'up' | 'down' | null>(null);

  function vote(next: 'up' | 'down'): void {
    setVerdict(next);
    void sendAiFeedback(streamId, next);
  }

  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
      <button
        onClick={() => vote('up')}
        aria-label="Mark answer helpful"
        aria-pressed={verdict === 'up'}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-120 hover:bg-row-hover ${
          verdict === 'up' ? 'text-accent-ink' : 'text-text-secondary'
        }`}
      >
        <ThumbsUp size={13} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        onClick={() => vote('down')}
        aria-label="Mark answer unhelpful"
        aria-pressed={verdict === 'down'}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-120 hover:bg-row-hover ${
          verdict === 'down' ? 'text-danger' : 'text-text-secondary'
        }`}
      >
        <ThumbsDown size={13} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </span>
  );
}
