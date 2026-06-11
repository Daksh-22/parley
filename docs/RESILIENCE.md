# Resilience

A chat app's resilience claim is testable: kill a server mid-conversation
and count the messages afterward. This repo ships that test as a script.

## The chaos run

```bash
pnpm chaos
```

What it does, in order:

1. Boots two real server instances (separate processes) sharing one Redis
   and one Mongo through the Socket.IO redis adapter: the same topology as
   the docker compose `scale` profile, with the script itself standing in
   for the nginx hop. On machines with Docker, the compose variant is
   `docker compose --profile scale up` with the script pointed at :4000.
2. Registers two users; alice connects to instance A, bob to instance B, so
   every message crosses instances through the adapter from the start.
3. Drives a 20-message scripted conversation, alternating senders.
4. After message 10, SIGKILLs instance A. No graceful shutdown, no warning.
5. Plays the load balancer: reconnects the orphaned client to instance B and
   replays the reconnect path a real client uses, `sync:since` from the last
   message id it saw.
6. Continues the conversation to message 20, then asserts both clients hold
   every sent message exactly once, and prints a pass or fail report with
   timings.

## Measured result (2026-06-11, Apple M3, local Redis, Mongo, two instances)

```
chaos report
  messages sent          20
  alice received         20/20
  bob received           20/20
  kill to resync         15ms
  total run              6170ms
  result                 PASS
```

Zero message loss across a hard kill: messages persisted before broadcast
are the source of truth, and the reconnect sync replays exactly the gap.

## Why this works, mechanically

- Persist first: `message:send` writes to Mongo before broadcasting, so a
  killed instance can lose sockets but never acknowledged messages.
- At-least-once with idempotent persistence: a retried send after the kill
  cannot duplicate (unique sender plus clientMsgId index).
- Websocket-only transport means the surviving instance can accept the
  orphaned client with no session state handoff.
- `sync:since` returns the missed window per room, capped, with a refetch
  flag for long gaps.

Record the run as a GIF: `pnpm chaos` prints its narrative to stdout in
about six seconds, which fits a terminal screen recording.
