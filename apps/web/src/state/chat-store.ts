import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  Citation,
  ClientToServerEvents,
  DecisionsResult,
  MessageWire,
  PublicUser,
  RoomWire,
  ServerToClientEvents,
} from '@parley/shared';
import { api, getAccessToken } from '../lib/api';
import { API_URL } from '../lib/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage extends MessageWire {
  // Delivery state is only meaningful on the viewer's own messages.
  status: DeliveryStatus;
}

export interface RoomState {
  room: RoomWire;
  messages: ChatMessage[]; // ascending by time
  nextCursor: string | null;
  historyLoaded: boolean;
  loadingHistory: boolean;
  members: Map<string, PublicUser>;
  // userId -> lastReadMessageId, for read receipts and own-message status.
  readCursors: Map<string, string>;
  typing: Map<string, number>; // userId -> expiry epoch ms
  // Catch me up window, captured at room open before the cursor advances.
  catchupAvailable: number;
  catchupSinceId: string | null;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface AiStream {
  streamId: string;
  scope: 'room' | 'global' | 'catchup';
  roomId?: string;
  question: string;
  askedBy: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  errorMessage?: string;
  citations?: Citation[];
  cached?: boolean;
}

export interface JumpTarget {
  roomId: string;
  messageId: string;
  // Changes on every jump so repeating the same target still re-triggers.
  nonce: number;
}

export interface ChatState {
  connection: ConnectionStatus;
  rooms: Map<string, RoomState>;
  roomOrder: string[];
  activeRoomId: string | null;
  online: Set<string>;
  sidebarOpen: boolean;
  // Live AI answer streams keyed by streamId. Room streams render in the
  // message list; global and catchup streams render where they were asked.
  aiStreams: Map<string, AiStream>;
  jumpTarget: JumpTarget | null;
}

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------------------------------------------------------------------------
// Store core: a single mutable state object, immutably replaced on change,
// consumed by React through useSyncExternalStore.
// ---------------------------------------------------------------------------

let state: ChatState = {
  connection: 'connecting',
  rooms: new Map(),
  roomOrder: [],
  activeRoomId: null,
  online: new Set(),
  sidebarOpen: false,
  aiStreams: new Map(),
  jumpTarget: null,
};

const listeners = new Set<() => void>();

function emitChange(): void {
  state = { ...state };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): ChatState {
  return state;
}

let me: PublicUser | null = null;
export function getMe(): PublicUser | null {
  return me;
}

let socket: AppSocket | null = null;

function room(roomId: string): RoomState | undefined {
  return state.rooms.get(roomId);
}

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

export function connect(currentUser: PublicUser): void {
  me = currentUser;
  if (socket) socket.disconnect();

  // websocket only: no long-polling fallback, no sticky session requirement.
  socket = io(API_URL, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });

  socket.on('connect', () => {
    state.connection = 'connected';
    emitChange();
    void syncSinceReconnect();
  });

  socket.io.on('reconnect_attempt', () => {
    state.connection = 'reconnecting';
    emitChange();
  });

  socket.on('disconnect', () => {
    state.connection = 'offline';
    emitChange();
  });

  socket.on('connect_error', () => {
    state.connection = 'reconnecting';
    emitChange();
  });

  socket.on('message:new', (message) => {
    appendMessage(message, false);
    // Tell the sender their message reached us.
    socket?.emit('message:delivered', { roomId: message.roomId, messageId: message.id }, () => {});
  });

  socket.on('message:delivered', ({ roomId, messageId, userId }) => {
    if (userId === me?.id) return;
    const r = room(roomId);
    if (!r) return;
    r.messages = r.messages.map((m) =>
      m.id === messageId &&
      m.sender.id === me?.id &&
      (m.status === 'sent' || m.status === 'sending')
        ? { ...m, status: 'delivered' as const }
        : m,
    );
    emitChange();
  });

