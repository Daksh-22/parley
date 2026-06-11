// Demo workspace seed: three rooms of believable team history plus one pdf,
// so every memory feature works the moment the app opens.
// Run with: pnpm seed:demo (idempotent: reruns replace the demo workspace).
/* eslint-disable no-console -- operational script, stdout is the interface */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from './lib/mongo.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { env } from './config/env.js';
import { User } from './models/user.model.js';
import { Room } from './models/room.model.js';
import { Membership } from './models/membership.model.js';
import { Message } from './models/message.model.js';
import { DocumentModel } from './models/document.model.js';
import { hashPassword } from './auth/password.js';
import { buildPdf } from './lib/pdf-builder.js';
import { parseUpload } from './ai/ingest/parse-doc.js';
import { chunkDocument } from './ai/ingest/chunker.js';
import { getEmbedder } from './ai/provider.js';
import {
  deleteVectorsByRoom,
  ensureCollection,
  pointId,
  upsertVectors,
} from './ai/vector-store.js';

const DEMO_PASSWORD = 'demo-password-1';

interface SeedUser {
  username: string;
  displayName: string;
}

const USERS: SeedUser[] = [
  { username: 'demo', displayName: 'Demo Reviewer' },
  { username: 'mira', displayName: 'Mira Chen' },
  { username: 'jonas', displayName: 'Jonas Webb' },
  { username: 'priya', displayName: 'Priya Nair' },
];

// d = days ago, h = hour of day. Content is the demo: written to be worth
// reading, with real decisions, an incident, and threads that overlap rooms.
interface SeedMessage {
  room: string;
  by: string;
  d: number;
  h: number;
  m?: number;
  text: string;
}

const MESSAGES: SeedMessage[] = [
  // --- #launch-week: shipping Atlas 2.0 ---
  {
    room: 'launch-week',
    by: 'mira',
    d: 5,
    h: 9,
    text: 'Kicking off launch week planning for Atlas 2.0. Open items: final date, pricing page copy, the demo video, and the changelog.',
  },
  {
    room: 'launch-week',
    by: 'jonas',
    d: 5,
    h: 9,
    m: 12,
    text: 'Demo video script is drafted. Recording booth is booked for Wednesday morning.',
  },
  {
    room: 'launch-week',
    by: 'priya',
    d: 5,
    h: 10,
    text: 'Heads up: the billing migration has to finish before we flip pricing live. It is at 80 percent, done by Monday night at the latest.',
  },
  {
    room: 'launch-week',
    by: 'mira',
    d: 4,
    h: 11,
    text: 'Decision: we are moving the launch from Tuesday to Thursday the 18th, so the changelog, demo video, and pricing page land together instead of dribbling out.',
  },
  {
    room: 'launch-week',
    by: 'jonas',
    d: 4,
    h: 11,
    m: 20,
    text: 'Makes sense. That gives QA a full extra day on the upgrade path.',
  },
  {
    room: 'launch-week',
    by: 'mira',
    d: 4,
    h: 14,
    text: 'Pricing call after talking to the first twelve design partners: we are going with 12 dollars per seat per month for the team plan, annual billing only at launch. Monthly billing follows in Q3.',
  },
  {
    room: 'launch-week',
    by: 'priya',
    d: 4,
    h: 14,
    m: 30,
    text: 'Agreed on 12 per seat. The unit economics work as long as embedding costs stay under 4 percent of revenue, which the cache should guarantee.',
  },
  {
    room: 'launch-week',
    by: 'jonas',
    d: 3,
    h: 10,
    text: 'Mira owns the pricing page copy, I own the changelog, Priya owns the upgrade runbook. Deadline for all three: Wednesday noon.',
  },
  {
    room: 'launch-week',
    by: 'mira',
    d: 2,
    h: 16,
    text: 'Pricing page copy is in the doc and reviewed. One open question for legal on the refund window wording, answer expected tomorrow.',
  },
  {
    room: 'launch-week',
    by: 'priya',
    d: 1,
    h: 9,
    text: 'Upgrade runbook done and rehearsed against staging twice. Rollback takes 4 minutes end to end.',
  },
  {
    room: 'launch-week',
    by: 'jonas',
    d: 1,
    h: 15,
    text: 'Changelog is live behind a draft flag. 41 entries, grouped by surface. The memory section reads genuinely well.',
  },
  {
    room: 'launch-week',
    by: 'mira',
    d: 0,
    h: 9,
    text: 'T minus one day. Demo video uploaded, captions checked, thumbnail approved. We are green across the board.',
  },

  // --- #design-crit: the onboarding redesign ---
  {
    room: 'design-crit',
    by: 'jonas',
    d: 4,
    h: 13,
    text: 'Crit thread for the onboarding flow. Five screens in the Figma, focus on the empty workspace state and the first-run checklist.',
  },
  {
    room: 'design-crit',
    by: 'mira',
    d: 4,
    h: 13,
    m: 25,
    text: 'The empty state headline reads like an apology. It should state what to do next, not how empty the room is.',
  },
  {
    room: 'design-crit',
    by: 'priya',
    d: 4,
    h: 13,
    m: 40,
    text: 'Strong agree. Suggest: a one-line product truth, then three suggested questions that always work against the seeded history.',
  },
  {
    room: 'design-crit',
    by: 'jonas',
    d: 4,
    h: 15,
    text: 'Agreed: empty states get a short headline, one sentence of direction, and three working suggestion chips. No illustrations, no mascots.',
  },
  {
    room: 'design-crit',
    by: 'mira',
    d: 3,
    h: 11,
    text: 'Theme question: paper or ink as the default? Paper photographs better in the readme and reads calmer in daylight demos.',
  },
  {
    room: 'design-crit',
    by: 'jonas',
    d: 3,
    h: 11,
    m: 30,
    text: 'Decision: paper ships as the default theme, ink stays one toggle away in the user footer. Revisit only if onboarding completion drops.',
  },
  {
    room: 'design-crit',
    by: 'priya',
    d: 2,
    h: 10,
    text: 'Checklist motion review: the highlight sweep on citation jump is the only motion that survives reduced-motion as an opacity change. Everything else is instant. Approved from my side.',
  },
  {
    room: 'design-crit',
    by: 'mira',
    d: 2,
    h: 17,
    text: 'Final crit note: the unread chip contrast in ink theme was 4.1 to 1, below AA. Bumped the wash alpha and re-measured at 9.5 to 1 with the contrast script.',
  },

  // --- #ops-incidents: the checkout outage and what came of it ---
  {
    room: 'ops-incidents',
    by: 'priya',
    d: 5,
    h: 8,
    text: 'Incident INC-219: checkout was down 22 minutes on May 28 between 14:03 and 14:25 UTC. Postmortem thread here.',
  },
  {
    room: 'ops-incidents',
    by: 'priya',
    d: 5,
    h: 8,
    m: 15,
    text: 'Root cause: connection pool exhaustion in the payments service. A retry storm from the mobile client after a deploy consumed every pool slot, and checkout requests queued until timeout.',
  },
  {
    room: 'ops-incidents',
    by: 'jonas',
    d: 5,
    h: 8,
    m: 40,
    text: 'Contributing factor: the payments client had no backoff jitter, so 40 thousand clients retried on the same second boundaries.',
  },
  {
    room: 'ops-incidents',
    by: 'mira',
    d: 5,
    h: 9,
    text: 'Customer impact: 1,830 failed checkouts, 312 support tickets, no double charges confirmed after reconciliation.',
  },
  {
    room: 'ops-incidents',
    by: 'priya',
    d: 4,
    h: 10,
    text: 'Decision from the postmortem: every external service call gets a circuit breaker and jittered exponential backoff by end of month. I own the rollout, tracked in OPS-512.',
  },
  {
    room: 'ops-incidents',
    by: 'jonas',
    d: 3,
    h: 16,
    text: 'Breaker rollout is 6 of 11 services done. Payments, search, and email are migrated. Webhooks next.',
  },
  {
    room: 'ops-incidents',
    by: 'priya',
    d: 1,
    h: 12,
    text: 'Game day rerun of the INC-219 scenario against staging: the breaker tripped in 800 milliseconds and checkout degraded to the queue path instead of failing. Exactly the behavior we wanted.',
  },
];

