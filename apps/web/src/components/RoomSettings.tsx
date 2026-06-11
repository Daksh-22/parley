import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import type { DocumentWire } from '@parley/shared';
import { api, uploadDocument } from '../lib/api';
import { useChatState } from '../state/use-chat';
import { setRoomAi } from '../state/chat-store';

interface Props {
  roomId: string;
  open: boolean;
  onClose: () => void;
}

function StatusChip({ status }: { status: DocumentWire['status'] }) {
  const color =
    status === 'ready'
      ? 'text-success'
      : status === 'failed'
        ? 'text-danger'
        : 'text-text-secondary';
  return <span className={`font-mono text-[11px] uppercase ${color}`}>{status}</span>;
}

export function RoomSettings({ roomId, open, onClose }: Props) {
  const aiEnabled = useChatState((s) => s.rooms.get(roomId)?.room.aiEnabled) ?? true;
  const [documents, setDocuments] = useState<DocumentWire[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = (): void => {
      api
        .listDocuments(roomId)
        .then(({ documents: docs }) => {
          if (!cancelled) setDocuments(docs);
        })
        .catch(() => undefined);
    };
    load();
    // Poll lightly while open so processing chips settle without a refresh.
    const interval = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, roomId]);

  if (!open) return null;

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setUploadError(null);
    try {
      const doc = await uploadDocument(roomId, file);
      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Try again');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="absolute top-12 right-3 z-40 w-[320px] rounded-lg border border-hairline bg-panel shadow-overlay">
      <header className="flex h-11 items-center justify-between border-b border-hairline px-4">
        <p className="eyebrow">Room settings</p>
        <button
          onClick={onClose}
          aria-label="Close room settings"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <section className="border-b border-hairline p-4">
        <p className="eyebrow pb-2">Memory</p>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-text-primary">Remember this room</p>
            <p className="mt-0.5 text-[12px] leading-snug text-text-secondary">
              When off, nothing here is embedded, retrieved, or sent to a model.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={aiEnabled}
            aria-label="Remember this room"
            onClick={() => void setRoomAi(roomId, !aiEnabled)}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-hairline transition-colors duration-120 ${
              aiEnabled ? 'bg-text-primary' : 'bg-ground'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-120 ${
                aiEnabled ? 'right-0.5 bg-ground' : 'left-0.5 bg-text-secondary'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="p-4">
        <div className="flex items-center justify-between pb-2">
          <p className="eyebrow">Documents</p>
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-[12px] text-text-primary transition-colors duration-120 hover:bg-row-hover ${
              uploading || !aiEnabled ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Upload size={13} strokeWidth={1.5} aria-hidden="true" />
            {uploading ? 'Uploading' : 'Upload document'}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.md,.txt"
              className="sr-only"
              disabled={uploading || !aiEnabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
        </div>
        {uploadError && (
          <p role="alert" className="pb-2 text-[12px] text-danger">
            {uploadError}
          </p>
        )}
        {!aiEnabled && (
          <p className="pb-2 text-[12px] text-text-secondary">Turn memory on to add documents.</p>
        )}
        {documents.length === 0 && aiEnabled ? (
          <p className="text-[12px] text-text-secondary">
            Pdf, markdown, or text up to 10MB. Documents become citable sources.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 text-[12px]">
                <FileText
                  size={13}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-text-secondary"
                />
                <span className="min-w-0 flex-1 truncate text-text-primary" title={doc.filename}>
                  {doc.filename}
                </span>
                <StatusChip status={doc.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
