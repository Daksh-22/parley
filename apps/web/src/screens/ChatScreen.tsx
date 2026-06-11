import { useEffect, useState } from 'react';
import { ListTodo, Menu, Settings2 } from 'lucide-react';
import { useChatState } from '../state/use-chat';
import { getState, openRoom, toggleSidebar } from '../state/chat-store';
import { Sidebar } from '../components/Sidebar';
import { MessageList } from '../components/MessageList';
import { TypingRow } from '../components/TypingRow';
import { Composer } from '../components/Composer';
import { ConnectionToast } from '../components/ConnectionToast';
import { CommandPalette } from '../components/CommandPalette';
import { CatchUpPill, CatchupBlock } from '../components/CatchUp';
import { DecisionsPanel } from '../components/DecisionsPanel';
import { RoomSettings } from '../components/RoomSettings';

function NoRoomSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="font-display text-2xl font-medium text-text-primary">
        An archive you can question
      </p>
      <p className="max-w-sm text-[13px] text-text-secondary">
        Pick a room from the sidebar, or press cmd+k to ask your team's memory.
      </p>
    </div>
  );
}

function RoomView({ roomId }: { roomId: string }) {
  const room = useChatState((s) => s.rooms.get(roomId)?.room);
  const members = useChatState((s) => s.rooms.get(roomId)?.members);
  const online = useChatState((s) => s.online);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setDecisionsOpen(false);
    setSettingsOpen(false);
  }, [roomId]);

  if (!room) return <NoRoomSelected />;

  const onlineCount = [...(members?.keys() ?? [])].filter((id) => online.has(id)).length;

  return (
    <div className="flex h-full min-w-0">
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
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
            <p className="tabular ml-auto hidden shrink-0 font-mono text-[11px] text-text-secondary sm:block">
              {members.size} {members.size === 1 ? 'member' : 'members'}
              {onlineCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                  {onlineCount} online
                </span>
              )}
            </p>
          )}
          <button
            onClick={() => setDecisionsOpen((v) => !v)}
            aria-label="Decisions"
            aria-expanded={decisionsOpen}
            title="Decisions"
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-120 hover:bg-row-hover ${
              decisionsOpen ? 'text-text-primary' : 'text-text-secondary'
            } ${members && members.size > 0 ? '' : 'ml-auto'}`}
          >
            <ListTodo size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Room settings"
            aria-expanded={settingsOpen}
            title="Room settings"
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-120 hover:bg-row-hover ${
              settingsOpen ? 'text-text-primary' : 'text-text-secondary'
            }`}
          >
            <Settings2 size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>
        <RoomSettings roomId={roomId} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <div className="min-h-0 flex-1">
          <MessageList roomId={roomId} />
        </div>
        <CatchUpPill roomId={roomId} />
        <CatchupBlock roomId={roomId} />
        <TypingRow roomId={roomId} />
        <Composer roomId={roomId} roomName={room.name} />
      </div>
      <DecisionsPanel
        roomId={roomId}
        open={decisionsOpen}
        onClose={() => setDecisionsOpen(false)}
      />
    </div>
  );
}

export function ChatScreen() {
  const activeRoomId = useChatState((s) => s.activeRoomId);
  const sidebarOpen = useChatState((s) => s.sidebarOpen);
  const roomOrder = useChatState((s) => s.roomOrder);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // First load: land in the first room you are a member of (seeded #general).
  useEffect(() => {
    if (activeRoomId || roomOrder.length === 0) return;
    const rooms = getState().rooms;
    const first = roomOrder.find((id) => rooms.get(id)?.room.isMember) ?? roomOrder[0];
    if (first) void openRoom(first);
  }, [activeRoomId, roomOrder]);

  // cmd+k or ctrl+k opens the palette; Escape closes the slide-over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape') toggleSidebar(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ConnectionToast />
    </div>
  );
}
