import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Check, CheckCheck, Clock3, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import type { Citation } from '@parley/shared';
import { useChatState } from '../state/use-chat';
import {
  clearJumpTarget,
  getMe,
  jumpToCitation,
  loadOlderMessages,
  markRoomRead,
  retryMessage,
  type AiStream,
  type ChatMessage,
  type DeliveryStatus,
} from '../state/chat-store';
import { dayLabel, exactTime, relativeTime, sameDay, timeOfDay } from '../lib/format';
import { Avatar } from './Avatar';
import { AiMarkdown } from './AiMarkdown';
import { FeedbackThumbs } from './FeedbackThumbs';

const GROUP_WINDOW_MS = 3 * 60 * 1000;
// Virtuoso needs a decreasing firstItemIndex when older items are prepended.
const INDEX_BASE = 10_000_000;

type ListItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; showHeader: boolean }
  | { kind: 'stream'; key: string; stream: AiStream };

function buildItems(messages: ChatMessage[], streams: AiStream[]): ListItem[] {
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
    // AI marginalia always stands alone; user messages group within 3 minutes.
    const showHeader =
      message.kind === 'ai' ||
      prev?.kind === 'ai' ||
      newDay ||
      prev?.sender.id !== message.sender.id ||
      date.getTime() - new Date(prev?.createdAt ?? 0).getTime() > GROUP_WINDOW_MS;
    items.push({ kind: 'message', key: message.clientMsgId, message, showHeader });
    prev = message;
  }
  for (const stream of streams) {
    items.push({ kind: 'stream', key: stream.streamId, stream });
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
        className="ml-2 inline-flex items-center gap-1 rounded-md px-1 text-[11px] font-semibold text-danger hover:bg-row-hover"
        aria-label="Message failed to send. Send again"
      >
        <RotateCcw size={12} strokeWidth={1.5} aria-hidden="true" />
        Send again
      </button>
    );
  }
  const label = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`ml-1.5 inline-flex transition-colors duration-240 ${
        status === 'read' ? 'text-accent-ink' : 'text-text-secondary'
      } ${status === 'sending' ? 'opacity-60' : ''}`}
    >
      {status === 'sending' ? (
        <Clock3 size={13} strokeWidth={1.5} aria-hidden="true" />
      ) : status === 'sent' ? (
        <Check size={13} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <CheckCheck size={13} strokeWidth={1.5} aria-hidden="true" />
      )}
    </span>
  );
}

