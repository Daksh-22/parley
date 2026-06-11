// Pure request and formatting helpers for the Parley memory tools.
// All permission enforcement happens server-side in the memory API; this
// package is a thin, read-only bridge.

export interface MemoryConfig {
  baseUrl: string;
  token: string;
}

export class MemoryApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryApiError';
  }
}

export async function callMemoryApi<T>(
  config: MemoryConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new MemoryApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? `Request failed with ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

export interface SearchResult {
  kind: 'message' | 'doc';
  room: string;
  sender: string | null;
  createdAt: string;
  text: string;
}

export interface AnswerCitation {
  index: number;
  kind: string;
  sender: string | null;
  createdAt: string | null;
  snippet: string;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No matching team history found.';
  return results
    .map((r, i) => {
      const who = r.sender ?? 'document';
      const when = r.createdAt.slice(0, 16).replace('T', ' ');
      return `${i + 1}. [#${r.room}] ${who} (${when}):\n${r.text}`;
    })
    .join('\n\n');
}

export function formatCitations(citations: AnswerCitation[]): string {
  if (citations.length === 0) return '';
  const lines = citations.map(
    (c) =>
      `[${c.index}] ${c.sender ?? 'document'}${c.createdAt ? ` (${c.createdAt.slice(0, 16).replace('T', ' ')})` : ''}: ${c.snippet}`,
  );
  return `\n\nSources:\n${lines.join('\n')}`;
}

export function formatAnswer(answer: string, citations: AnswerCitation[], cached: boolean): string {
  return `${answer}${cached ? '\n\n(served from cache)' : ''}${formatCitations(citations)}`;
}
