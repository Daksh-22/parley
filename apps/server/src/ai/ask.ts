import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { citationSchema, type Citation } from '@parley/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { WsError } from '../lib/errors.js';
import { Message } from '../models/message.model.js';
import { AiCall } from '../models/ai-call.model.js';
import { getLLM } from './provider.js';
import { getUserRoomIds, hybridRetrieve, packToBudget, rerankSources } from './retrieval.js';
import { cacheLookup, cacheStore, permissionFingerprint } from './cache.js';
import { buildAnswerPrompt, extractCitations } from './answer.js';
import { quotaRemaining, recordTokenUsage } from './quota.js';
import { breakerOpen, recordProviderFailure, recordProviderSuccess } from './breaker.js';
import { getAiIo } from './events.js';
import { getPublicUser } from '../realtime/user-cache.js';
import { ghostUser, roomChannel, toMessageWire } from '../realtime/serialize.js';

export interface StreamEmitter {
  start: (event: {
    streamId: string;
    scope: 'room' | 'global' | 'catchup';
    roomId?: string;
    question: string;
    askedBy: string;
  }) => void;
  delta: (event: { streamId: string; delta: string }) => void;
  done: (event: {
    streamId: string;
    answer: string;
    citations: Citation[];
    cached: boolean;
    messageId?: string;
  }) => void;
  error: (event: { streamId: string; code: string; message: string }) => void;
}

export function roomEmitter(roomId: string): StreamEmitter {
  const channel = roomChannel(roomId);
  const io = getAiIo();
  return {
    start: (e) => io?.to(channel).emit('ai:stream:start', e),
    delta: (e) => io?.to(channel).emit('ai:stream:delta', e),
    done: (e) => io?.to(channel).emit('ai:stream:done', e),
    error: (e) => io?.to(channel).emit('ai:stream:error', e),
  };
}

export interface AskOptions {
  userId: string;
  question: string;
  scope: 'room' | 'global';
  roomId?: string;
  persistToRoom: boolean;
  // Regenerate action: skip the semantic cache but still refresh it.
  bypassCache?: boolean;
  emitter: StreamEmitter;
}

/**
 * Pre-flight checks that should reject the ask before any stream starts.
 * Throws AskError with a code the client can render calmly.
 */
export async function preflight(userId: string): Promise<void> {
  if (!env.AI_ENABLED) {
    throw new WsError('AI_DISABLED', 'Memory features are turned off on this server');
  }
  if (breakerOpen()) {
    throw new WsError('AI_UNAVAILABLE', 'Recall is taking a short break. Try again in a minute');
  }
  if ((await quotaRemaining(userId)) <= 0) {
    throw new WsError('QUOTA_EXHAUSTED', 'Daily Recall budget used. It resets at midnight UTC');
  }
}

/** Runs the full ask pipeline. Returns the streamId immediately usable in acks. */
export function startAsk(options: AskOptions): string {
  const streamId = randomUUID();
  void executeAsk(streamId, options).catch((err: unknown) => {
    logger.error({ err, streamId }, 'ask pipeline crashed');
    options.emitter.error({
      streamId,
      code: 'AI_FAILED',
      message: 'Recall could not finish this answer. Ask again',
    });
  });
  return streamId;
}