function SourcesEndnotes({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-mono text-[11px] tracking-wide text-text-secondary uppercase transition-colors duration-120 hover:text-text-primary"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
        )}
        Sources ({citations.length})
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 border-t border-hairline pt-2">
          {citations.map((citation) => (
            <li key={citation.index} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="tabular shrink-0 font-mono text-text-secondary">
                [{citation.index}]
              </span>
              <button
                onClick={() => void jumpToCitation(citation)}
                className="min-w-0 text-left text-text-secondary transition-colors duration-120 hover:text-text-primary"
                title={citation.kind === 'message' ? 'Go to message' : 'Document chunk'}
              >
                <span className="font-semibold text-text-primary">
                  {citation.senderName ?? 'document'}
                </span>{' '}
                {citation.createdAt && (
                  <time className="font-mono text-[11px]">{exactTime(citation.createdAt)}</time>
                )}
                {citation.page !== undefined && (
                  <span className="font-mono text-[11px]"> p.{citation.page}</span>
                )}
                <span className="block truncate">{citation.snippet}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** AI answers render as marginalia: a rule in the margin, not a robot card. */
function AiAnswer({
  question,
  askedBy,
  body,
  citations,
  streaming,
  errorMessage,
  streamId,
}: {
  question: string;
  askedBy: string;
  body: string;
  citations?: Citation[];
  streaming?: boolean;
  errorMessage?: string;
  streamId?: string;
}) {
  return (
    <div className="my-1 border-l-2 border-accent-ink py-1 pl-3">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[15px] italic text-accent-ink">Recall</span>
        <span className="min-w-0 text-[12px] text-text-secondary">
          {askedBy} asked: {question}
        </span>
        {!streaming && streamId && <FeedbackThumbs streamId={streamId} />}
      </p>
      <div className={`mt-1 min-h-[22px] ${streaming ? 'stream-caret' : ''}`}>
        {errorMessage ? (
          <p className="text-[13px] text-danger">{errorMessage}</p>
        ) : (
          <AiMarkdown
            text={body}
            citations={citations}
            onCitationClick={(c) => void jumpToCitation(c)}
          />
        )}
      </div>
      {!streaming && citations && <SourcesEndnotes citations={citations} />}
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  showHeader,
  isOwn,
  online,
  highlighted,
}: {
  message: ChatMessage;
  showHeader: boolean;
  isOwn: boolean;
  online: boolean | undefined;
  highlighted: boolean;
}) {
  if (message.kind === 'ai') {
    return (
      <div className="px-4 py-1">
        <AiAnswer
          question={message.aiQuestion ?? ''}
          askedBy={message.sender.displayName}
          body={message.body}
          citations={message.citations}
          streamId={
            message.clientMsgId.startsWith('ai-') ? message.clientMsgId.slice(3) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={`group relative px-4 transition-colors duration-120 hover:bg-row-hover ${
        showHeader ? 'mt-2.5 pt-0.5' : ''
      } ${message.status === 'failed' ? 'opacity-80' : ''} ${highlighted ? 'citation-target' : ''}`}
    >
      {showHeader ? (
        <div className="flex items-start gap-2.5">
          <Avatar
            seed={message.sender.avatarSeed}
            name={message.sender.displayName}
            size={28}
            online={online}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-text-primary">
                {message.sender.displayName}
              </span>
              <time
                dateTime={message.createdAt}
                title={exactTime(message.createdAt)}
                className="tabular font-mono text-[11px] text-text-secondary"
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
            <p className="text-[14px] leading-[1.55] whitespace-pre-wrap break-words text-text-primary">
              {message.body}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-2.5 pl-[38px]">
          <span
            title={exactTime(message.createdAt)}
            className="tabular absolute left-3 hidden w-[30px] pt-1 text-center font-mono text-[10px] text-text-secondary group-hover:inline"
            aria-hidden="true"
          >
            {timeOfDay(message.createdAt)}
          </span>
          <p className="min-w-0 flex-1 text-[14px] leading-[1.55] whitespace-pre-wrap break-words text-text-primary">
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
      <span className="h-px flex-1 bg-hairline" />
      <span className="tabular font-mono text-[11px] tracking-wide text-text-secondary">
        {label}
      </span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-5 px-4 py-6" aria-hidden="true">
      {[80, 55, 70, 40, 65, 75].map((width, i) => (
        <div key={i} className="flex animate-pulse items-start gap-2.5">
          <span className="h-7 w-7 rounded-full bg-row-hover" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-28 rounded bg-row-hover" />
            <span className="block h-3 rounded bg-row-hover" style={{ width: `${width}%` }} />
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
  const aiStreams = useChatState((s) => s.aiStreams);
  const jumpTarget = useChatState((s) => s.jumpTarget);
  const me = getMe();

  const roomStreams = useMemo(
    () =>
      [...aiStreams.values()].filter(
        (stream) => stream.scope === 'room' && stream.roomId === roomId,
      ),
    [aiStreams, roomId],
  );

  const items = useMemo(() => buildItems(messages, roomStreams), [messages, roomStreams]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [missedCount, setMissedCount] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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
    setMissedCount(0);
    setAtBottom(true);
    lastSeenId.current = null;
  }, [roomId]);

  // The signature citation jump: scroll to the source, sweep the wash.
  useEffect(() => {
    if (!jumpTarget || jumpTarget.roomId !== roomId) return;
    const index = items.findIndex(
      (item) => item.kind === 'message' && item.message.id === jumpTarget.messageId,
    );
    if (index < 0) return;
    virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' });
    const target = jumpTarget.messageId;
    const timer = setTimeout(() => {
      setHighlightedId(target);
      clearJumpTarget();
      // Wash sweeps 240ms, fades 1.4s, the left rule persists 3s.
      setTimeout(() => setHighlightedId(null), 4600);
    }, 350);
    return () => clearTimeout(timer);
  }, [jumpTarget, items, roomId]);

  if (!historyLoaded && loadingHistory) return <HistorySkeleton />;

  if (historyLoaded && messages.length === 0 && roomStreams.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="font-display text-xl font-medium text-text-primary">No messages yet</p>
        <p className="text-[13px] text-text-secondary">Say the first word.</p>
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
              <p className="py-3 text-center font-mono text-[11px] text-text-secondary">
                Loading earlier messages
              </p>
            ) : (
              <div className="h-3" />
            ),
          Footer: () => <div className="h-3" />,
        }}
        itemContent={(_index, item) => {
          if (item.kind === 'day') return <DaySeparator label={item.label} />;
          if (item.kind === 'stream') {
            return (
              <div className="px-4 py-1">
                <AiAnswer
                  question={item.stream.question}
                  askedBy={item.stream.askedBy}
                  body={item.stream.text}
                  streaming={item.stream.status === 'streaming'}
                  errorMessage={item.stream.errorMessage}
                />
              </div>
            );
          }
          return (
            <MessageRow
              message={item.message}
              showHeader={item.showHeader}
              isOwn={item.message.sender.id === me?.id}
              online={item.showHeader ? online.has(item.message.sender.id) : undefined}
              highlighted={highlightedId === item.message.id}
            />
          );
        }}
      />
      {missedCount > 0 && !atBottom && (
        <button
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
          }}
          className="tabular absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-text-primary px-3 py-1.5 font-mono text-[11px] font-medium text-ground transition-opacity duration-120 hover:opacity-90"
        >
          {missedCount} new {missedCount === 1 ? 'message' : 'messages'}
        </button>
      )}
    </div>
  );
}
