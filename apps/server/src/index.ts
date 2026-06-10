import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectMongo, disconnectMongo } from './lib/mongo.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { createApp } from './http/app.js';
import { createIo } from './realtime/io.js';
import { drainPresence } from './realtime/presence.js';
import { ensureSeedRooms } from './models/seed.js';

async function main(): Promise<void> {
  await connectMongo();
  await connectRedis();
  await ensureSeedRooms();

  if (env.AI_ENABLED) {
    // AI infrastructure failures must never block chat. If Qdrant is down at
    // boot, AI surfaces show their unavailable state and chat runs normally.
    try {
      const { ensureCollection } = await import('./ai/vector-store.js');
      await ensureCollection();
      const { startIngestWorker } = await import('./ai/ingest/queue.js');
      startIngestWorker();
      logger.info('ai layer ready');
    } catch (err) {
      logger.error({ err }, 'ai layer failed to initialize, chat continues without it');
    }
  }

  const app = createApp();
  const httpServer = createServer(app);
  const io = createIo(httpServer);
  if (env.AI_ENABLED) {
    const { setAiIo } = await import('./ai/events.js');
    setAiIo(io);
  }

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'parley-server listening');
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown started');

    // Failsafe: if draining hangs, exit non-zero rather than wedge forever.
    const failsafe = setTimeout(() => {
      logger.error('shutdown failsafe reached, forcing exit');
      process.exit(1);
    }, 10_000);
    failsafe.unref();

    try {
      // io.close() stops the HTTP listener and disconnects every socket.
      await new Promise<void>((resolve, reject) => {
        io.close((err) => (err ? reject(err) : resolve()));
      });
      // Socket disconnect handlers write presence state; let them land
      // before tearing down the connections they write to.
      await drainPresence();
      if (env.AI_ENABLED) {
        const { stopIngestWorker } = await import('./ai/ingest/queue.js');
        await stopIngestWorker().catch(() => undefined);
      }
      await disconnectMongo();
      await disconnectRedis();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
