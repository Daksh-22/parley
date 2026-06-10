import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, type TestContext } from './helpers/harness.js';
import { getEmbedder, getLLM } from '../src/ai/provider.js';
import { pointId, searchVectors, upsertVectors } from '../src/ai/vector-store.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

const ROOM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ROOM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('mock provider round trip', () => {
  it('embeds, upserts, and retrieves deterministically with room scoping', async () => {
    const text = 'the quarterly report deadline moved to friday';
    const [vector] = await getEmbedder().embed([text]);
    expect(vector).toHaveLength(256);

    await upsertVectors([
      {
        id: pointId('test:roundtrip'),
        vector: vector as number[],
        payload: {
          kind: 'message',
          roomId: ROOM_A,
          text,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    // Same text, same vector: deterministic.
    const [again] = await getEmbedder().embed([text]);
    expect(again).toEqual(vector);

    const hits = await searchVectors(vector as number[], { roomIds: [ROOM_A], limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.payload.text).toBe(text);
    expect(hits[0]?.score).toBeGreaterThan(0.99);

    // Scoping primitives: no rooms means no knowledge, wrong room means no hit.
    expect(await searchVectors(vector as number[], { roomIds: [], limit: 5 })).toHaveLength(0);
    const wrongRoom = await searchVectors(vector as number[], { roomIds: [ROOM_B], limit: 5 });
    expect(wrongRoom.find((h) => h.payload.text === text)).toBeUndefined();
  });

  it('streams a canned completion and reports usage', async () => {
    const deltas: string[] = [];
    const result = await getLLM().completeStreaming(
      {
        system: 'test',
        messages: [{ role: 'user', content: '[1] BEGIN SOURCE hello END SOURCE\nQuestion: hi' }],
        maxTokens: 100,
      },
      (delta) => deltas.push(delta),
    );
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(result.text);
    expect(result.text).toContain('[1]');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('reranks deterministically by token overlap', async () => {
    const order = await getLLM().rerank(
      'redis connection pooling',
      ['mongo index strategies', 'redis connection pooling in production', 'lunch options'],
      2,
    );
    expect(order[0]).toBe(1);
    expect(order).toHaveLength(2);
  });
});

describe('healthz with AI enabled', () => {
  it('reports qdrant status without gating chat health on it', async () => {
    const res = await request(ctx.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ai).toEqual({ enabled: true, qdrant: 'ok' });
  });
});
