import { useChatState } from '../state/use-chat';

/**
 * Fixed-height row so the indicator appearing or disappearing never shifts
 * the message list layout.
 */
export function TypingRow({ roomId }: { roomId: string }) {
  const typing = useChatState((s) => s.rooms.get(roomId)?.typing);
  const members = useChatState((s) => s.rooms.get(roomId)?.members);

  const names = [...(typing?.keys() ?? [])]
    .map((userId) => members?.get(userId)?.displayName ?? 'Someone')
    .slice(0, 3);

  let label = '';
  if (names.length === 1) label = `${names[0]} is typing`;
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing`;
  else if (names.length > 2) label = 'Several people are typing';

  return (
    <div
      aria-live="polite"
      className="flex h-6 items-center gap-1.5 px-4 text-xs text-text-secondary"
    >
      {label && (
        <>
          <span aria-hidden="true" className="inline-flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted [animation-delay:0ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted [animation-delay:120ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted [animation-delay:240ms]" />
          </span>
          {label}
        </>
      )}
    </div>
  );
}