  socket.on('room:readState', ({ roomId, userId, lastReadMessageId }) => {
    const r = room(roomId);
    if (!r) return;
    r.readCursors = new Map(r.readCursors).set(userId, lastReadMessageId);
    if (userId !== me?.id) {
      // Everything of ours at or before the cursor is now read. ObjectIds are
      // fixed-length hex, so string comparison matches creation order.
      r.messages = r.messages.map((m) =>
        m.sender.id === me?.id && m.id <= lastReadMessageId && m.status !== 'read'
          ? { ...m, status: 'read' as const }
          : m,
      );
    }
    emitChange();
  });

  socket.on('typing:update', ({ roomId, userId, isTyping }) => {
    if (userId === me?.id) return;
    const r = room(roomId);
    if (!r) return;
    const typing = new Map(r.typing);
    if (isTyping) typing.set(userId, Date.now() + 4000);
    else typing.delete(userId);
    r.typing = typing;
    // Unknown typist: the roster is stale, refresh it so the indicator can
    // show a name instead of "Someone".
    if (isTyping && !r.members.has(userId)) void loadMembers(roomId);
    emitChange();
  });

  socket.on('presence:update', ({ userId, online }) => {
    const next = new Set(state.online);
    if (online) next.add(userId);
    else next.delete(userId);
    state.online = next;
    emitChange();
  });

  socket.on('presence:state', ({ online }) => {
    state.online = new Set(online);
    emitChange();
  });

  socket.on('ai:stream:start', (event) => {
    state.aiStreams = new Map(state.aiStreams).set(event.streamId, {
      streamId: event.streamId,
      scope: event.scope,
      roomId: event.roomId,
      question: event.question,
      askedBy: event.askedBy,
      text: '',
      status: 'streaming',
    });
    emitChange();
  });

  socket.on('ai:stream:delta', ({ streamId, delta }) => {
    const stream = state.aiStreams.get(streamId);
    if (!stream) return;
    state.aiStreams = new Map(state.aiStreams).set(streamId, {
      ...stream,
      text: stream.text + delta,
    });
    emitChange();
  });

  socket.on('ai:stream:done', (event) => {
    const stream = state.aiStreams.get(event.streamId);
    if (!stream) return;
    const next = new Map(state.aiStreams);
    if (stream.scope === 'room' && event.messageId) {
      // The persisted ai message arrives via message:new; the ephemeral
      // stream row simply leaves.
      next.delete(event.streamId);
    } else {
      next.set(event.streamId, {
        ...stream,
        text: event.answer,
        citations: event.citations,
        cached: event.cached,
        status: 'done',
      });
    }
    state.aiStreams = next;
    emitChange();
  });

  socket.on('ai:stream:error', (event) => {
    const stream = state.aiStreams.get(event.streamId);
    const next = new Map(state.aiStreams);
    next.set(event.streamId, {
      streamId: event.streamId,
      scope: stream?.scope ?? 'room',
      roomId: stream?.roomId,
      question: stream?.question ?? '',
      askedBy: stream?.askedBy ?? '',
      text: stream?.text ?? '',
      status: 'error',
      errorMessage: event.message,
    });
    state.aiStreams = next;
    emitChange();
  });

  void loadRooms();
}

export function dismissAiStream(streamId: string): void {
  if (!state.aiStreams.has(streamId)) return;
  const next = new Map(state.aiStreams);
  next.delete(streamId);
  state.aiStreams = next;
  emitChange();
}

/**
 * The signature interaction: jump to a citation's source message. Opens the
 * room if needed; if the source sits outside the loaded window, history pages
 * are fetched around it until it appears (bounded), then the list scrolls and
 * runs the highlight sweep via jumpTarget.
 */
export async function jumpToCitation(citation: {
  kind: 'message' | 'doc';
  roomId: string;
  messageId?: string;
}): Promise<void> {
  if (citation.kind !== 'message' || !citation.messageId) return;
  const { roomId, messageId } = citation;
  if (state.activeRoomId !== roomId) await openRoom(roomId);
  const r = room(roomId);
  if (!r) return;

  // Fetch around: page back through history until the source is loaded.
  let pages = 0;
  while (!r.messages.some((m) => m.id === messageId) && r.nextCursor !== null && pages < 30) {
    await loadOlderMessages(roomId);
    pages += 1;
  }
  if (!r.messages.some((m) => m.id === messageId)) return;

  state.jumpTarget = { roomId, messageId, nonce: Date.now() };
  emitChange();
}

