# Evals

Every number on this page came from a script in this repo, run on 2026-06-11
against the seeded demo workspace. Rerun them yourself:

```bash
pnpm seed:demo
pnpm ai:eval --compare
pnpm ai:metrics
```

## Method

- Golden dataset: 30 question and answer pairs over the `pnpm seed:demo`
  workspace, committed at `apps/server/eval/golden.json`. Each item names the
  room and a stable substring of the message (or pdf chunk) that answers the
  question; the runner resolves anchors to live ids at run time, so the set
  survives reseeding.
- Retrieval metrics: recall@5 (was the answering source in the top five
  fused results) and MRR (reciprocal rank of the first relevant source),
  measured through the exact production path: hybrid vector plus lexical
  retrieval, RRF fusion at k=60, permission filter as the demo user.
- Answer faithfulness uses an LLM-as-judge rubric and runs only when a real
  provider key is configured. The mock provider cannot grade; CI checks the
  plumbing, quality numbers come from documented local runs.

## Dataset

Three rooms of seeded history: a product launch (dates, pricing, owners, one
pdf launch plan), a design crit (theme decision, empty state rules), and an
incident postmortem (root cause, impact, follow-up decision). Questions span
direct lookups ("How long was checkout down?"), attributions ("Who owns the
pricing page copy?"), and document retrieval (the launch plan pdf).

## Measured results, mock provider

| Metric                  | Rerank off         | Rerank on (top 20 to top 6)                                         |
| ----------------------- | ------------------ | ------------------------------------------------------------------- |
| recall@5                | 96.7%              | 80.0%                                                               |
| MRR                     | 0.859              | 0.636                                                               |
| Added retrieval latency | baseline (3ms avg) | none measurable with the mock (2ms avg)                             |
| Added cost per answer   | none               | none with the mock; one extra LLM call per ask with a real provider |

Read the rerank column honestly: the mock reranker is a deterministic
token-overlap heuristic, and it is measurably worse than the RRF fusion it
reorders. That is the expected result, and it is included because it proves
the comparison harness works end to end. With a real provider the rerank call
is an actual relevance judgment; rerun `pnpm ai:eval --compare` with keys
configured before drawing quality conclusions, and expect the latency and
cost columns to become nonzero.

## Operational metrics (`pnpm ai:metrics`)

From the structured AiCall log over a development session (6 calls: 3 room
asks, 1 catchup, 1 global ask, 1 decisions extraction), mock provider:

| Metric                    | Value                                             |
| ------------------------- | ------------------------------------------------- |
| answer latency p50        | 54ms                                              |
| answer latency p95        | 90ms                                              |
| avg tokens per answer     | 543 in, 71 out                                    |
| estimated cost per answer | $0 (mock); the script prices real models per call |
| cache hit rate            | 0% (semantic cache lands in a later phase)        |

Mock latency measures the pipeline (retrieval, packing, prompt assembly,
logging) without provider time. Treat it as overhead floor, not answer time.

## Known failure cases, observed in these runs

1. Paraphrase blindness on the vector leg. "What is the launch success
   metric?" misses: the answering pdf chunk says "Success metric: 200 team
   plan signups" and shares almost no tokens with the question once
   stopwords are gone. Token-overlap mock embeddings cannot bridge
   paraphrases, and the lexical leg matched the words "launch" and "metric"
   to busier messages instead. This is the canonical case where real
   embeddings should win.
2. The mock reranker actively hurts. Demoting RRF's fused ranking to a
   token-overlap ordering dropped recall@5 by 16.7 points. Lesson encoded in
   the design: rerank stays behind a flag, defaults off, and ships only with
   evidence from a real-provider run.
3. Long pdf chunks dilute similarity. The launch plan parses into a single
   chunk; questions about one sentence of it compete against the whole
   chunk's token distribution. Smaller documents would benefit from
   sentence-window chunking; the current 500-token chunks favor longer
   documents.
4. The mock answerer cites positionally ([1] and the last source), not
   semantically. Citation mapping, persistence, and jumps are fully
   testable, but citation precision cannot be evaluated without a real
   provider.
