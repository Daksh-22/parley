import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import mongoose from 'mongoose';
import type { Server } from 'socket.io';
import request from 'supertest';
import { connectMongo, disconnectMongo } from '../../src/lib/mongo.js';
import { connectRedis, disconnectRedis, redis } from '../../src/lib/redis.js';
import { createApp } from '../../src/http/app.js';
import { createIo } from '../../src/realtime/io.js';
import { ensureSeedRooms } from '../../src/models/seed.js';
import { User } from '../../src/models/user.model.js';
import { Room } from '../../src/models/room.model.js';
import { Membership } from '../../src/models/membership.model.js';
import { Message } from '../../src/models/message.model.js';

export interface TestContext {
  app: Express;
  httpServer: HttpServer;
  io: Server;
  url: string;
}

export async function startTestServer(): Promise<TestContext> {
  await connectMongo();
  await connectRedis();
  await mongoose.connection.db?.dropDatabase();
  await redis.flushdb();
  // Unique indexes must exist before duplicate-key behavior can be asserted.
  await Promise.all([User.init(), Room.init(), Membership.init(), Message.init()]);
  await ensureSeedRooms();

  const app = createApp();
  const httpServer = createServer(app);
  const io = createIo(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { app, httpServer, io, url: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ctx.io.close((err) => (err ? reject(err) : resolve()));
  });
  await disconnectMongo();
  await disconnectRedis();
}

export interface TestUser {
  accessToken: string;
  userId: string;
  username: string;
  refreshCookie: string | undefined;
}

let userCounter = 0;

export async function registerUser(
  ctx: TestContext,
  overrides: { username?: string; password?: string; displayName?: string } = {},
): Promise<TestUser> {
  userCounter += 1;
  const username = overrides.username ?? `user${userCounter}_${process.pid}`;
  const password = overrides.password ?? 'correct-horse-battery';
  const displayName = overrides.displayName ?? `User ${userCounter}`;
  const res = await request(ctx.app)
    .post('/auth/register')
    .send({ username, password, displayName });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = res.get('Set-Cookie');
  return {
    accessToken: res.body.accessToken as string,
    userId: res.body.user.id as string,
    username,
    refreshCookie: cookies?.find((c) => c.startsWith('parley_refresh=')),
  };
}
