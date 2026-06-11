import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { loadRooms, openRoom } from '../state/chat-store';

const STORAGE_KEY = 'parley-pending-invite';

/** Reads an invite token from the URL once and keeps it through sign-in. */
export function capturePendingInvite(): void {
  const match = /^\/invite\/([a-f0-9]{32})$/.exec(window.location.pathname);
  if (match?.[1]) {
    sessionStorage.setItem(STORAGE_KEY, match[1]);
    window.history.replaceState({}, '', '/');
  }
}

export function getPendingInvite(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function clearPendingInvite(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Fetches the invite preview for the auth screen notice. */
export function useInviteNotice(): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const token = getPendingInvite();
    if (!token) return;
    api
      .getInvitePreview(token)
      .then((preview) => {
        if (preview.valid && preview.roomName) {
          setNotice(`You are invited to #${preview.roomName}. Sign in to join.`);
        } else {
          setNotice('This invite has expired or was revoked.');
          clearPendingInvite();
        }
      })
      .catch(() => undefined);
  }, []);
  return notice;
}

/**
 * Runs once after sign-in when an invite is pending: redeems, opens the
 * room, and reports failure calmly without blocking the app.
 */
export function InviteRedeemer() {
  const [error, setError] = useState<string | null>(null);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);

  useEffect(() => {
    const token = getPendingInvite();
    if (!token) return;
    clearPendingInvite();
    api
      .redeemInvite(token)
      .then(async ({ room }) => {
        await loadRooms();
        await openRoom(room.id);
        setJoinedRoom(room.name);
        setTimeout(() => setJoinedRoom(null), 4000);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'This invite could not be redeemed');
        setTimeout(() => setError(null), 6000);
      });
  }, []);

  if (!error && !joinedRoom) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-hairline bg-panel px-4 py-2 text-[13px] shadow-overlay"
    >
      {error ? (
        <span className="text-danger">{error}</span>
      ) : (
        <span className="text-text-primary">Joined #{joinedRoom}</span>
      )}
    </div>
  );
}
