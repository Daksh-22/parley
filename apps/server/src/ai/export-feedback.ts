// Exports user feedback on AI answers into the eval candidate set.
// Run with: pnpm ai:export-feedback
// Output: eval/feedback-candidates.json, the raw material for growing the
// golden dataset. This is the feedback flywheel described in docs/PRODUCT.md.
/* eslint-disable no-console -- operational script, stdout is the interface */
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectMongo, disconnectMongo } from '../lib/mongo.js';
import { AiCall } from '../models/ai-call.model.js';

async function main(): Promise<void> {
  await connectMongo();
  const rated = await AiCall.find({ verdict: { $ne: null } })
    .sort({ createdAt: -1 })
    .limit(1000);

  const candidates = rated.map((call) => ({
    question: call.question,
    answer: call.answer,
    verdict: call.verdict,
    retrievedKeys: call.sourceKeys,
    kind: call.kind,
    provider: call.provider,
    createdAt: call.createdAt.toISOString(),
  }));

  mkdirSync('eval', { recursive: true });
  writeFileSync('eval/feedback-candidates.json', JSON.stringify(candidates, null, 2));
  console.log(
    `Exported ${candidates.length} rated answers (${candidates.filter((c) => c.verdict === 'down').length} thumbs down) to eval/feedback-candidates.json`,
  );
  await disconnectMongo();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Export failed:', err);
  process.exit(1);
});
