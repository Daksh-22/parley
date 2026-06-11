import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { sendMessage, notifyTyping, stopTyping } from '../state/chat-store';

const MAX_LENGTH = 2000;
// Six lines of 14px body at 1.55 line height.
const MAX_HEIGHT_PX = 132;

export function Composer({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  const typing = value.length > 0;

  return (
    // Quiet until focused: a hairline top border, no boxed card.
    <div className="border-t border-hairline px-4 pt-3 pb-2">
      <div className="flex items-end gap-2">
        <label htmlFor="composer" className="sr-only">
          Message {roomName}
        </label>
        <textarea
          id="composer"
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={MAX_LENGTH + 100}
          placeholder={`Message #${roomName}, or @recall a question`}
          onChange={(e) => {
            setValue(e.target.value);
            autogrow();
            if (e.target.value.trim()) notifyTyping(roomId);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => stopTyping(roomId)}
          className="max-h-[132px] min-h-[24px] flex-1 resize-none bg-transparent text-[14px] leading-[1.55] text-text-primary placeholder:text-text-secondary focus:outline-none"
        />
        {remaining < 200 && (
          <span
            aria-live="polite"
            className={`tabular pb-1 font-mono text-[11px] ${remaining < 0 ? 'text-danger' : 'text-text-secondary'}`}
          >
            {remaining}
          </span>
        )}
        <button
          onClick={submit}
          disabled={!value.trim() || value.length > MAX_LENGTH}
          aria-label="Send"
          title="Send (Enter)"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-text-primary text-ground transition-opacity duration-120 hover:opacity-90 disabled:bg-transparent disabled:text-text-secondary"
        >
          <SendHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <p
        aria-hidden="true"
        className={`mt-1 hidden font-mono text-[11px] text-text-secondary transition-opacity duration-240 sm:block ${
          typing ? 'opacity-0' : 'opacity-100'
        }`}
      >
        enter to send, shift+enter for a new line, cmd+k to ask
      </p>
    </div>
  );
}
