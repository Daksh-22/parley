import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChatState } from '../state/use-chat';
import {
  getMe,
  loadOlderMessages,
  markRoomRead,
  retryMessage,
  type ChatMessage,
  type DeliveryStatus,
} from '../state/chat-store';
import { dayLabel, exactTime, relativeTime, sameDay, timeOfDay } from '../lib/format';
import { Avatar } from './Avatar';

const GROUP_WINDOW_MS = 3 * 60 * 1000;
// Virtuoso needs a decreasing firstItemIndex when older items are prepended.
const INDEX_BASE = 10_000_000;

type ListItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; showHeader: boolean };

function buildItems(messages: ChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  let prev: ChatMessage | null = null;
  for (const message of messages) {
    const prevDate = prev ? new Date(prev.createdAt) : null;
    const date = new Date(message.createdAt);
    const newDay = !prevDate || !sameDay(prevDate, date);
    if (newDay) {
      items.push({
        kind: 'day',
        key: `day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
        label: dayLabel(message.createdAt),
      });
    }
    const showHeader =
      newDay ||
      prev?.sender.id !== message.sender.id ||
      date.getTime() - new Date(prev?.createdAt ?? 0).getTime() > GROUP_WINDOW_MS;
    items.push({ kind: 'message', key: message.clientMsgId, message, showHeader });
    prev = message;
  }
  return items;
}

function DeliveryIndicator({
  status,
  roomId,
  clientMsgId,
}: {
  status: DeliveryStatus;
  roomId: string;
  clientMsgId: string;
}) {
  if (status === 'failed') {
    return (
      <button
        onClick={() => void retryMessage(roomId, clientMsgId)}
        className="ml-2 inline-flex items-center gap-1 rounded px-1 text-[11px] font-semibold text-danger hover:bg-danger/10"
        aria-label="Message failed to send. Retry"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1 5a4 4 0 0 1 7-2.5M9 5a4 4 0 0 1-7 2.5M8 1v1.8H6.2M2 9V7.2h1.8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        Retry
      </button>
    );
  }

  const label = {
    sending: 'Sending',
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
  }[status];

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`ml-2 inline-flex transition-colors duration-300 ${
        status === 'read' ? 'text-accent' : 'text-text-muted'
      } ${status === 'sending' ? 'opacity-60' : ''}`}
    >
      {status === 'sending' ? (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3.5V6l1.8 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12" fill="none">
          <path
            d="M1.5 6.5 4 9l4.5-5.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {(status === 'delivered' || status === 'read') && (
            <path
              d="M6.5 6.5 9 9l4.5-5.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </span>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  showHeader,
  isOwn,
  online,
}: {
  message: ChatMessage;
  showHeader: boolean;
  isOwn: boolean;
  online: boolean | undefined;
}) {
  return (
    <div
      className={`group relative px-4 ${showHeader ? 'mt-3' : 'mt-0'} ${
        message.status === 'failed' ? 'opacity-80' : ''
      }`}
    >
      {showHeader ? (
        <div className="flex items-start gap-2.5">
          <Avatar
            seed={message.sender.avatarSeed}
            name={message.sender.displayName}
            size={32}
            online={online}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span
                className={`text-sm font-semibold ${isOwn ? 'text-accent' : 'text-text-primary'}`}
              >
                {message.sender.displayName}
              </span>
              <time
                dateTime={message.createdAt}
                title={exactTime(message.createdAt)}
                className="font-mono text-[11px] text-text-muted"
              >
                {relativeTime(message.createdAt)}
              </time>
              {isOwn && (
                <DeliveryIndicator
                  status={message.status}
                  roomId={message.roomId}
                  clientMsgId={message.clientMsgId}
                />
              )}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary">
              {message.body}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-2.5 pl-[42px]">
          <span
            title={exactTime(message.createdAt)}
            className="absolute left-4 hidden w-[32px] pt-1 text-center font-mono text-[10px] text-text-muted group-hover:inline"
            aria-hidden="true"
          >
            {timeOfDay(message.createdAt)}
          </span>
          <p className="min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary">
            {message.body}
            {isOwn && (
              <DeliveryIndicator
                status={message.status}
                roomId={message.roomId}
                clientMsgId={message.clientMsgId}
              />
            )}
          </p>
        </div>
      )}
    </div>
  );
});

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="text-[11px] font-semibold tracking-wide text-text-muted">{label}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-5 px-4 py-6" aria-hidden="true">
      {[80, 55, 70, 40, 65, 75].map((width, i) => (
        <div key={i} className="flex animate-pulse items-start gap-2.5">
          <span className="h-8 w-8 rounded-md bg-surface-2" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-28 rounded bg-surface-2" />
            <span className="block h-3 rounded bg-surface-2" style={{ width: `${width}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

const NO_MESSAGES: ChatMessage[] = [];

export function MessageList({ roomId }: { roomId: string }) {
  const messages = useChatState((s) => s.rooms.get(roomId)?.messages) ?? NO_MESSAGES;
  const historyLoaded = useChatState((s) => s.rooms.get(roomId)?.historyLoaded) ?? false;
  const loadingHistory = useChatState((s) => s.rooms.get(roomId)?.loadingHistory) ?? false;
  const nextCursor = useChatState((s) => s.rooms.get(roomId)?.nextCursor) ?? null;
  const online = useChatState((s) => s.online);
  const me = getMe();

  const items = useMemo(() => buildItems(messages), [messages]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [missedCount, setMissedCount] = useState(0);
  const lastSeenId = useRef<string | null>(null);

  const lastMessage = messages[messages.length - 1];

  // New messages pill: count arrivals from others while scrolled up.
  useEffect(() => {
    if (!lastMessage) return;
    if (atBottom) {
      lastSeenId.current = lastMessage.id;
      setMissedCount(0);
      markRoomRead(roomId);
      return;
    }
    if (lastMessage.id !== lastSeenId.current && lastMessage.sender.id !== me?.id) {
      setMissedCount((c) => c + 1);
      lastSeenId.current = lastMessage.id;
    }
  }, [lastMessage, atBottom, roomId, me?.id]);

  useEffect(() => {
    // Room switched: reset pill state.
    setMissedCount(0);
    setAtBottom(true);
    lastSeenId.current = null;
  }, [roomId]);

  if (!historyLoaded && loadingHistory) return <HistorySkeleton />;

  if (historyLoaded && messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect
            x="5"
            y="8"
            width="30"
            height="22"
            rx="5"
            stroke="var(--p-border-strong)"
            strokeWidth="2"
          />
          <path
            d="M14 32l4-4"
            stroke="var(--p-border-strong)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="14" cy="19" r="1.5" fill="var(--p-text-muted)" />
          <circle cx="20" cy="19" r="1.5" fill="var(--p-text-muted)" />
          <circle cx="26" cy="19" r="1.5" fill="var(--p-text-muted)" />
        </svg>
        <p className="text-sm font-semibold text-text-primary">No messages yet</p>
        <p className="text-sm text-text-secondary">Say the first word.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <Virtuoso
        ref={virtuosoRef}
        data={items}
        firstItemIndex={INDEX_BASE - items.length}
        initialTopMostItemIndex={Math.max(items.length - 1, 0)}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={48}
        startReached={() => {
          if (nextCursor) void loadOlderMessages(roomId);
        }}
        components={{
          Header: () =>
            loadingHistory && nextCursor ? (
              <p className="py-3 text-center text-xs text-text-muted">Loading earlier messages</p>
            ) : (
              <div className="h-3" />
            ),
          Footer: () => <div className="h-3" />,
        }}
        itemContent={(_index, item) =>
          item.kind === 'day' ? (
            <DaySeparator label={item.label} />
          ) : (
            <MessageRow
              message={item.message}
              showHeader={item.showHeader}
              isOwn={item.message.sender.id === me?.id}
              online={item.showHeader ? online.has(item.message.sender.id) : undefined}
            />
          )
        }
      />
      {missedCount > 0 && !atBottom && (
        <button
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({
              index: items.length - 1,
              behavior: 'smooth',
            });
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong-hover"
        >
          {missedCount} new {missedCount === 1 ? 'message' : 'messages'}
        </button>
      )}
    </div>
  );
}
