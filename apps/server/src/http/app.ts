import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { HttpError } from '../lib/errors.js';
import { healthzRouter } from './routes/healthz.js';
import { authRouter } from './routes/auth.js';
import { roomsRouter } from './routes/rooms.js';
import { documentsRouter } from './routes/documents.js';
import { memoryRouter } from './routes/memory.js';

export function createApp(): express.Express {
  const app = express();

  // Behind nginx or a PaaS proxy, trust the first hop so client IPs used by
  // rate limiting are real.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/healthz',
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.use(healthzRouter);
  app.use(authRouter);
  app.use(documentsRouter);
  app.use(memoryRouter);
  app.use(roomsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const errorHandler: express.ErrorRequestHandler = (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    logger.error({ err, reqId: req.id }, 'unhandled http error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
  app.use(errorHandler);

  return app;
}
