import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Hash, Sparkles } from 'lucide-react';
import { useChatState } from '../state/use-chat';
import {
  askGlobal,
  dismissAiStream,
  jumpToCitation,
  openRoom,
  sendMessage,
} from '../state/chat-store';
import { SUGGESTED_QUESTIONS } from '../lib/suggestions';
import { AiMarkdown } from './AiMarkdown';
import { FeedbackThumbs } from './FeedbackThumbs';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rooms = useChatState((s) => s.rooms);
  const roomOrder = useChatState((s) => s.roomOrder);
  const activeRoomId = useChatState((s) => s.activeRoomId);
  const stream = useChatState((s) => (streamId ? s.aiStreams.get(streamId) : undefined));

  useEffect(() => {
    if (open) {
      setQuery('');
      setStreamId(null);
      setAskError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = query.trim();
  const matchingRooms = trimmed
    ? roomOrder
        .map((id) => rooms.get(id)?.room)
        .filter((r) => r && r.name.toLowerCase().includes(trimmed.toLowerCase()))
        .slice(0, 4)
    : [];

  async function ask(question: string): Promise<void> {
    setAskError(null);
    if (streamId) dismissAiStream(streamId);
    const ack = await askGlobal(question);
    if (ack.ok) {
      setStreamId(ack.data.streamId);
    } else {
      setAskError(ack.error.message);
    }
  }

  function continueInRoom(): void {
    if (!stream || !activeRoomId) return;
    void sendMessage(activeRoomId, `@recall ${stream.question}`);
    cleanupAndClose();
  }

  function cleanupAndClose(): void {
    if (streamId) dismissAiStream(streamId);
    onClose();
  }

  const activeRoomName = activeRoomId ? rooms.get(activeRoomId)?.room.name : null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Ask anything">
      <button
        aria-label="Close"
        onClick={cleanupAndClose}
        className="absolute inset-0 cursor-default bg-text-primary/20"
      />
      <div className="absolute top-[15%] left-1/2 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border border-hairline bg-panel shadow-overlay">
        <div className="flex items-center gap-2 border-b border-hairline px-4">
          <Sparkles
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-text-secondary"
          />
          <label htmlFor="palette-input" className="sr-only">
            Search rooms or ask a question
          </label>
          <input
            id="palette-input"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed.length >= 3) void ask(trimmed);
            }}
            placeholder="Search rooms or ask your team's memory"
            className="h-12 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
          <kbd className="font-mono text-[11px] text-text-secondary">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {/* Room results */}
          {matchingRooms.length > 0 && (
            <>
              <p className="eyebrow px-2 pt-1 pb-1">Rooms</p>
              {matchingRooms.map(
                (room) =>
                  room && (
                    <button
                      key={room.id}
                      onClick={() => {
                        void openRoom(room.id);
                        cleanupAndClose();
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-text-primary transition-colors duration-120 hover:bg-row-hover"
                    >
                      <Hash
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        className="text-text-secondary"
                      />
                      {room.name}
                      <span className="ml-auto font-mono text-[11px] text-text-secondary">
                        open
                      </span>
                    </button>
                  ),
              )}
            </>
          )}

          {/* Ask action */}
          {trimmed.length >= 3 && (
            <>
              <p className="eyebrow px-2 pt-2 pb-1">Ask</p>
              <button
                onClick={() => void ask(trimmed)}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-text-primary transition-colors duration-120 hover:bg-row-hover"
              >
                <Sparkles
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="text-accent-ink"
                />
                <span className="min-w-0 truncate">Ask Recall: {trimmed}</span>
                <kbd className="ml-auto flex items-center gap-1 font-mono text-[11px] text-text-secondary">
                  <CornerDownLeft size={11} strokeWidth={1.5} aria-hidden="true" />
                  enter
                </kbd>
              </button>
            </>
          )}

          {/* Empty state with working suggestions */}
          {!trimmed && !stream && !askError && (
            <div className="px-2 py-6 text-center">
              <p className="font-display text-lg font-medium text-text-primary">
                Ask your team's memory
              </p>
              <p className="mt-1 text-[13px] text-text-secondary">
                Every answer cites the messages it came from.
              </p>
              <div className="mt-4 flex flex-col items-stretch gap-1.5">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuery(q);
                      void ask(q);
                    }}
                    className="rounded-md border border-hairline px-3 py-2 text-left text-[13px] text-text-primary transition-colors duration-120 hover:bg-row-hover"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ask error (quota, breaker, offline) */}
          {askError && (
            <div className="px-3 py-4">
              <p className="text-[13px] text-danger">{askError}</p>
            </div>
          )}

          {/* Streaming answer, marginalia treatment */}
          {stream && (
            <div className="mx-2 my-2 border-l-2 border-accent-ink py-1 pl-3">
              <p className="flex items-baseline gap-2">
                <span className="font-display text-[15px] italic text-accent-ink">Recall</span>
                <span className="min-w-0 truncate text-[12px] text-text-secondary">
                  {stream.question}
                </span>
                {stream.status === 'done' && <FeedbackThumbs streamId={stream.streamId} />}
              </p>
              <div
                className={`mt-1 min-h-[22px] ${stream.status === 'streaming' ? 'stream-caret' : ''}`}
              >
                {stream.status === 'error' ? (
                  <p className="text-[13px] text-danger">{stream.errorMessage}</p>
                ) : (
                  <AiMarkdown
                    text={stream.text}
                    citations={stream.citations}
                    onCitationClick={(c) => {
                      void jumpToCitation(c);
                      cleanupAndClose();
                    }}
                  />
                )}
              </div>
              {stream.status === 'done' && (
                <div className="mt-2 flex items-center gap-2">
                  {stream.citations && stream.citations.length > 0 && (
                    <span className="font-mono text-[11px] text-text-secondary uppercase">
                      {stream.citations.length}{' '}
                      {stream.citations.length === 1 ? 'source' : 'sources'}
                    </span>
                  )}
                  {activeRoomName && (
                    <button
                      onClick={continueInRoom}
                      className="ml-auto rounded-md bg-text-primary px-2.5 py-1 text-[12px] font-semibold text-ground transition-opacity duration-120 hover:opacity-90"
                    >
                      Continue in #{activeRoomName}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
