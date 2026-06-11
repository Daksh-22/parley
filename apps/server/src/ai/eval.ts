// Retrieval eval against the golden set over the seeded demo workspace.
// Run with: pnpm ai:eval            (current RERANK_ENABLED setting)
//          pnpm ai:eval --compare   (rerank off vs on, side by side)
// Measures recall@5 and MRR. Answer faithfulness via LLM-as-judge runs only
// when a real provider key is configured; the mock provider cannot grade.
/* eslint-disable no-console -- operational script, stdout is the interface */
import { readFileSync } from 'node:fs';
import { connectMongo, disconnectMongo } from '../lib/mongo.js';
import { connectRedis, disconnectRedis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { Message } from '../models/message.model.js';
import { DocumentModel } from '../models/document.model.js';
import { Room } from '../models/room.model.js';
import { getUserRoomIds, hybridRetrieve, rerankSources } from './retrieval.js';
import { chunkDocument } from './ingest/chunker.js';

interface GoldenExpect {
  room: string;
  contains: string;
  kind?: 'doc';
}

interface GoldenItem {
  question: string;
  expect: GoldenExpect[];
}

interface EvalResult {
  recallAt5: number;
  mrr: number;
  avgLatencyMs: number;
  misses: { question: string; expectedKey: string }[];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolves a golden anchor to the retrieval key it should produce. */
async function resolveExpectedKey(expect: GoldenExpect): Promise<string> {
  const room = await Room.findOne({ slug: expect.room });
  if (!room) throw new Error(`room ${expect.room} not found. Run pnpm seed:demo first`);
  if (expect.kind === 'doc') {
    const doc = await DocumentModel.findOne({
      roomId: room._id,
      text: new RegExp(escapeRegex(expect.contains)),
    });
    if (!doc) throw new Error(`no document contains "${expect.contains}"`);
    const chunks = chunkDocument(doc.text, doc.pageOffsets);
    const index = chunks.findIndex((c) => c.text.includes(expect.contains));
    if (index < 0) throw new Error(`no chunk contains "${expect.contains}"`);
    return `doc:${doc._id.toHexString()}:${index}`;
  }
  const message = await Message.findOne({
    roomId: room._id,
    body: new RegExp(escapeRegex(expect.contains)),
  });
  if (!message) throw new Error(`no message contains "${expect.contains}"`);
  return `message:${message._id.toHexString()}`;
}

async function runEval(
  items: GoldenItem[],
  roomIds: string[],
  rerank: boolean,
): Promise<EvalResult> {
  let recallSum = 0;
  let mrrSum = 0;
  let latencySum = 0;
  const misses: { question: string; expectedKey: string }[] = [];

  for (const item of items) {
    const expectedKeys = await Promise.all(item.expect.map(resolveExpectedKey));
    const started = Date.now();
    let sources = await hybridRetrieve(item.question, roomIds, rerank ? 20 : 12);
    if (rerank) sources = await rerankSources(item.question, sources, 6);
    latencySum += Date.now() - started;

    const top5 = sources.slice(0, 5).map((s) => s.key);
    const found = expectedKeys.filter((key) => top5.includes(key));
    recallSum += found.length / expectedKeys.length;

    let firstRank = 0;
    for (const key of expectedKeys) {
      const rank = sources.findIndex((s) => s.key === key) + 1;
      if (rank > 0 && (firstRank === 0 || rank < firstRank)) firstRank = rank;
    }
    mrrSum += firstRank > 0 ? 1 / firstRank : 0;
    if (found.length < expectedKeys.length) {
      for (const key of expectedKeys.filter((k) => !top5.includes(k))) {
        misses.push({ question: item.question, expectedKey: key });
      }
    }
  }

  return {
    recallAt5: recallSum / items.length,
    mrr: mrrSum / items.length,
    avgLatencyMs: latencySum / items.length,
    misses,
  };
}

function printResult(label: string, result: EvalResult): void {
  console.log(`\n${label}`);
  console.log(`  recall@5      ${(result.recallAt5 * 100).toFixed(1)}%`);
  console.log(`  MRR           ${result.mrr.toFixed(3)}`);
  console.log(`  avg latency   ${result.avgLatencyMs.toFixed(0)}ms per query`);
  if (result.misses.length > 0) {
    console.log(`  misses (${result.misses.length}):`);
    for (const miss of result.misses) console.log(`    - ${miss.question}`);
  }
}

async function main(): Promise<void> {
  const compare = process.argv.includes('--compare');
  await connectMongo();
  await connectRedis();

  const demo = await User.findOne({ username: 'demo' });
  if (!demo) {
    console.error('Demo user not found. Run pnpm seed:demo first.');
    process.exit(1);
  }
  const roomIds = await getUserRoomIds(demo._id.toHexString());
  const golden = JSON.parse(
    readFileSync(new URL('../../eval/golden.json', import.meta.url), 'utf8'),
  ) as { items: GoldenItem[] };

  console.log(
    `Eval: ${golden.items.length} questions | embed provider: ${env.AI_EMBED_PROVIDER} | chat provider: ${env.AI_CHAT_PROVIDER}`,
  );
  if (env.AI_EMBED_PROVIDER === 'mock') {
    console.log(
      'Note: mock embeddings are token-overlap vectors. Real-provider numbers require keys and a local rerun.',
    );
  }

  if (compare) {
    printResult('rerank off', await runEval(golden.items, roomIds, false));
    printResult('rerank on (top 20 -> top 6)', await runEval(golden.items, roomIds, true));
  } else {
    printResult(
      env.RERANK_ENABLED ? 'rerank on' : 'rerank off',
      await runEval(golden.items, roomIds, env.RERANK_ENABLED),
    );
  }

  if (env.AI_CHAT_PROVIDER === 'mock') {
    console.log('\nFaithfulness judge skipped: requires a real provider key.');
  }

  await disconnectMongo();
  await disconnectRedis();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
