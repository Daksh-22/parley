# Multi-stage build for the Parley server.
# Build context is the repo root: docker build -f apps/server/Dockerfile .

FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @parley/server --filter @parley/shared
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
RUN pnpm --filter @parley/server build
# Prune to production dependencies for the runtime image.
RUN pnpm --filter @parley/server --prod deploy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/apps/server/dist ./dist
COPY --from=builder /repo/apps/server/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