const PDF_TEXT =
  'Atlas 2.0 launch plan. Owner: Mira Chen. Launch date: Thursday the 18th, moved from Tuesday so all assets land together. ' +
  'Pricing: team plan at 12 dollars per seat per month, annual billing only at launch, monthly billing planned for Q3. ' +
  'Workstreams: pricing page copy owned by Mira, changelog owned by Jonas, upgrade runbook owned by Priya, all due Wednesday noon. ' +
  'Risk register: billing migration must complete before pricing goes live, rollback rehearsed at 4 minutes. ' +
  'Success metric: 200 team plan signups in the first two weeks.';

const ROOMS = [
  { slug: 'launch-week', name: 'launch-week' },
  { slug: 'design-crit', name: 'design-crit' },
  { slug: 'ops-incidents', name: 'ops-incidents' },
];

async function main(): Promise<void> {
  if (!env.AI_ENABLED) {
    console.error('Set AI_ENABLED=true so the demo can embed its content.');
    process.exit(1);
  }
  await connectMongo();
  await connectRedis();
  await ensureCollection();

  // Replace any previous demo workspace.
  const oldUsers = await User.find({ username: { $in: USERS.map((u) => u.username) } });
  const oldRooms = await Room.find({ slug: { $in: ROOMS.map((r) => r.slug) } });
  for (const room of oldRooms) {
    await deleteVectorsByRoom(room._id.toHexString());
    await Message.deleteMany({ roomId: room._id });
    await Membership.deleteMany({ roomId: room._id });
    await DocumentModel.deleteMany({ roomId: room._id });
  }
  await Room.deleteMany({ _id: { $in: oldRooms.map((r) => r._id) } });
  await User.deleteMany({ _id: { $in: oldUsers.map((u) => u._id) } });

  // Users
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, Types.ObjectId>();
  for (const seedUser of USERS) {
    const user = await User.create({
      username: seedUser.username,
      displayName: seedUser.displayName,
      passwordHash,
      avatarSeed: `demo-${seedUser.username}`,
    });
    userIds.set(seedUser.username, user._id);
  }

  // Rooms and memberships (everyone in every demo room)
  const roomIds = new Map<string, Types.ObjectId>();
  for (const seedRoom of ROOMS) {
    const room = await Room.create({
      name: seedRoom.name,
      slug: seedRoom.slug,
      isDM: false,
      creatorId: userIds.get('mira'),
      aiEnabled: true,
    });
    roomIds.set(seedRoom.slug, room._id);
    for (const seedUser of USERS) {
      await Membership.create({ userId: userIds.get(seedUser.username), roomId: room._id });
    }
  }

  // Messages with realistic timestamps, inserted raw so createdAt is ours.
  const now = new Date();
  const docs = MESSAGES.map((m) => {
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - m.d);
    createdAt.setHours(m.h, m.m ?? 0, Math.floor(Math.random() * 50), 0);
    return {
      _id: new Types.ObjectId(),
      roomId: roomIds.get(m.room) as Types.ObjectId,
      senderId: userIds.get(m.by) as Types.ObjectId,
      body: m.text,
      clientMsgId: randomUUID(),
      kind: 'user' as const,
      createdAt,
      updatedAt: createdAt,
    };
  });
  docs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await Message.collection.insertMany(docs);

  // The demo user has read nothing in launch-week: the Catch me up pill
  // appears immediately. Other rooms read up to the latest message.
  for (const seedRoom of ROOMS) {
    const roomId = roomIds.get(seedRoom.slug) as Types.ObjectId;
    const roomDocs = docs.filter((d) => d.roomId.equals(roomId));
    const latest = roomDocs[roomDocs.length - 1];
    const earliest = roomDocs[0];
    for (const seedUser of USERS) {
      const cursor =
        seedUser.username === 'demo' && seedRoom.slug === 'launch-week' ? earliest : latest;
      await Membership.updateOne(
        { userId: userIds.get(seedUser.username), roomId },
        { lastReadMessageId: cursor?._id ?? null, lastReadAt: new Date() },
      );
    }
  }

  // Embed all messages.
  console.log(`Embedding ${docs.length} messages`);
  const embedder = getEmbedder();
  for (let i = 0; i < docs.length; i += 64) {
    const batch = docs.slice(i, i + 64);
    const vectors = await embedder.embed(batch.map((d) => d.body));
    await upsertVectors(
      batch.flatMap((d, j) => {
        const vector = vectors[j];
        if (!vector) return [];
        return [
          {
            id: pointId(`msg:${d._id.toHexString()}`),
            vector,
            payload: {
              kind: 'message' as const,
              roomId: d.roomId.toHexString(),
              messageId: d._id.toHexString(),
              senderId: d.senderId.toHexString(),
              createdAt: d.createdAt.toISOString(),
              text: d.body,
            },
          },
        ];
      }),
    );
  }

  // The launch plan pdf, parsed and embedded like a real upload.
  const pdfBuffer = buildPdf(PDF_TEXT);
  const parsed = await parseUpload(pdfBuffer, 'application/pdf');
  const launchRoomId = roomIds.get('launch-week') as Types.ObjectId;
  const doc = await DocumentModel.create({
    roomId: launchRoomId,
    uploaderId: userIds.get('mira'),
    filename: 'atlas-2.0-launch-plan.pdf',
    mimetype: 'application/pdf',
    size: pdfBuffer.length,
    status: 'processing',
    text: parsed.text,
    pageOffsets: parsed.pageOffsets,
  });
  const chunks = chunkDocument(doc.text, doc.pageOffsets);
  const chunkVectors = await embedder.embed(chunks.map((c) => c.text));
  await upsertVectors(
    chunks.flatMap((chunk, i) => {
      const vector = chunkVectors[i];
      if (!vector) return [];
      return [
        {
          id: pointId(`doc:${doc._id.toHexString()}:${i}`),
          vector,
          payload: {
            kind: 'doc' as const,
            roomId: launchRoomId.toHexString(),
            docId: doc._id.toHexString(),
            chunkIndex: i,
            page: chunk.page,
            filename: doc.filename,
            createdAt: doc.createdAt.toISOString(),
            text: chunk.text,
          },
        },
      ];
    }),
  );
  doc.status = 'ready';
  doc.chunkCount = chunks.length;
  await doc.save();

  console.log('');
  console.log('Demo workspace ready.');
  console.log(`  Sign in: demo / ${DEMO_PASSWORD}`);
  console.log('  Rooms: #launch-week (unread digest waiting), #design-crit, #ops-incidents');
  console.log('  Try: "What did we decide about the launch date?"');
  console.log('       "What caused the checkout outage?"');
  console.log('       "What is the team plan pricing?"');
  await disconnectMongo();
  await disconnectRedis();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
