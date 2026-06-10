import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export async function connectMongo(): Promise<void> {
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongo connection error');
  });
  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info({ uri: redactUri(env.MONGO_URI) }, 'mongo connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('mongo disconnected');
}

export function mongoHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}

function redactUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return 'mongodb://(unparseable)';
  }
}
