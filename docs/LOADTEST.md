# Load test results

Real, measured numbers. Method, environment, and caveats below; nothing here
is estimated.

## Headline numbers

| Metric                                               | Value                                      |
| ---------------------------------------------------- | ------------------------------------------ |
| Concurrent websocket clients sustained               | 1,000                                      |
| Message ack latency (send to persisted + ack)        | p50 3 ms, p90 10 ms, p95 19 ms, max 562 ms |
| Broadcast delivery latency (sender to other clients) | p50 2 ms, p90 9 ms, p95 19 ms, max 563 ms  |
| Messages sent                                        | 19,823 (105/s sustained)                   |
| Messages delivered (fan-out)                         | 834,700 (4,437/s sustained)                |
| Error acks / failed HTTP requests                    | 0 / 0                                      |
| Server peak RSS                                      | 336 MB                                     |
| Server average RSS                                   | 72 MB                                      |

## Environment

- Single server instance: `node dist/index.js`, NODE_ENV=production, LOG_LEVEL=warn
- Apple M3, 8 GB RAM, macOS; MongoDB 7 (Homebrew) and Redis 7 on the same host
- k6 generator on the same host (so generator and server compete for CPU,
  which makes the latency numbers conservative rather than flattering)
- Node 22, websocket transport only

## Method

Script: [infra/loadtest/chat-load.js](../infra/loadtest/chat-load.js).

k6 has no Socket.IO client, so the script speaks the Engine.IO v4 wire
protocol over a raw websocket exactly like the production client does
(`transports: ['websocket']`): `40` connect packet with the JWT in the
handshake auth, `2`/`3` heartbeats, `42<ackId>` events, `43<ackId>` acks.

- setup: 500 users registered over HTTP (argon2 hashing dominates), 20 rooms
  created; VUs map onto users and rooms round-robin, roughly 50 clients per room
- load profile: ramp 0 to 500 VUs over 30 s, hold 30 s, ramp to 1,000 over
  30 s, hold 60 s, ramp down
- each VU joins its room, then sends one 1 KB-class message every 6 s with a
  random initial offset; every received `message:new` is acknowledged with
  `message:delivered`, exercising the receipt fan-out path under load
- ack latency is measured client-side from emit to ack; broadcast latency
  embeds `Date.now()` in the body and is computed on receipt (same host, same
  clock, so no skew)
- memory sampled from `ps -o rss` every 5 s for the whole run

Reproduce:

```bash
pnpm --filter @parley/server build
NODE_ENV=production LOG_LEVEL=warn CONN_RATE_LIMIT=1000000 AUTH_RATE_LIMIT=1000000 \
  MONGO_URI=mongodb://127.0.0.1:27017/parley-load REDIS_URL=redis://127.0.0.1:6379 \
  JWT_ACCESS_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) \
  CORS_ORIGIN=http://localhost:5173 PORT=4000 node apps/server/dist/index.js &
ulimit -n 10240
k6 run infra/loadtest/chat-load.js
```

## Caveats, honestly

- `CONN_RATE_LIMIT` and `AUTH_RATE_LIMIT` were raised for the run because all
  1,000 clients share one source IP, which the per-IP limiter would
  correctly punish in production. Message-level rate limits ran at their
  production values.
- Generator and server shared one machine. Tail latencies (max 562 ms)
  coincide with the steepest ramp segment and k6 itself competing for CPU.
- Single instance only. The two-instance redis-adapter path is covered by
  integration tests (tests/multi-instance.test.ts) and the docker compose
  `scale` profile; cross-instance latency was not load-tested here.
- Loopback networking: no real-world RTT. The numbers measure server
  processing and fan-out cost, not internet latency.
- One of 1,001 sessions errored from a script bug (a zero-delay setTimeout),
  fixed in the committed script. It dropped that VU's iteration, not the
  server.
