import { useState, type FormEvent } from 'react';
import { useAuth } from '../state/auth';
import { useChatState } from '../state/use-chat';
import { createRoom, openRoom, getMe } from '../state/chat-store';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';

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
        className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          isActive
            ? 'bg-accent-soft font-semibold text-text-primary'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
        }`}
      >
        <span aria-hidden="true" className="font-mono text-text-muted">
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
          <span className="shrink-0 rounded-full bg-accent-strong px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
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
      setCreateError(result.error ?? 'Could not create room');
    }
  }

  return (
    <nav aria-label="Rooms" className="flex h-full flex-col bg-surface-1">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-sm font-semibold tracking-tight text-text-primary">Parley</h1>
        <button
          onClick={() => {
            setCreating((v) => !v);
            setCreateError(null);
          }}
          aria-expanded={creating}
          aria-label="Create a room"
          title="Create a room"
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 2v10M2 7h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
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
            className="w-full rounded-md border border-border-subtle bg-surface-0 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {createError && <p className="mt-1 text-xs text-danger">{createError}</p>}
        </form>
      )}

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {roomOrder.map((roomId) => (
          <RoomRow key={roomId} roomId={roomId} />
        ))}
        {roomOrder.length === 0 && (
          <li className="px-2 py-8 text-center text-xs text-text-muted">Loading rooms</li>
        )}
      </ul>

      {user && (
        <footer className="flex items-center gap-2 border-t border-border-subtle p-3">
          <Avatar
            seed={user.avatarSeed}
            name={user.displayName}
            size={32}
            online={online.has(user.id)}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{user.displayName}</p>
            <p className="truncate font-mono text-[11px] text-text-muted">@{user.username}</p>
          </div>
          <ThemeToggle />
          <button
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2M9 10l3-3-3-3M12 7H5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </footer>
      )}
    </nav>
  );
}
