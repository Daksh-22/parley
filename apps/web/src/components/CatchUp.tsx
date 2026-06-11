import { useState } from 'react';
import { X } from 'lucide-react';
import { useChatState } from '../state/use-chat';
import { clearCatchup, dismissAiStream, jumpToCitation, requestCatchup } from '../state/chat-store';
import { AiMarkdown } from './AiMarkdown';
import { FeedbackThumbs } from './FeedbackThumbs';

/**
 * The one-tap digest. The pill is one of the five highlighter wash sites;
 * the digest itself renders as private marginalia pinned above the composer.
 * The unread window was captured at room open, before reading the room
 * advanced the cursor.
 */
export function CatchUpPill({ roomId }: { roomId: string }) {
  const available = useChatState((s) => s.rooms.get(roomId)?.catchupAvailable) ?? 0;
  const aiEnabled = useChatState((s) => s.rooms.get(roomId)?.room.aiEnabled) ?? true;
  const [error, setError] = useState<string | null>(null);

  if (available < 1 || !aiEnabled) {
    if (error) {
      return (
        <p role="alert" className="px-4 pb-1 text-[12px] text-danger">
          {error}
        </p>
      );
    }
    return null;
  }

  async function catchup(): Promise<void> {
    const ack = await requestCatchup(roomId);
    if (!ack.ok) {
      setError(ack.error.message);
    } else {
      setError(null);
    }
    clearCatchup(roomId);
  }

  return (
    <div className="flex justify-center pb-1">
      <button
        onClick={() => void catchup()}
        className="tabular rounded-full bg-wash px-3 py-1.5 font-mono text-[11px] font-medium text-text-primary transition-opacity duration-120 hover:opacity-85"
      >
        Catch me up · {available > 99 ? '99+' : available} unread
      </button>
    </div>
  );
}

/** Renders the private catchup digest stream for this room, dismissible. */
export function CatchupBlock({ roomId }: { roomId: string }) {
  const aiStreams = useChatState((s) => s.aiStreams);
  const stream = [...aiStreams.values()].find((s) => s.scope === 'catchup' && s.roomId === roomId);
  if (!stream) return null;

  return (
    <div className="mx-4 mb-2 max-h-[40vh] overflow-y-auto rounded-md border border-hairline bg-panel p-3">
      <div className="border-l-2 border-accent-ink pl-3">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-[15px] italic text-accent-ink">Recall</span>
          <span className="text-[12px] text-text-secondary">while you were away</span>
          {stream.status === 'done' && <FeedbackThumbs streamId={stream.streamId} />}
          <button
            onClick={() => dismissAiStream(stream.streamId)}
            aria-label="Dismiss digest"
            className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </p>
        <div className={`mt-1 min-h-[22px] ${stream.status === 'streaming' ? 'stream-caret' : ''}`}>
          {stream.status === 'error' ? (
            <p className="text-[13px] text-danger">{stream.errorMessage}</p>
          ) : (
            <AiMarkdown
              text={stream.text}
              citations={stream.citations}
              onCitationClick={(c) => void jumpToCitation(c)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