export function clearJumpTarget(): void {
  if (!state.jumpTarget) return;
  state.jumpTarget = null;
  emitChange();
}

// ---------------------------------------------------------------------------
// AI surface actions
// ---------------------------------------------------------------------------

export function askGlobal(question: string): Promise<Ack<{ streamId: string }>> {
  return emitWithAck<{ streamId: string }>('ai:ask', { scope: 'global', question });
}

export function requestCatchup(roomId: string): Promise<Ack<{ streamId: string }>> {
  const r = room(roomId);
  return emitWithAck<{ streamId: string }>('ai:catchup', {
    roomId,
    ...(r?.catchupSinceId ? { sinceMessageId: r.catchupSinceId } : {}),
  });
}

export function requestDecisions(roomId: string): Promise<Ack<DecisionsResult>> {
  return emitWithAck<DecisionsResult>('ai:decisions', { roomId });
}

export function sendAiFeedback(
  streamId: string,
  verdict: 'up' | 'down',
): Promise<Ack<{ recorded: true }>> {
  return emitWithAck<{ recorded: true }>('ai:feedback', { streamId, verdict });
}

export async function setRoomAi(roomId: string, aiEnabled: boolean): Promise<void> {
  const { room: wire } = await api.patchRoomSettings(roomId, aiEnabled);
  const r = room(roomId);
  if (r) {
    r.room = wire;
    emitChange();
  }
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
  me = null;
  state = {
    connection: 'connecting',
    rooms: new Map(),
    roomOrder: [],
    activeRoomId: null,
    online: new Set(),
    sidebarOpen: false,
    aiStreams: new Map(),
    jumpTarget: null,
  };
  emitChange();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitWithAck<T>(
  event:
    | 'room:join'
    | 'room:leave'
    | 'message:send'
    | 'room:read'
    | 'sync:since'
    | 'ai:ask'
    | 'ai:catchup'
    | 'ai:decisions'
    | 'ai:feedback',
  payload: unknown,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: { code: 'OFFLINE', message: 'Not connected' } });
      return;
    }
    // The shared event map gives precise per-event typing at the call sites;
    // this helper funnels them through one timeout-guarded path.
    const timer = setTimeout(() => {
      resolve({ ok: false, error: { code: 'TIMEOUT', message: 'No response from server' } });
    }, 8000);
    (socket as Socket).emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

function appendMessage(message: MessageWire, own: boolean): void {
  const r = room(message.roomId);
  if (!r) return;

  // Reconcile by clientMsgId first (optimistic echo), then by id (dedup).
  const existingIndex = r.messages.findIndex(
    (m) => m.clientMsgId === message.clientMsgId || m.id === message.id,
  );
  if (existingIndex >= 0) {
    const existing = r.messages[existingIndex] as ChatMessage;
    r.messages = [...r.messages];
    r.messages[existingIndex] = {
      ...message,
      status: existing.status === 'sending' ? 'sent' : existing.status,
    };
  } else {
    r.messages = sortMessages([...r.messages, { ...message, status: own ? 'sent' : 'read' }]);
    if (!own && state.activeRoomId !== message.roomId) {
      r.room = { ...r.room, unreadCount: r.room.unreadCount + 1 };
    }
  }
  // A real message replaces the sender's typing indicator immediately.
  if (r.typing.has(message.sender.id)) {
    const typing = new Map(r.typing);
    typing.delete(message.sender.id);
    r.typing = typing;
  }
  // A message from someone not in the roster means the roster is stale
  // (they joined after we loaded it). Fold them in.
  if (!r.members.has(message.sender.id)) {
    r.members = new Map(r.members).set(message.sender.id, message.sender);
  }
  emitChange();
}

