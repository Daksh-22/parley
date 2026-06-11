import { useChatState } from '../state/use-chat';

export function ConnectionToast() {
  const connection = useChatState((s) => s.connection);
  if (connection === 'connected') return null;

  const copy = {
    connecting: 'Connecting',
    reconnecting: 'Connection lost. Reconnecting',
    offline: 'Offline. Waiting to reconnect',
  }[connection];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-hairline bg-panel px-4 py-2 text-[13px] text-text-primary shadow-overlay"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
      {copy}
    </div>
  );
}
