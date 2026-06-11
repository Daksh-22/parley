# Deployment

Topology: the server runs on Render (or Railway, notes below) with managed MongoDB and Redis; the web app is a static Vite build on Vercel. The two sites are different origins, so CORS and cookie settings matter and are spelled out below.

## Backend on Render

Create a Web Service from the repo.

| Setting           | Value                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Runtime           | Node 22                                                                                   |
| Build command     | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @parley/server build` |
| Start command     | `node apps/server/dist/index.js`                                                          |
| Health check path | `/healthz`                                                                                |

PORT comes from the platform. Do not set it yourself: Render injects `PORT` and the server already binds `process.env.PORT`. The health check returns 200 only when Mongo and Redis are both reachable, so failed deploys surface immediately.

Websockets: Render supports them natively, nothing to enable. The client connects with `transports: ['websocket']` only, so no sticky sessions are needed if you scale to multiple instances; the Redis adapter (already wired) handles cross-instance fan-out. Scaling past one instance only requires that all instances share the same `REDIS_URL`.

Railway works identically: same build and start commands, same env. Railway also injects `PORT`.

### Managed datastores

- MongoDB: an Atlas free-tier cluster is fine. Allow the backend's outbound IPs (or 0.0.0.0/0 while testing), create a database user, and use the `mongodb+srv://` string as `MONGO_URI`.
- Redis: Upstash or Render Key Value. Use the `rediss://` TLS URL as `REDIS_URL` (ioredis handles TLS from the URL scheme).

## Frontend on Vercel

| Setting          | Value                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Root directory   | `apps/web`                                                                                                                                     |
| Framework preset | Vite                                                                                                                                           |
| Build command    | `pnpm --filter @parley/web build` (run from repo root via "include files outside root", or set root to the repo and output to `apps/web/dist`) |
| Output directory | `dist`                                                                                                                                         |
| Env var          | `VITE_API_URL=https://your-backend.onrender.com`                                                                                               |

`VITE_API_URL` is baked in at build time. It must be the exact backend origin, scheme included, no trailing slash.

## Environment matrix

Every variable is validated at boot (apps/server/src/config/env.ts); the server exits with a readable message if anything is missing or malformed.

| Variable                      | Service          | Required | Notes                                                                   |
| ----------------------------- | ---------------- | -------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                    | server           | yes      | `production` in deployment; switches cookies to `SameSite=None; Secure` |
| `PORT`                        | server           | injected | Provided by Render/Railway, never hardcode                              |
| `MONGO_URI`                   | server           | yes      | Atlas connection string                                                 |
| `REDIS_URL`                   | server           | yes      | `rediss://` URL from Upstash or Render                                  |
| `JWT_ACCESS_SECRET`           | server           | yes      | `openssl rand -hex 32`; minimum 32 chars                                |
| `JWT_REFRESH_SECRET`          | server           | yes      | Different value from the access secret; boot fails if identical         |
| `ACCESS_TOKEN_TTL_SECONDS`    | server           | no       | Default 900                                                             |
| `REFRESH_TOKEN_TTL_SECONDS`   | server           | no       | Default 1209600 (14 days)                                               |
| `CORS_ORIGIN`                 | server           | yes      | Exact Vercel origin, e.g. `https://parley.vercel.app`                   |
| `LOG_LEVEL`                   | server           | no       | Default `info`                                                          |
| `AUTH_RATE_LIMIT` and friends | server           | no       | See .env.example for the full rate-limit knob list                      |
| `VITE_API_URL`                | web (build time) | yes      | Backend origin                                                          |

## CORS and cookies, what breaks and why

- The server allows exactly one origin (`CORS_ORIGIN`) with `credentials: true`. A trailing slash, a `www` mismatch, or `http` instead of `https` makes the browser drop every response. The value must match `window.location.origin` on the deployed frontend byte for byte.
- The refresh token is an httpOnly cookie scoped to `/auth`. In production it is `SameSite=None; Secure` because Vercel and Render are different sites, which means the API must be served over HTTPS or browsers will refuse to store the cookie. Both platforms terminate TLS for you.
- The access token never touches storage: it lives in memory and is re-obtained through `/auth/refresh` on page load. If "stay signed in across reloads" misbehaves, the cookie settings above are the first place to look.
- `app.set('trust proxy', 1)` is already configured so rate limiting sees the real client IP behind the platform proxy.

## Docker option

The repo ships a multi-stage Dockerfile (apps/server/Dockerfile, build context is the repo root) and a compose file with three profiles:

```bash
docker compose up -d                       # mongo + redis only (local dev infra)
docker compose --profile app up --build    # plus one server instance
docker compose --profile scale up --build  # two servers behind nginx on :4000
```

The `scale` profile is the local stand-in for multi-instance production: two server containers, one nginx with `least_conn`, both servers sharing Redis for adapter fan-out. The compose file requires `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in your shell or a root `.env` and fails fast with a message if they are absent.

## The AI stack in production

The chat core runs without any of this; deploy it first, add memory second.

### Qdrant

- Managed: Qdrant Cloud has a free 1GB cluster, plenty for tens of thousands
  of messages at 1536 dimensions. Create a cluster, then set `QDRANT_URL` to
  the cluster URL including the `:6333` port. If your cluster requires an API
  key, front it with the cluster URL form `https://<id>.cloud.qdrant.io:6333`
  and add the key support via `QDRANT_API_KEY` before going live (the local
  and compose setups do not use one).
- Self-hosted: the compose file already ships a `qdrant` service with a
  persistent volume.
- First boot creates the collection automatically; `pnpm ai:backfill` indexes
  any history that predates AI being enabled.

### Provider keys and AI env

| Variable                  | Required                      | Notes                                                                |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `AI_ENABLED`              | yes, for memory               | `false` leaves a pure chat app                                       |
| `AI_CHAT_PROVIDER`        | yes                           | `anthropic`, `openai`, or `mock`                                     |
| `AI_EMBED_PROVIDER`       | yes                           | `openai` or `mock`                                                   |
| `ANTHROPIC_API_KEY`       | if chat provider is anthropic | boot fails fast if missing                                           |
| `OPENAI_API_KEY`          | if either provider is openai  | same                                                                 |
| `QDRANT_URL`              | yes                           | Qdrant Cloud or compose service URL                                  |
| `AI_DAILY_TOKEN_QUOTA`    | no                            | default 200000 tokens per user per day                               |
| `AI_CONTEXT_TOKEN_BUDGET` | no                            | default 4000, caps sources per ask                                   |
| `AI_ANSWER_MAX_TOKENS`    | no                            | default 700                                                          |
| `AI_TIMEOUT_MS`           | no                            | default 30000                                                        |
| `RERANK_ENABLED`          | no                            | keep `false` until a real-provider eval justifies it (docs/EVALS.md) |

Operational notes: the ingest worker runs inside the server process, so no
extra dyno is needed; quotas live in Redis and reset by UTC day; the circuit
breaker is per instance and needs no configuration to be safe. Watch cost
with `pnpm ai:metrics` against the production database.