function lastMessageId(r: RoomState): string | null {
  for (let i = r.messages.length - 1; i >= 0; i -= 1) {
    const m = r.messages[i];
    if (m && m.status !== 'sending' && m.status !== 'failed') return m.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function loadRooms(): Promise<void> {
  const { rooms } = await api.listRooms();
  const nextRooms = new Map(state.rooms);
  const order: string[] = [];
  for (const wire of rooms) {
    order.push(wire.id);
    const existing = nextRooms.get(wire.id);
    if (existing) {
      existing.room = wire;
    } else {
      nextRooms.set(wire.id, {
        room: wire,
        messages: [],
        nextCursor: null,
        historyLoaded: false,
        loadingHistory: false,
        members: new Map(),
        readCursors: new Map(),
        typing: new Map(),
        catchupAvailable: 0,
        catchupSinceId: null,
      });
    }
  }
  state.rooms = nextRooms;
  state.roomOrder = order;
  emitChange();

  // Prefetch rosters for member rooms so sidebar presence dots and typing
  // names work before a room is first opened. Capped, fire and forget.
  let prefetched = 0;
  for (const wire of rooms) {
    const roomState = nextRooms.get(wire.id);
    if (wire.isMember && roomState && roomState.members.size === 0 && prefetched < 20) {
      prefetched += 1;
      void loadMembers(wire.id);
    }
  }
}

export async function createRoom(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { room: wire } = await api.createRoom(name);
    await loadRooms();
    await openRoom(wire.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create room' };
  }
}

export async function openRoom(roomId: string): Promise<void> {
  const r = room(roomId);
  if (!r) return;
  state.activeRoomId = roomId;
  state.sidebarOpen = false;
  emitChange();

  if (!r.room.isMember) {
    const ack = await emitWithAck<{ room: RoomWire }>('room:join', { roomId });
    if (ack.ok) {
      r.room = { ...ack.data.room };
      emitChange();
    }
  }

  // Capture the catch-up window before anything moves the read cursor: the
  // unread count at entry and the boundary message the digest starts from.
  const unreadAtOpen = r.room.unreadCount;

  if (!r.historyLoaded) {
    await Promise.all([loadOlderMessages(roomId), loadMembers(roomId)]);
  }

  if (unreadAtOpen >= 10 && r.catchupAvailable === 0) {
    r.catchupAvailable = unreadAtOpen;
    r.catchupSinceId = me ? (r.readCursors.get(me.id) ?? null) : null;
    emitChange();
  }
  markRoomRead(roomId);
}

export function clearCatchup(roomId: string): void {
  const r = room(roomId);
  if (!r || r.catchupAvailable === 0) return;
  r.catchupAvailable = 0;
  r.catchupSinceId = null;
  emitChange();
}

export async function loadMembers(roomId: string): Promise<void> {
  const r = room(roomId);
  if (!r) return;
  try {
    const { members } = await api.getMembers(roomId);
    r.members = new Map(members.map((m) => [m.user.id, m.user]));
    const cursors = new Map(r.readCursors);
    for (const m of members) {
      if (m.lastReadMessageId) cursors.set(m.user.id, m.lastReadMessageId);
    }
    r.readCursors = cursors;
    emitChange();
  } catch {
    // Roster is a progressive enhancement; messages still render without it.
  }
}

export async function loadOlderMessages(roomId: string): Promise<void> {
  const r = room(roomId);
  if (!r || r.loadingHistory) return;
  if (r.historyLoaded && r.nextCursor === null) return;

  r.loadingHistory = true;
  emitChange();
  try {
    const { messages, nextCursor } = await api.getMessages(roomId, r.nextCursor ?? undefined);
    const known = new Set(r.messages.map((m) => m.id));
    const older: ChatMessage[] = messages
      .filter((m) => !known.has(m.id))
      .map((m) => ({ ...m, status: 'read' as const }));
    r.messages = sortMessages([...older, ...r.messages]);
    r.nextCursor = nextCursor;
    r.historyLoaded = true;
  } finally {
    r.loadingHistory = false;
    emitChange();
  }
}

export async function sendMessage(roomId: string, body: string): Promise<void> {
  const r = room(roomId);
  const sender = me;
  if (!r || !sender) return;
  const trimmed = body.trim();
  if (!trimmed) return;

  const clientMsgId = crypto.randomUUID();
  const optimistic: ChatMessage = {
    id: `pending:${clientMsgId}`,
    roomId,
    sender,
    body: trimmed,
    clientMsgId,
    createdAt: new Date().toISOString(),
    kind: 'user',
    status: 'sending',
  };
  r.messages = [...r.messages, optimistic];
  emitChange();

  const ack = await emitWithAck<{ message: MessageWire }>('message:send', {
    roomId,
    clientMsgId,
    body: trimmed,
  });

  const index = r.messages.findIndex((m) => m.clientMsgId === clientMsgId);
  if (index < 0) return;
  r.messages = [...r.messages];
  if (ack.ok) {
    const current = r.messages[index] as ChatMessage;
    r.messages[index] = {
      ...ack.data.message,
      status: current.status === 'sending' ? 'sent' : current.status,
    };
    r.messages = sortMessages(r.messages);
  } else {
    r.messages[index] = { ...(r.messages[index] as ChatMessage), status: 'failed' };
  }
  emitChange();
}

export async function retryMessage(roomId: string, clientMsgId: string): Promise<void> {
  const r = room(roomId);
  if (!r) return;
  const failed = r.messages.find((m) => m.clientMsgId === clientMsgId && m.status === 'failed');
  if (!failed) return;
  r.messages = r.messages.filter((m) => m.clientMsgId !== clientMsgId);
  emitChange();
  await sendMessage(roomId, failed.body);
}

export function markRoomRead(roomId: string): void {
  const r = room(roomId);
  if (!r) return;
  const last = lastMessageId(r);
  if (!last || last.startsWith('pending:')) return;
  const mine = r.readCursors.get(me?.id ?? '');
  if (mine && mine >= last) return;
  if (r.room.unreadCount !== 0) {
    r.room = { ...r.room, unreadCount: 0 };
    emitChange();
  }
  void emitWithAck('room:read', { roomId, lastReadMessageId: last });
}

let typingActive = false;
let typingStopTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced typing notifications: start once, stop 1.2s after the last keystroke. */
export function notifyTyping(roomId: string): void {
  if (!socket?.connected) return;
  if (!typingActive) {
    typingActive = true;
    socket.emit('typing:start', { roomId }, () => {});
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => stopTyping(roomId), 1200);
}

export function stopTyping(roomId: string): void {
  clearTimeout(typingStopTimer);
  if (!typingActive) return;
  typingActive = false;
  socket?.emit('typing:stop', { roomId }, () => {});
}

async function syncSinceReconnect(): Promise<void> {
  const cursors: { roomId: string; lastMessageId: string }[] = [];
  for (const [roomId, r] of state.rooms) {
    const last = lastMessageId(r);
    if (last && r.historyLoaded) cursors.push({ roomId, lastMessageId: last });
  }
  // Refresh the sidebar regardless: unread counts may have moved while away.
  void loadRooms();
  if (cursors.length === 0) return;

  const ack = await emitWithAck<{
    rooms: { roomId: string; messages: MessageWire[]; refetch: boolean }[];
  }>('sync:since', { cursors: cursors.slice(0, 50) });
  if (!ack.ok) return;

  for (const result of ack.data.rooms) {
    const r = room(result.roomId);
    if (!r) continue;
    if (result.refetch) {
      // Too far behind: drop local history and reload the latest page.
      r.messages = [];
      r.nextCursor = null;
      r.historyLoaded = false;
      emitChange();
      void loadOlderMessages(result.roomId);
    } else {
      for (const message of result.messages) appendMessage(message, false);
    }
  }
}

export function toggleSidebar(open?: boolean): void {
  state.sidebarOpen = open ?? !state.sidebarOpen;
  emitChange();
}

/** Periodic sweep clearing typing entries whose expiry passed. */
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const r of state.rooms.values()) {
    for (const [userId, expiry] of r.typing) {
      if (expiry < now) {
        const typing = new Map(r.typing);
        typing.delete(userId);
        r.typing = typing;
        changed = true;
      }
    }
  }
  if (changed) emitChange();
}, 1000);
