import { describe, it, expect, vi, afterEach } from 'vitest';
import { callMemoryApi, formatAnswer, formatSearchResults, MemoryApiError } from '../src/lib.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callMemoryApi', () => {
  it('sends the bearer token and parses success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callMemoryApi(
      { baseUrl: 'http://x', token: 'pat_abc' },
      '/memory/search',
      { query: 'q' },
    );
    expect(result).toEqual({ results: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/memory/search');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer pat_abc');
  });

  it('maps API errors to MemoryApiError with code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'QUOTA_EXHAUSTED', message: 'Daily budget used' } }),
            { status: 429 },
          ),
        ),
    );
    await expect(
      callMemoryApi({ baseUrl: 'http://x', token: 't' }, '/memory/ask', {}),
    ).rejects.toMatchObject({
      name: 'MemoryApiError',
      status: 429,
      code: 'QUOTA_EXHAUSTED',
    });
  });
});

describe('formatters', () => {
  it('formats search results with room, sender, and time', () => {
    const text = formatSearchResults([
      {
        kind: 'message',
        room: 'ops',
        sender: 'Priya',
        createdAt: '2026-06-08T10:00:00.000Z',
        text: 'root cause was pool exhaustion',
      },
    ]);
    expect(text).toContain('[#ops] Priya (2026-06-08 10:00)');
    expect(text).toContain('pool exhaustion');
  });

  it('handles the empty case plainly', () => {
    expect(formatSearchResults([])).toBe('No matching team history found.');
  });

  it('appends sources and the cached marker to answers', () => {
    const text = formatAnswer(
      'The launch moved to Thursday [1].',
      [
        {
          index: 1,
          kind: 'message',
          sender: 'Mira',
          createdAt: '2026-06-07T11:00:00.000Z',
          snippet: 'moving the launch from Tuesday to Thursday',
        },
      ],
      true,
    );
    expect(text).toContain('(served from cache)');
    expect(text).toContain('Sources:');
    expect(text).toContain('[1] Mira');
  });

  it('throws nothing surprising for MemoryApiError shape', () => {
    const err = new MemoryApiError(403, 'FORBIDDEN', 'no');
    expect(err.code).toBe('FORBIDDEN');
  });
});
