# Product

Positioning: chat apps store messages, Parley remembers them.

## Target user

Small product teams (5 to 50 people) that live in chat and lose decisions to
scrollback. The buyer is the team lead who keeps answering the same
questions; the daily user is anyone who returns from two days away to four
hundred unread messages.

## Jobs to be done

1. "Catch me up on what I missed without reading it all."
2. "Find what we decided, who decided it, and where, without asking again."
3. "Make the new teammate productive without a week of tribal storytelling."

## The three product bets

1. **Citations are the product, not a feature.** An uncited AI answer in a
   team tool is a rumor with confidence. Every Recall answer maps its claims
   to real messages, the chips preview on hover, and the jump lands on the
   exact source with the highlighter sweep. The interaction is built to be
   trusted, then verified in one click.
2. **Memory must obey membership, instantly.** Permission is checked at
   query time on every path: retrieval legs, the semantic cache via a
   membership fingerprint, and the MCP tools. Leave a room and its knowledge
   leaves you. This is slower than baking ACLs into the index and it is the
   right trade; the tests enforce it.
3. **The answer belongs in the conversation.** @recall answers persist as
   room messages everyone sees, not in a private AI side panel. Team memory
   is a shared resource; asking in public makes the answer part of the
   history it came from.

## The feedback flywheel

Every AI answer carries thumbs. A verdict is persisted with the question,
the retrieved source keys, and the answer text on the call record.
`pnpm ai:export-feedback` exports the rated set into
`eval/feedback-candidates.json`, the raw material for growing the golden
dataset in `apps/server/eval/golden.json`. Bad answers become eval cases;
eval cases gate retrieval changes; retrieval changes are measured by
`pnpm ai:eval` before they ship. Usage makes the product measurably better,
with humans in the loop at both ends.

## Privacy stance, stated plainly

Memory is per-room and consent-shaped: any member can switch a room's memory
off, and when it is off nothing from that room is embedded, retrieved, or
sent to a model. The switch is enforced server-side at ingestion, retrieval,
and every ask surface, not hidden in a client preference. Parley is not end
to end encrypted because a memory product has to read content to embed it;
we state that tradeoff in ARCHITECTURE.md instead of implying otherwise.

## Deliberately not built

- **Autonomous agents and tool use.** The AI layer answers questions; it
  cannot act, post, or browse. Indirect prompt injection turns agentic chat
  bots into confused deputies; an answer-only design with delimiter-wrapped
  sources keeps the blast radius at "a wrong sentence with citations".
- **Background summarization jobs.** Digests and decision extraction run on
  demand only. Ambient jobs burn tokens on rooms nobody asks about and turn
  a quota into a surprise bill.
- **Message editing and deletion, for now.** Editing requires re-embedding
  and citation invalidation done right; shipping it half-right corrupts
  memory. It is on the roadmap behind exactly that design.
- **A mobile app.** The web app is responsive and the core bet (memory) is
  testable without owning app stores this early.
- **Threads.** Threads fragment the very history Recall depends on. Catch me
  up and citations cover the recovery use case threads usually serve.
- **Exactly-once delivery claims.** At-least-once with idempotent
  persistence is achievable and tested; exactly-once is marketing.