async function executeAsk(streamId: string, options: AskOptions): Promise<void> {
  const { userId, question, scope, roomId, persistToRoom, emitter } = options;
  const startedAt = Date.now();
  const llm = getLLM();

  const roomIds = await getUserRoomIds(userId, scope === 'room' ? roomId : undefined);
  if (scope === 'room' && roomIds.length === 0) {
    emitter.error({ streamId, code: 'FORBIDDEN', message: 'You are not a member of this room' });
    return;
  }

  const asker = await getPublicUser(userId);
  emitter.start({
    streamId,
    scope,
    roomId: scope === 'room' ? roomId : undefined,
    question,
    askedBy: asker?.displayName ?? 'someone',
  });

  // Semantic cache, global asks only: room asks persist shared messages and
  // always run fresh. The fingerprint bakes in the permission set, so any
  // membership or room-memory change misses by construction.
  const fingerprint = permissionFingerprint(roomIds, 'global');
  if (scope === 'global' && !options.bypassCache) {
    const cached = await cacheLookup(fingerprint, question);
    if (cached) {
      await logCall({
        streamId,
        userId,
        kind: 'global-ask',
        question,
        answer: cached.answer,
        sourceKeys: [],
        retrievalHits: cached.citations.length,
        tokensIn: cached.tokensIn,
        tokensOut: cached.tokensOut,
        latencyMs: Date.now() - startedAt,
        ok: true,
        errorCode: null,
        cached: true,
      });
      emitter.done({ streamId, answer: cached.answer, citations: cached.citations, cached: true });
      return;
    }
  }

  let retrieved = await hybridRetrieve(question, roomIds, env.RERANK_ENABLED ? 20 : 12);
  if (env.RERANK_ENABLED) retrieved = await rerankSources(question, retrieved, 6);
  const sources = packToBudget(retrieved);
  const prompt = await buildAnswerPrompt(question, sources);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const result = await llm.completeStreaming(
      {
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: env.AI_ANSWER_MAX_TOKENS,
      },
      (delta) => emitter.delta({ streamId, delta }),
      controller.signal,
    );
    clearTimeout(timeout);
    recordProviderSuccess();

    const citations = z
      .array(citationSchema)
      .parse(await extractCitations(result.text, prompt.sources));

    let messageId: string | undefined;
    if (persistToRoom && scope === 'room' && roomId) {
      const aiMessage = await Message.create({
        roomId,
        senderId: userId,
        body: result.text.slice(0, 8000),
        clientMsgId: `ai-${streamId}`,
        kind: 'ai',
        citations,
        aiQuestion: question,
      });
      messageId = aiMessage._id.toHexString();
      const wire = toMessageWire(aiMessage, asker ?? ghostUser(userId));
      getAiIo()?.to(roomChannel(roomId)).emit('message:new', wire);
    }

    await recordTokenUsage(userId, result.usage.inputTokens + result.usage.outputTokens);
    if (scope === 'global') {
      await cacheStore(fingerprint, question, {
        question,
        answer: result.text,
        citations,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
        createdAt: new Date().toISOString(),
      });
    }
    await logCall({
      streamId,
      userId,
      kind: scope === 'room' ? 'room-ask' : 'global-ask',
      question,
      answer: result.text,
      sourceKeys: prompt.sources.map((s) => s.key),
      retrievalHits: prompt.sources.length,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      ok: true,
      errorCode: null,
      cached: false,
    });

    emitter.done({ streamId, answer: result.text, citations, cached: false, messageId });
  } catch (err) {
    clearTimeout(timeout);
    recordProviderFailure();
    const timedOut = controller.signal.aborted;
    await logCall({
      streamId,
      userId,
      kind: scope === 'room' ? 'room-ask' : 'global-ask',
      question,
      answer: '',
      sourceKeys: prompt.sources.map((s) => s.key),
      retrievalHits: prompt.sources.length,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
      ok: false,
      errorCode: timedOut ? 'AI_TIMEOUT' : 'AI_FAILED',
      cached: false,
    });
    logger.error({ err, streamId, timedOut }, 'ai answer failed');
    emitter.error({
      streamId,
      code: timedOut ? 'AI_TIMEOUT' : 'AI_FAILED',
      message: timedOut
        ? 'Recall took too long. Try a narrower question'
        : 'Recall could not finish this answer. Ask again',
    });
  }
}

async function logCall(fields: {
  streamId: string;
  userId: string;
  kind: 'room-ask' | 'global-ask' | 'catchup' | 'decisions';
  question: string;
  answer: string;
  sourceKeys: string[];
  retrievalHits: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ok: boolean;
  errorCode: string | null;
  cached: boolean;
}): Promise<void> {
  try {
    const llm = getLLM();
    await AiCall.create({ ...fields, provider: llm.provider, model: llm.model });
    logger.info(
      {
        streamId: fields.streamId,
        kind: fields.kind,
        provider: llm.provider,
        tokensIn: fields.tokensIn,
        tokensOut: fields.tokensOut,
        latencyMs: fields.latencyMs,
        retrievalHits: fields.retrievalHits,
        ok: fields.ok,
      },
      'ai call',
    );
  } catch (err) {
    logger.warn({ err }, 'ai call log failed');
  }
}
