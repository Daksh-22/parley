import type {
  AuthResponse,
  LoginRequest,
  MemberWire,
  MessageWire,
  PublicUser,
  RegisterRequest,
  RoomWire,
} from '@parley/shared';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The access token lives in memory only: no localStorage, nothing readable by
// injected scripts. The refresh token is an httpOnly cookie the JS never sees.
let accessToken: string | null = null;
export const getAccessToken = (): string | null => accessToken;
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
  retryOn401?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retryOn401 = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });

  if (res.status === 401 && auth && retryOn401) {
    // Access token expired: refresh once via the cookie, then retry.
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...options, retryOn401: false });
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? `Request failed with ${res.status}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export const api = {
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginRequest) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body, auth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST', auth: false }),
  me: () => request<{ user: PublicUser }>('/me'),
  listRooms: () => request<{ rooms: RoomWire[]; nextCursor: string | null }>('/rooms'),
  createRoom: (name: string) =>
    request<{ room: RoomWire }>('/rooms', { method: 'POST', body: { name } }),
  getMessages: (roomId: string, cursor?: string) =>
    request<{ messages: MessageWire[]; nextCursor: string | null }>(
      `/rooms/${roomId}/messages?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  getMembers: (roomId: string) =>
    request<{ members: MemberWire[]; nextCursor: string | null }>(
      `/rooms/${roomId}/members?limit=100`,
    ),
};
