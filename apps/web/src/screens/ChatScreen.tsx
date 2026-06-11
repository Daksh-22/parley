import { useEffect } from 'react';
import { Menu } from 'lucide-react';
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
      <p className="font-display text-2xl font-medium text-text-primary">
        An archive you can question
      </p>
      <p className="max-w-sm text-[13px] text-text-secondary">
        Pick a room from the sidebar, or create one with the plus button.
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <button
          onClick={() => toggleSidebar(true)}
          aria-label="Open room list"
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-row-hover hover:text-text-primary md:hidden"
        >
          <Menu size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <span aria-hidden="true" className="font-mono text-text-secondary">
          #
        </span>
        <h2 className="min-w-0 truncate text-[13px] font-semibold text-text-primary">
          {room.name}
        </h2>
        {members && members.size > 0 && (
          <p className="tabular ml-auto shrink-0 font-mono text-[11px] text-text-secondary">
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
    <div className="flex h-full bg-ground">
      <aside className="hidden shrink-0 border-r border-hairline md:block">
        <Sidebar />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close room list"
            onClick={() => toggleSidebar(false)}
            className="absolute inset-0 bg-text-primary/20"
          />
          <aside className="absolute inset-y-0 left-0 border-r border-hairline bg-ground shadow-overlay">
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
