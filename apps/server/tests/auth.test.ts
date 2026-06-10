import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
} from './helpers/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
});

afterAll(async () => {
  await stopTestServer(ctx);
});

describe('POST /auth/register', () => {
  it('creates an account and returns an access token plus a refresh cookie', async () => {
    const res = await request(ctx.app)
      .post('/auth/register')
      .send({ username: 'alice_reg', password: 'a-strong-password', displayName: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({ username: 'alice_reg', displayName: 'Alice' });
    expect(res.body.user.avatarSeed).toBeTypeOf('string');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = res.get('Set-Cookie')?.find((c) => c.startsWith('parley_refresh='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
  });

  it('rejects a duplicate username with 409, case-insensitively', async () => {
    await registerUser(ctx, { username: 'bob_dup' });
    const res = await request(ctx.app)
      .post('/auth/register')
      .send({ username: 'BOB_DUP', password: 'another-password', displayName: 'Bob Two' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects invalid payloads with 400', async () => {
    const tooShort = await request(ctx.app)
      .post('/auth/register')
      .send({ username: 'ab', password: 'a-strong-password', displayName: 'X' });
    expect(tooShort.status).toBe(400);

    const badChars = await request(ctx.app)
      .post('/auth/register')
      .send({ username: 'has space', password: 'a-strong-password', displayName: 'X' });
    expect(badChars.status).toBe(400);

    const shortPassword = await request(ctx.app)
      .post('/auth/register')
      .send({ username: 'validname', password: 'short', displayName: 'X' });
    expect(shortPassword.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('returns a token for valid credentials', async () => {
    await registerUser(ctx, { username: 'carol_login', password: 'carols-password-1' });
    const res = await request(ctx.app)
      .post('/auth/login')
      .send({ username: 'carol_login', password: 'carols-password-1' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('rejects a wrong password and an unknown user identically', async () => {
    await registerUser(ctx, { username: 'dave_login', password: 'daves-password-1' });
    const wrongPassword = await request(ctx.app)
      .post('/auth/login')
      .send({ username: 'dave_login', password: 'not-the-password' });
    const unknownUser = await request(ctx.app)
      .post('/auth/login')
      .send({ username: 'nobody_here', password: 'whatever-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(unknownUser.body.error.code);
  });
});

describe('POST /auth/refresh', () => {
  it('issues a fresh access token from the refresh cookie', async () => {
    const user = await registerUser(ctx);
    expect(user.refreshCookie).toBeDefined();

    const res = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', user.refreshCookie as string);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');

    const me = await request(ctx.app)
      .get('/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.userId);
  });

  it('rejects a missing or garbage cookie', async () => {
    const missing = await request(ctx.app).post('/auth/refresh');
    expect(missing.status).toBe(401);

    const garbage = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', 'parley_refresh=not-a-jwt');
    expect(garbage.status).toBe(401);
  });

  it('rejects an access token used as a refresh token', async () => {
    const user = await registerUser(ctx);
    const res = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', `parley_refresh=${user.accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /me', () => {
  it('returns the authenticated user', async () => {
    const user = await registerUser(ctx);
    const res = await request(ctx.app)
      .get('/me')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
  });

  it('rejects missing and malformed tokens', async () => {
    const missing = await request(ctx.app).get('/me');
    expect(missing.status).toBe(401);

    const malformed = await request(ctx.app).get('/me').set('Authorization', 'Bearer junk');
    expect(malformed.status).toBe(401);
  });
});
