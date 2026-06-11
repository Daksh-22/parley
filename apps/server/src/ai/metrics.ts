// Summarizes the structured AI call logs.
// Run with: pnpm ai:metrics [--hours 24]
/* eslint-disable no-console -- operational script, stdout is the interface */
import { connectMongo, disconnectMongo } from '../lib/mongo.js';
import { AiCall } from '../models/ai-call.model.js';

// Provider pricing per million tokens (USD), as published on provider pricing
// pages, recorded 2026-06-11. Update alongside model changes.
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'mock-chat-1': { in: 0, out: 0 },
  'mock-embed-1': { in: 0, out: 0 },
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function main(): Promise<void> {
  const hoursArg = process.argv.indexOf('--hours');
  const hours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 24 * 7;
  await connectMongo();

  const since = new Date(Date.now() - hours * 3600 * 1000);
  const calls = await AiCall.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 });

  if (calls.length === 0) {
    console.log(`No AI calls in the last ${hours} hours.`);
    await disconnectMongo();
    process.exit(0);
  }

  const answers = calls.filter((c) => c.ok && !c.cached);
  const cachedHits = calls.filter((c) => c.cached);
  const latencies = answers.map((c) => c.latencyMs).sort((a, b) => a - b);
  const avgTokensOut = answers.reduce((sum, c) => sum + c.tokensOut, 0) / (answers.length || 1);
  const avgTokensIn = answers.reduce((sum, c) => sum + c.tokensIn, 0) / (answers.length || 1);

  const costOf = (c: { model: string; tokensIn: number; tokensOut: number }): number => {
    const price = PRICING[c.model] ?? { in: 0, out: 0 };
    return (c.tokensIn / 1e6) * price.in + (c.tokensOut / 1e6) * price.out;
  };
  const totalCost = answers.reduce((sum, c) => sum + costOf(c), 0);
  const savedCost = cachedHits.reduce((sum, c) => sum + costOf(c), 0);

  console.log(`AI metrics, last ${hours} hours (${calls.length} calls)`);
  console.log(
    `  requests            ${calls.length} (${answers.length} model answers, ${cachedHits.length} cache hits, ${calls.filter((c) => !c.ok).length} failures)`,
  );
  console.log(`  latency p50         ${percentile(latencies, 50)}ms`);
  console.log(`  latency p95         ${percentile(latencies, 95)}ms`);
  console.log(`  avg tokens/answer   ${avgTokensIn.toFixed(0)} in, ${avgTokensOut.toFixed(0)} out`);
  console.log(
    `  est cost/answer     $${(answers.length ? totalCost / answers.length : 0).toFixed(5)}`,
  );
  console.log(`  est total cost      $${totalCost.toFixed(4)}`);
  if (calls.length > 0) {
    console.log(`  cache hit rate      ${((cachedHits.length / calls.length) * 100).toFixed(1)}%`);
    console.log(`  est cost saved      $${savedCost.toFixed(4)}`);
  }
  const byKind = new Map<string, number>();
  for (const call of calls) byKind.set(call.kind, (byKind.get(call.kind) ?? 0) + 1);
  console.log(
    `  by kind             ${[...byKind.entries()].map(([k, n]) => `${k}:${n}`).join('  ')}`,
  );

  await disconnectMongo();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Metrics failed:', err);
  process.exit(1);
});
