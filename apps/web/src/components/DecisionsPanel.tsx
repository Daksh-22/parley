import { useState } from 'react';
import { X } from 'lucide-react';
import type { Decision } from '@parley/shared';
import { jumpToCitation, requestDecisions } from '../state/chat-store';

interface Props {
  roomId: string;
  open: boolean;
  onClose: () => void;
}

type PanelState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; decisions: Decision[] }
  | { phase: 'error'; message: string };

export function DecisionsPanel({ roomId, open, onClose }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'idle' });

  if (!open) return null;

  async function extract(): Promise<void> {
    setState({ phase: 'loading' });
    const ack = await requestDecisions(roomId);
    if (ack.ok) setState({ phase: 'done', decisions: ack.data.decisions });
    else setState({ phase: 'error', message: ack.error.message });
  }

  return (
    <aside
      aria-label="Decisions"
      className="flex w-[320px] shrink-0 flex-col border-l border-hairline bg-ground max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:bg-panel max-md:shadow-overlay"
    >
      <header className="flex h-12 items-center justify-between border-b border-hairline px-4">
        <p className="eyebrow">Decisions</p>
        <button
          onClick={onClose}
          aria-label="Close decisions"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {state.phase === 'idle' && (
          <div className="text-center">
            <p className="font-display text-lg font-medium text-text-primary">
              What got decided here
            </p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Recall reads the recent history and lists each decision with its sources.
            </p>
            <button
              onClick={() => void extract()}
              className="mt-4 rounded-md bg-text-primary px-3 py-2 text-[13px] font-semibold text-ground transition-opacity duration-120 hover:opacity-90"
            >
              Extract decisions
            </button>
          </div>
        )}

        {state.phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8" role="status">
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-hairline border-t-accent-ink"
            />
            <p className="text-[13px] text-text-secondary">Reading the room history</p>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="py-6 text-center">
            <p role="alert" className="text-[13px] text-danger">
              {state.message}
            </p>
            <button
              onClick={() => void extract()}
              className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-[13px] text-text-primary transition-colors duration-120 hover:bg-row-hover"
            >
              Extract decisions
            </button>
          </div>
        )}

        {state.phase === 'done' && state.decisions.length === 0 && (
          <div className="py-6 text-center">
            <p className="font-display text-lg font-medium text-text-primary">No decisions found</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              The recent history contains discussion but nothing settled.
            </p>
          </div>
        )}

        {state.phase === 'done' && state.decisions.length > 0 && (
          <ol className="space-y-4">
            {state.decisions.map((decision, i) => (
              <li key={i} className="border-l-2 border-accent-ink pl-3">
                <p className="text-[14px] leading-[1.55] text-text-primary">{decision.decision}</p>
                <p className="tabular mt-1 font-mono text-[11px] text-text-secondary">
                  {decision.decidedBy} · {decision.date}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {decision.sourceMessageIds.map((messageId, n) => (
                    <button
                      key={messageId}
                      onClick={() => void jumpToCitation({ kind: 'message', roomId, messageId })}
                      className="tabular rounded-full bg-wash px-1.5 font-mono text-[10px] font-medium text-text-primary transition-opacity duration-120 hover:opacity-80"
                      aria-label={`Go to source message ${n + 1}`}
                    >
                      {n + 1}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
