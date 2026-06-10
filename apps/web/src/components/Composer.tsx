import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { sendMessage, notifyTyping, stopTyping } from '../state/chat-store';

const MAX_LENGTH = 2000;
const MAX_HEIGHT_PX = 160;

export function Composer({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset draft when switching rooms; stop any dangling typing signal.
  useEffect(() => {
    setValue('');
    return () => stopTyping(roomId);
  }, [roomId]);

  function autogrow(): void {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }

  function submit(): void {
    const body = value.trim();
    if (!body || body.length > MAX_LENGTH) return;
    setValue('');
    stopTyping(roomId);
    requestAnimationFrame(autogrow);
    void sendMessage(roomId, body);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const remaining = MAX_LENGTH - value.length;

  return (
    <div className="border-t border-border-subtle bg-surface-1 px-4 py-3">
      <div className="flex items-end gap-2 rounded-lg border border-border-subtle bg-surface-0 px-3 py-2 focus-within:border-accent">
        <label htmlFor="composer" className="sr-only">
          Message {roomName}
        </label>
        <textarea
          id="composer"
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={MAX_LENGTH + 100}
          placeholder={`Message #${roomName}`}
          onChange={(e) => {
            setValue(e.target.value);
            autogrow();
            if (e.target.value.trim()) notifyTyping(roomId);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => stopTyping(roomId)}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-6 text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {remaining < 200 && (
          <span
            aria-live="polite"
            className={`pb-0.5 font-mono text-[11px] ${remaining < 0 ? 'text-danger' : 'text-text-muted'}`}
          >
            {remaining}
          </span>
        )}
        <button
          onClick={submit}
          disabled={!value.trim() || value.length > MAX_LENGTH}
          aria-label="Send message"
          title="Send (Enter)"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-soft disabled:text-text-muted disabled:hover:bg-transparent"
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path
              d="M13.5 1.5 7 8M13.5 1.5 9.25 13.5l-2.25-5.5L1.5 5.75 13.5 1.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 hidden text-[11px] text-text-muted sm:block">
        Enter to send, Shift+Enter for a new line
      </p>
    </div>
  );
}
