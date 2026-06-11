import { useState, type FormEvent } from 'react';
import { Plus, LogOut } from 'lucide-react';
import { useAuth } from '../state/auth';
import { useChatState } from '../state/use-chat';
import { createRoom, openRoom, getMe } from '../state/chat-store';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';
import { UserSettings } from './UserSettings';

function RoomRow({ roomId }: { roomId: string }) {
  const roomState = useChatState((s) => s.rooms.get(roomId));
  const isActive = useChatState((s) => s.activeRoomId === roomId);
  const online = useChatState((s) => s.online);
  if (!roomState) return null;
  const { room, members } = roomState;
  const me = getMe();

  const someoneOnline = [...members.keys()].some((id) => id !== me?.id && online.has(id));

  return (
    <li>
      <button
        onClick={() => void openRoom(roomId)}
        aria-current={isActive ? 'true' : undefined}
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors duration-120 ${
          isActive
            ? 'bg-panel font-semibold text-text-primary'
            : 'text-text-secondary hover:bg-row-hover hover:text-text-primary'
        }`}
      >
        <span aria-hidden="true" className="font-mono text-text-secondary">
          #
        </span>
        <span className="min-w-0 flex-1 truncate">{room.name}</span>
        {someoneOnline && (
          <span
            title="Someone is online"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
          />
        )}
        {room.unreadCount > 0 && !isActive && (
          // Signature wash, place three of five: unread chips.
          <span className="tabular shrink-0 rounded-full bg-wash px-1.5 py-px font-mono text-[11px] font-medium text-text-primary">
            {room.unreadCount > 99 ? '99+' : room.unreadCount}
          </span>
        )}
      </button>
    </li>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const roomOrder = useChatState((s) => s.roomOrder);
  const online = useChatState((s) => s.online);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const result = await createRoom(name);
    if (result.ok) {
      setNewName('');
      setCreating(false);
      setCreateError(null);
    } else {
      setCreateError(result.error ?? 'Could not create the room. Try a different name');
    }
  }

  return (
    <nav aria-label="Rooms" className="flex h-full w-[264px] flex-col bg-ground">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h1 className="font-display text-[17px] font-medium tracking-tight text-text-primary">
          Parley
        </h1>
        <button
          onClick={() => {
            setCreating((v) => !v);
            setCreateError(null);
          }}
          aria-expanded={creating}
          aria-label="Create a room"
          title="Create a room"
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {creating && (
        <form onSubmit={(e) => void handleCreate(e)} className="px-3 pb-2">
          <label htmlFor="new-room" className="sr-only">
            Room name
          </label>
          <input
            id="new-room"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="Room name, then Enter"
            maxLength={48}
            className="w-full rounded-md border border-hairline bg-panel px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-secondary focus:border-accent-ink focus:outline-none"
          />
          {createError && <p className="mt-1 text-xs text-danger">{createError}</p>}
        </form>
      )}

      <p className="eyebrow px-4 pt-2 pb-1">Rooms</p>
      <ul className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {roomOrder.map((roomId) => (
          <RoomRow key={roomId} roomId={roomId} />
        ))}
        {roomOrder.length === 0 && (
          <li className="px-2 py-8 text-center text-xs text-text-secondary">Loading rooms</li>
        )}
      </ul>

      {user && (
        <footer className="relative flex items-center gap-2 border-t border-hairline p-3">
          <Avatar
            seed={user.avatarSeed}
            name={user.displayName}
            size={28}
            online={online.has(user.id)}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-text-primary">
              {user.displayName}
            </p>
            <p className="truncate font-mono text-[11px] text-text-secondary">@{user.username}</p>
          </div>
          <UserSettings />
          <ThemeToggle />
          <button
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </footer>
      )}
    </nav>
  );
}
