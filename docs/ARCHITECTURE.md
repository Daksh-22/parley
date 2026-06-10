# Architecture decisions

Every major decision, the rejected alternative, and the reason. File references point at the implementation so claims can be checked.

## Socket.IO over raw ws or SSE

Chosen: Socket.IO 4. Rejected: raw `ws`, Server-Sent Events.

SSE is one-directional; chat needs client-to-server events (sends, typing, receipts) on the same channel, so it was never a fit. Raw `ws` is appealing for its minimalism, but this app needs rooms, per-event acknowledgements, automatic reconnection with backoff, and a multi-instance broadcast layer. With raw ws each of those is a custom protocol to design, test, and debug. Socket.IO provides all four, and its acks are load-bearing here: every client event returns an `{ok}` envelope (packages/shared/src/schemas/events.ts), which is how optimistic sends reconcile and how rate-limit refusals reach the user with a reason. The cost is a slightly heavier wire protocol; the load test speaks it directly over raw websocket (infra/loadtest/chat-load.js) and p95 ack latency stayed at 19 ms under 1,000 concurrent clients, so the overhead is not the bottleneck.

## MongoDB over Postgres for this access pattern

Chosen: MongoDB with Mongoose 8. Rejected: Postgres.

The hot path is an append-only message log queried one room at a time, newest first, by cursor. That is a textbook fit for a compound index on `(roomId, createdAt, _id)` (apps/server/src/models/message.model.ts) with no joins on the hot path: the wire format embeds a sender summary served from a small in-process cache (apps/server/src/realtime/user-cache.ts). Postgres would handle this fine, but offers its strengths (transactions across entities, relational integrity, complex queries) where this design deliberately has no need: the only multi-document invariant is membership-before-send, enforced at the gate, and dedup is a unique index either way. Mongo's ObjectId is also doing real work: it is time-ordered, which gives the reconnect sync and read cursors a total order without a separate sequence. In an interview I would defend either choice; Mongo was picked because the access pattern never fights it.

## At-least-once delivery with idempotent writes, not exactly-once claims

Chosen: client retries plus a unique `(senderId, clientMsgId)` index. Rejected: pretending exactly-once is achievable.

A socket send can fail after the server persisted the message but before the ack arrived. The client must retry, so delivery is at least once by nature. Instead of claiming exactly-once, the write is made idempotent: the client generates a uuid per message, the database enforces uniqueness per sender, and a duplicate insert returns the original canonical message without re-broadcasting (apps/server/src/realtime/handlers.ts, message:send). The result is exactly-once persistence under at-least-once delivery, which is the honest version of the guarantee. The integration test asserts both halves: same canonical id back, and no second broadcast.

## Cursor pagination over offset pagination

Chosen: keyset cursor on `(createdAt, _id)`. Rejected: `skip/limit` offsets.

Offsets break under concurrent inserts (page 2 shifts while you read page 1, so messages duplicate or vanish) and `skip(n)` still walks n index entries, so deep history gets slower the further back you scroll. The cursor encodes the last seen `(createdAt, _id)` pair and the query asks for strictly older rows (apps/server/src/http/routes/rooms.ts), which is stable under writes and O(page) regardless of depth, served by the same compound index. The `_id` tiebreaker matters: two messages can share a createdAt millisecond, and without the tiebreaker a page boundary could drop one.

## Redis TTL presence over database polling

Chosen: `presence:online:{userId}` with a 30 s TTL, 15 s heartbeat, and a per-user connection counter. Rejected: a `lastSeenAt` column polled by clients.

DB polling gives stale answers, hammers the database proportionally to user count, and a crashed server leaves users permanently "online". TTL keys self-heal: if every instance holding a user's connections dies, the key expires and the user reads as offline with no cleanup job. The per-user connection count (apps/server/src/realtime/presence.ts) is what stops multi-tab flicker: opening a second tab increments the count and broadcasts nothing; presence transitions fire only on 0 to 1 and 1 to 0. Tradeoff accepted: a hard crash makes the user linger up to 30 s before the TTL clears them, and no event fires at expiry. Pushing expiry events would need Redis keyspace notifications; that is on the roadmap and deliberately out of scope.

## Websocket-only transport over polling fallback with sticky sessions

Chosen: `transports: ['websocket']` on the client. Rejected: Socket.IO's default long-polling upgrade dance.

