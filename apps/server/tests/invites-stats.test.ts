import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  startTestServer,
  stopTestServer,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers/harness.js';

let ctx: TestContext;
let host: TestUser;
let roomId: string;

beforeAll(async () => {
  ctx = await startTestServer();
  host = await registerUser(ctx, { username: 'host_inv' });
  const created = await request(ctx.app)
    .post('/rooms')
    .set('Authorization', `Bearer ${host.accessToken}`)
    .send({ name: 'invite room' });
  roomId = created.body.room.id as string;
});

afterAll(async () => {
  await stopTestServer(ctx);
});

function tokenFromUrl(url: string): string {
  return url.split('/invite/')[1] as string;
}

describe('invite links', () => {
  it('creates, previews, redeems, and enforces the redemption ceiling', async () => {
    const created = await request(ctx.app)
      .post(`/rooms/${roomId}/invites`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ maxRedemptions: 1 });
    expect(created.status).toBe(201);
    const token = tokenFromUrl(created.body.url as string);

    // Public preview shows the room name and nothing else.
    const preview = await request(ctx.app).get(`/invites/${token}`);
    expect(preview.body).toEqual({ valid: true, roomName: 'invite room' });

    // A stranger redeems and becomes a member.
    const guest = await registerUser(ctx, { username: 'guest_inv' });
    const redeemed = await request(ctx.app)
      .post(`/invites/${token}/redeem`)
      .set('Authorization', `Bearer ${guest.accessToken}`);
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.room.isMember).toBe(true);

    // The ceiling: a second guest is refused on the single-use invite.
    const second = await registerUser(ctx, { username: 'guest2_inv' });
    const refused = await request(ctx.app)
      .post(`/invites/${token}/redeem`)
      .set('Authorization', `Bearer ${second.accessToken}`);
    expect(refused.status).toBe(410);

    // Existing members do not burn redemptions: the preview reports spent.
    const previewAfter = await request(ctx.app).get(`/invites/${token}`);
    expect(previewAfter.body.valid).toBe(false);
  });

  it('revocation kills an invite immediately', async () => {
    const created = await request(ctx.app)
      .post(`/rooms/${roomId}/invites`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({});
    const token = tokenFromUrl(created.body.url as string);
    const inviteId = created.body.id as string;

    await request(ctx.app)
      .post(`/invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${host.accessToken}`);

    const guest = await registerUser(ctx, { username: 'guest3_inv' });
    const denied = await request(ctx.app)
      .post(`/invites/${token}/redeem`)
      .set('Authorization', `Bearer ${guest.accessToken}`);
    expect(denied.status).toBe(410);
    expect((await request(ctx.app).get(`/invites/${token}`)).body.valid).toBe(false);
  });

  it('only members can mint invites', async () => {
    const outsider = await registerUser(ctx, { username: 'outsider_inv' });
    const denied = await request(ctx.app)
      .post(`/rooms/${roomId}/invites`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({});
    expect(denied.status).toBe(403);
  });
});

describe('public stats', () => {
  it('returns aggregate totals only, nothing private', async () => {
    const res = await request(ctx.app).get('/stats');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'aiAnswersServed',
      'messagesStored',
      'uptimeSeconds',
    ]);
    expect(typeof res.body.messagesStored).toBe('number');
    // No content, no usernames, no room names anywhere in the payload.
    const flat = JSON.stringify(res.body);
    expect(flat).not.toMatch(/invite room|host_inv|guest_inv/);
  });
});
