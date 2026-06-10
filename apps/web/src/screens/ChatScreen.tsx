import { useEffect } from 'react';
import { useChatState } from '../state/use-chat';
import { getState, openRoom, toggleSidebar } from '../state/chat-store';
import { Sidebar } from '../components/Sidebar';
import { MessageList } from '../components/MessageList';
import { TypingRow } from '../components/TypingRow';
import { Composer } from '../components/Composer';
import { ConnectionToast } from '../components/ConnectionToast';

function NoRoomSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect
          x="6"
          y="10"
          width="36"
          height="26"
          rx="6"
          stroke="var(--p-border-strong)"
          strokeWidth="2"
        />
        <path
          d="M17 38l5-5"
          stroke="var(--p-border-strong)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M15 20h18M15 26h10"
          stroke="var(--p-text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-sm font-semibold text-text-primary">Pick a room to start talking</p>
      <p className="max-w-xs text-sm text-text-secondary">
        Choose a room from the sidebar, or create a new one with the plus button.
      </p>
    </div>
  );
}

function RoomView({ roomId }: { roomId: string }) {
  const room = useChatState((s) => s.rooms.get(roomId)?.room);
  const members = useChatState((s) => s.rooms.get(roomId)?.members);
  const online = useChatState((s) => s.online);
  if (!room) return <NoRoomSelected />;

  const onlineCount = [...(members?.keys() ?? [])].filter((id) => online.has(id)).length;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <button
          onClick={() => toggleSidebar(true)}
          aria-label="Open room list"
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-2 hover:text-text-primary md:hidden"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M2 8h12M2 12h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span aria-hidden="true" className="font-mono text-text-muted">
          #
        </span>
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">{room.name}</h2>
        {members && members.size > 0 && (
          <p className="ml-auto shrink-0 text-xs text-text-muted">
            {members.size} {members.size === 1 ? 'member' : 'members'}
            {onlineCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                {onlineCount} online
              </span>
            )}
          </p>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <MessageList roomId={roomId} />
      </div>
      <TypingRow roomId={roomId} />
      <Composer roomId={roomId} roomName={room.name} />
    </div>
  );
}

export function ChatScreen() {
  const activeRoomId = useChatState((s) => s.activeRoomId);
  const sidebarOpen = useChatState((s) => s.sidebarOpen);
  const roomOrder = useChatState((s) => s.roomOrder);

  // First load: land in the first room you are a member of (seeded #general).
  useEffect(() => {
    if (activeRoomId || roomOrder.length === 0) return;
    const rooms = getState().rooms;
    const first = roomOrder.find((id) => rooms.get(id)?.room.isMember) ?? roomOrder[0];
    if (first) void openRoom(first);
  }, [activeRoomId, roomOrder]);

  // Escape closes the mobile slide-over.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') toggleSidebar(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex h-full bg-surface-0">
      {/* Static sidebar on md and up */}
      <aside className="hidden w-60 shrink-0 border-r border-border-subtle md:block">
        <Sidebar />
      </aside>

      {/* Slide-over sidebar on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close room list"
            onClick={() => toggleSidebar(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border-subtle shadow-xl">
            <Sidebar />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1" aria-label="Conversation">
        <RoomView roomId={activeRoomId ?? ''} />
      </main>

      <ConnectionToast />
    </div>
  );
}