Long-polling sends each poll as an independent HTTP request. Behind a load balancer, consecutive polls from one session can land on different instances, and Socket.IO requires session affinity to survive that, which means ip_hash or cookie-based stickiness in nginx and every layer in front of it. A websocket is one long-lived TCP connection: whatever instance accepts the upgrade owns the session for its lifetime, so `least_conn` balancing just works (infra/nginx.conf) and instances stay disposable. The cost is dropping support for networks that block websocket upgrades, which is acceptable for this product. Cross-instance broadcasts still need the Redis adapter either way; tests/multi-instance.test.ts proves messages, presence, and typing cross two live instances through it.

## Sender identity from the socket only

Chosen: `socket.data.userId`, set once by handshake middleware. Rejected: trusting any identity field in payloads.

The handshake middleware verifies the access JWT before the connection completes, so a connected socket implies a verified user (apps/server/src/realtime/socket-auth.ts). Every payload schema is a zod object that strips unknown keys, so a hostile `senderId` in a payload does not merely get checked, it never reaches the handler at all (apps/server/src/realtime/ack.ts). Impersonation would require forging the JWT, not crafting a payload. The forged-sender integration test sends a payload claiming to be another user and asserts the persisted and broadcast sender is the socket's owner.

## Read cursors on Membership over per-message read arrays

Chosen: `lastReadMessageId` and `lastReadAt` on the membership row. Rejected: `readBy: [userId]` arrays on messages.

Read arrays grow with members times messages, bloat every message document, and make "unread count" a scatter query. A cursor is O(1) state per member per room: unread count is "messages newer than my cursor, not sent by me", served by the `(roomId, _id)` index (apps/server/src/services/room-service.ts). The cursor update is conditional in the database (`$lt` guard in apps/server/src/realtime/handlers.ts), so a stale receipt from a lagging tab can never move read state backwards, and only actual moves broadcast.

## Client state: a bespoke store for push, TanStack Query for request/response

Chosen: a small `useSyncExternalStore` store (apps/web/src/state/chat-store.ts) owning everything the socket pushes. Rejected: forcing socket state into TanStack Query's cache, or adding a state library.

Query's model is "fetch on demand, cache by key, refetch when stale". Socket pushes invert that: the server decides when data changes. Modeling pushed messages as query invalidations would mean a refetch per message, defeating the socket. The store owns messages, receipts, presence, and typing, replaces arrays and maps immutably so selector identity changes exactly when content changes, and the optimistic send lifecycle (sending, reconcile on ack by clientMsgId, failed with retry) is explicit application logic rather than cache gymnastics. Auth and room/member fetches remain plain HTTP through a thin typed client.

## Rate limiting as one atomic Lua script over naive counters

Chosen: a sorted-set sliding window plus a mute key, evaluated atomically in Redis (apps/server/src/realtime/rate-limit.ts). Rejected: INCR-with-expiry counters, or in-process token buckets.

Fixed-window INCR counters allow double the limit across a window boundary, and a separate check-then-set mute has a race where concurrent sends each pass the check. The Lua script removes expired entries, counts, decides, and sets the mute in one atomic step, and on violation it deletes the window so the mute key is the single source of truth for "when can I speak again", which is exactly what the error ack reports to the user. In-process buckets were rejected because limits must hold across instances: the same user connected to server A and server B shares one budget in Redis.

## Graceful shutdown drains presence writes

Order: stop accepting and disconnect sockets (`io.close`), await in-flight presence writes, then close Mongo and Redis (apps/server/src/index.ts). The drain exists because disconnect handlers write `lastSeenAt` and delete presence keys asynchronously; closing the database connections first turns every one of those into an error. The presence module tracks its in-flight promises and exposes `drainPresence()` (apps/server/src/realtime/presence.ts). This was not theoretical: the test suite surfaced the race as MongoNotConnectedError noise during teardown before the drain existed.

## Shared package ships TypeScript source, bundled at the edges

Chosen: `@parley/shared` exports `src/index.ts` directly; tsx and Vite consume it as source, and tsup bundles it into the server image with `noExternal` (apps/server/tsup.config.ts). Rejected: building the shared package to dist with project references.

Built artifacts add a rebuild step between editing a schema and seeing it in either app, and project references complicate every watcher. Source-first internal packages have no drift: server and client always compile against the same schema text. The cost lands solely in the server's production build, where tsup inlines the shared code into one file, so the runtime image needs no workspace layout at all.
