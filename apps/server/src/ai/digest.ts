import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { citationSchema, decisionsResultSchema, type DecisionsResult } from '@parley/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Membership } from '../models/membership.model.js';
import { Message } from '../models/message.model.js';
import { AiCall } from '../models/ai-call.model.js';
import { getLLM } from './provider.js';
import { packToBudget, type RetrievedSource } from './retrieval.js';
import { buildAnswerPrompt, extractCitations, RECALL_SYSTEM_PROMPT } from './answer.js';
import { recordTokenUsage } from './quota.js';
import { recordProviderFailure, recordProviderSuccess } from './breaker.js';
import { getPublicUser } from '../realtime/user-cache.js';
import type { StreamEmitter } from './ask.js';

const CATCHUP_MESSAGE_CAP = 200;
const DECISIONS_MESSAGE_CAP = 200;

function toSource(message: {
  _id: { toHexString(): string };
  roomId: { toHexString(): string };
  senderId: { toHexString(): string };
  body: string;
  createdAt: Date;
}): RetrievedSource {
  return {
    key: `message:${message._id.toHexString()}`,
    kind: 'message',
    roomId: message.roomId.toHexString(),
    text: message.body,
    createdAt: message.createdAt.toISOString(),
    score: 0,
    messageId: message._id.toHexString(),
    senderId: message.senderId.toHexString(),
  };
}

/**
 * Catch me up: a cited digest of everything since the user's read cursor.
 * Private to the asker, never persisted. The caller has already verified
 * membership, the room gate, and preflight.
 */
export function startCatchup(options: {
  userId: string;
  roomId: string;
  sinceMessageId?: string;
  emitter: StreamEmitter;
}): string {
  const streamId = randomUUID();
  void executeCatchup(streamId, options).catch((err: unknown) => {
    logger.error({ err, streamId }, 'catchup crashed');
    options.emitter.error({
      streamId,
      code: 'AI_FAILED',
      message: 'Recall could not build this digest. Try again',
    });
  });
  return streamId;
}

async function executeCatchup(
  streamId: string,
  {
    userId,
    roomId,
    sinceMessageId,
    emitter,
  }: { userId: string; roomId: string; sinceMessageId?: string; emitter: StreamEmitter },
): Promise<void> {
  const startedAt = Date.now();
  const membership = await Membership.findOne({ userId, roomId });
  // The client-supplied boundary only narrows messages inside a room the
  // caller already passed the membership gate for; it cannot widen access.
  const cursor = sinceMessageId ?? membership?.lastReadMessageId ?? null;

  const missed = await Message.find({
    roomId,
    kind: { $ne: 'ai' },
    body: { $not: /^@recall / },
    senderId: { $ne: userId },
    ...(cursor ? { _id: { $gt: cursor } } : {}),
  })
    .sort({ _id: 1 })
    .limit(CATCHUP_MESSAGE_CAP);

  const asker = await getPublicUser(userId);
  emitter.start({
    streamId,
    scope: 'catchup',
    roomId,
    question: 'Catch me up',
    askedBy: asker?.displayName ?? 'someone',
  });

  if (missed.length === 0) {
    emitter.done({
      streamId,
      answer: 'Nothing new since you last read this room.',
      citations: [],
      cached: false,
    });
    return;
  }

  const sources = packToBudget(missed.map(toSource));
  const prompt = await buildAnswerPrompt(
    'Write a short digest of the conversation above for someone catching up: two to five tight bullet points covering what happened and what was decided. Cite sources.',
    sources,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const result = await getLLM().completeStreaming(
      {
        system: RECALL_SYSTEM_PROMPT,
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
    await recordTokenUsage(userId, result.usage.inputTokens + result.usage.outputTokens);
    await AiCall.create({
      streamId,
      userId,
      kind: 'catchup',
      provider: getLLM().provider,
      model: getLLM().model,
      question: 'Catch me up',
      answer: result.text,
      sourceKeys: prompt.sources.map((s) => s.key),
      retrievalHits: prompt.sources.length,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      cached: false,
      ok: true,
    }).catch((err: unknown) => logger.warn({ err }, 'ai call log failed'));
    emitter.done({ streamId, answer: result.text, citations, cached: false });
  } catch (err) {
    clearTimeout(timeout);
    recordProviderFailure();
    logger.error({ err, streamId }, 'catchup failed');
    emitter.error({
      streamId,
      code: controller.signal.aborted ? 'AI_TIMEOUT' : 'AI_FAILED',
      message: 'Recall could not build this digest. Try again',
    });
  }
}

/**
 * Extract decisions: on-demand structured output over recent room history.
 * Source message ids are validated against the exact set shown to the model,
 * so a hallucinated id can never become a citation.
 */
export async function extractDecisions(userId: string, roomId: string): Promise<DecisionsResult> {
  const startedAt = Date.now();
  const recent = await Message.find({
    roomId,
    kind: { $ne: 'ai' },
    body: { $not: /^@recall / },
  })
    .sort({ _id: -1 })
    .limit(DECISIONS_MESSAGE_CAP);
  recent.reverse();

  const validIds = new Set(recent.map((m) => m._id.toHexString()));
  const lines: string[] = [];
  for (const message of recent) {
    const sender = await getPublicUser(message.senderId.toHexString());
    const date = message.createdAt.toISOString().slice(0, 10);
    lines.push(
      `[id:${message._id.toHexString()}] ${date} | ${sender?.displayName ?? 'unknown'}: ${message.body.replace(/\n/g, ' ')}`,
    );
  }

  const user = [
    '<sources>',
    ...lines.map((line) => `BEGIN SOURCE\n${line}\nEND SOURCE`),
    '</sources>',
    '',
    'Extract every concrete decision made in the conversation above. For each: the decision in one sentence, who made or announced it, the date, and the ids of the source messages (the [id:...] values). Only include real decisions, not proposals or questions. Return nothing if no decisions were made.',
  ].join('\n');

  const llm = getLLM();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const { data, usage } = await llm.completeStructured(
      {
        system: RECALL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
        maxTokens: env.AI_ANSWER_MAX_TOKENS,
      },
      decisionsResultSchema,
      controller.signal,
    );
    clearTimeout(timeout);
    recordProviderSuccess();

    // Hallucination guard: ids must come from the provided set.
    const decisions = data.decisions
      .map((d) => ({ ...d, sourceMessageIds: d.sourceMessageIds.filter((id) => validIds.has(id)) }))
      .filter((d) => d.sourceMessageIds.length > 0);

    await recordTokenUsage(userId, usage.inputTokens + usage.outputTokens);
    await AiCall.create({
      streamId: randomUUID(),
      userId,
      kind: 'decisions',
      provider: llm.provider,
      model: llm.model,
      question: 'Extract decisions',
      answer: JSON.stringify(decisions).slice(0, 4000),
      sourceKeys: decisions.flatMap((d) => d.sourceMessageIds.map((id) => `message:${id}`)),
      retrievalHits: recent.length,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      cached: false,
      ok: true,
    }).catch((err: unknown) => logger.warn({ err }, 'ai call log failed'));

    return { decisions };
  } catch (err) {
    clearTimeout(timeout);
    recordProviderFailure();
    throw err;
  }
}
