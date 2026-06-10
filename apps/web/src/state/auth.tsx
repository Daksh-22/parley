import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser } from '@parley/shared';
import { api, ApiError, setAccessToken, tryRefresh } from '../lib/api';
import { connect as connectChat, disconnect as disconnectChat } from './chat-store';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  login: (username: string, password: string) => Promise<string | null>;
  register: (username: string, password: string, displayName: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Access tokens live 15 minutes; refresh well inside that window so the
// socket can always present a valid token when it reconnects.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  const beginSession = useCallback((nextUser: PublicUser, accessToken: string) => {
    setAccessToken(accessToken);
    setUser(nextUser);
    setStatus('signedIn');
    connectChat(nextUser);
    clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => void tryRefresh(), REFRESH_INTERVAL_MS);
  }, []);

  // Session restore: the refresh cookie outlives the tab.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await tryRefresh();
      if (cancelled) return;
      if (!ok) {
        setStatus('signedOut');
        return;
      }
      try {
        const { user: restored } = await api.me();
        if (!cancelled) {
          setUser(restored);
          setStatus('signedIn');
          connectChat(restored);
          clearInterval(refreshTimer.current);
          refreshTimer.current = setInterval(() => void tryRefresh(), REFRESH_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(refreshTimer.current);
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<string | null> => {
      try {
        const res = await api.login({ username, password });
        beginSession(res.user, res.accessToken);
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not reach the server';
      }
    },
    [beginSession],
  );

  const register = useCallback(
    async (username: string, password: string, displayName: string): Promise<string | null> => {
      try {
        const res = await api.register({ username, password, displayName });
        beginSession(res.user, res.accessToken);
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : 'Could not reach the server';
      }
    },
    [beginSession],
  );

  const logout = useCallback(async () => {
    clearInterval(refreshTimer.current);
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    disconnectChat();
    setUser(null);
    setStatus('signedOut');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
