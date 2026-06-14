# Parley — Deployment Guide

The live setup is **frontend on Netlify**, **backend on Railway**, **databases
on managed cloud** (MongoDB Atlas, Redis Cloud, Qdrant Cloud).

```
Browser ──HTTPS──▶ Netlify (React static)  ──REST + WebSocket──▶ Railway (Node server)
                                                                    │
                                          ┌─────────────────────────┼─────────────────────────┐
                                     MongoDB Atlas              Redis Cloud              Qdrant Cloud
```

Your URLs:
- Frontend: **https://aquamarine-pavlova-84ce7c.netlify.app**
- Backend: `https://<your-app>.up.railway.app` (Railway → Settings → Networking → **Generate Domain** if you don't have one yet)

> The app is built so the chat core needs only Mongo + Redis. AI memory
> (Recall / Catch-me-up) is optional and runs keyless on the mock provider.

---

## Why earlier deploys failed (so it doesn't repeat)

- **Frontend talked to `localhost`** — Vite bakes `VITE_API_URL` in **at build
  time**. Without it set in Netlify, the built site calls `http://localhost:4000`.
  Setting it requires a **rebuild**, not just a save.
- **Backend crashed on boot** — `apps/server/src/config/env.ts` validates every
  variable and exits with a clear message. The blockers seen were: `REDIS_URL`
  not a `redis://` URL, JWT secrets under 32 chars, and MongoDB Atlas not
  whitelisting Railway's IP.

---

## 1. MongoDB Atlas — allow Railway to connect

1. Atlas → **Network Access** → **Add IP Address** → **Allow access from anywhere**
   (`0.0.0.0/0`) → Confirm. (Railway egress IPs aren't static, so this is required.)
2. Your connection string must include the **database name** `/parley`:
   ```
   mongodb+srv://USER:PASSWORD@clustermo.ghqsk4x.mongodb.net/parley?retryWrites=true&w=majority
   ```
   (The string Atlas shows by default has `/?appName=...` with no db name — add `/parley`.)

## 2. Railway — backend env vars

Railway → your service → **Variables**. The Dockerfile already forces
`NODE_ENV=production`, which is what makes cross-site login cookies work
(`SameSite=None; Secure`). Set:

| Variable | Value | Notes |
|---|---|---|
| `MONGO_URI` | `mongodb+srv://…/parley?retryWrites=true&w=majority` | must start with `mongodb`, include `/parley` |
| `REDIS_URL` | `redis://default:PASS@HOST:PORT` | **must start with `redis://`** |
| `JWT_ACCESS_SECRET` | 32+ random chars | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | 32+ random chars, **different** | `openssl rand -hex 32` |
| `CORS_ORIGIN` | `https://aquamarine-pavlova-84ce7c.netlify.app` | exact, **no trailing slash** |

Optional — turn on AI memory (keyless, deterministic):

| Variable | Value |
|---|---|
| `AI_ENABLED` | `true` |
| `AI_CHAT_PROVIDER` | `mock` |
| `AI_EMBED_PROVIDER` | `mock` |
| `QDRANT_URL` | `https://<your-cluster>.qdrant.io:6333` |
| `QDRANT_API_KEY` | *(only if your Qdrant requires it)* |

Don't set `PORT` — Railway injects it and the server reads it. Deploy, then
confirm the backend is healthy:

```
https://<your-app>.up.railway.app/healthz   →   {"status":"ok", ...}
```
(Railway now uses `/healthz` as its healthcheck — see `railway.json`.)

## 3. Netlify — point the frontend at the backend

1. Netlify → Site configuration → **Environment variables** → Add:
   ```
   VITE_API_URL = https://<your-app>.up.railway.app
   ```
   (No trailing slash.)
2. **Deploys → Trigger deploy → Clear cache and deploy site.** This rebuild is
   what bakes the URL in — saving the variable alone does nothing.

## 4. Get data + sign in

The Atlas database starts empty. Either:

- **Register a fresh account** on the live site, or
- **Seed the demo workspace** into Atlas from your machine:
  ```bash
  MONGO_URI="mongodb+srv://USER:PASS@clustermo.ghqsk4x.mongodb.net/parley?retryWrites=true&w=majority" \
  REDIS_URL="redis://default:PASS@HOST:PORT" \
  JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  CORS_ORIGIN="https://aquamarine-pavlova-84ce7c.netlify.app" \
  pnpm seed:demo
  ```
  Then sign in with `demo` / `demo-password-1`.

---

## Verify it works

1. `https://<railway>/healthz` returns `"status":"ok"` (Mongo + Redis up).
2. Open the Netlify site → DevTools **Network** tab → it should call the Railway
   domain, **not** `localhost:4000`. If you still see localhost, the Netlify
   rebuild (step 3.2) didn't happen.
3. Sign in. Create a room. Open a second browser → join via an invite link →
   send a message and watch it arrive live (that proves the WebSocket path).

## Common errors → cause

| Symptom | Cause |
|---|---|
| "Route not found" / calls to `localhost:4000` | `VITE_API_URL` not set, or Netlify not rebuilt after setting it |
| Login seems to work then logs out on refresh | `CORS_ORIGIN` mismatch, or backend not on HTTPS (cookie needs `Secure`) |
| Backend logs `MongooseServerSelectionError` | Atlas IP whitelist missing `0.0.0.0/0` |
| Backend exits `invalid environment configuration` | a required var missing/short — the log names the exact field |
| Messages don't appear live | WebSocket blocked — confirm `VITE_API_URL` is the Railway **https** origin |

## Data analytics

A separate Python/Spark/Snowflake analytics pipeline lives in
[`data-pipeline/`](data-pipeline/README.md) and reads from the same MongoDB.
It is independent of this app deployment.
