/* global __ENV, __VU */
// k6 load test for Parley.
//
// k6 has no Socket.IO client, so this script speaks the Engine.IO v4 and
// Socket.IO v5 wire protocol directly over a raw websocket, exactly like the
// production client does (transports: ['websocket'], no polling fallback):
//
//   server -> '0{...}'        engine.io open
//   client -> '40{"token"..}' socket.io CONNECT with handshake auth
//   server -> '40{"sid"..}'   connected
//   server -> '2'  / client -> '3'   heartbeat
//   client -> '42<ackId>["message:send",{...}]'
//   server -> '43<ackId>[{ok:true,...}]'
//
// Run (see docs/LOADTEST.md):
//   k6 run infra/loadtest/chat-load.js
//
// Metrics:
//   ack_latency_ms        send -> server ack (persisted + broadcast started)
//   broadcast_latency_ms  sender Date.now() embedded in body -> receiver clock
//                         (same host, same clock)

import http from 'k6/http';
import ws from 'k6/ws';
import { Trend, Counter } from 'k6/metrics';

const HTTP_URL = __ENV.HTTP_URL || 'http://127.0.0.1:4000';
const WS_URL = __ENV.WS_URL || 'ws://127.0.0.1:4000';
const USERS = Number(__ENV.USERS || 500);
const ROOMS = Number(__ENV.ROOMS || 20);
const MSG_INTERVAL_MS = Number(__ENV.MSG_INTERVAL_MS || 6000);
const SESSION_MS = Number(__ENV.SESSION_MS || 170000);
const PASSWORD = 'loadtest-password-1';

const ackLatency = new Trend('ack_latency_ms');
const broadcastLatency = new Trend('broadcast_latency_ms');
const messagesSent = new Counter('messages_sent');
const messagesReceived = new Counter('messages_received');
const errorAcks = new Counter('error_acks');
const connectErrors = new Counter('connect_errors');

export const options = {
  scenarios: {
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '30s', target: 500 },
        { duration: '30s', target: 1000 },
        { duration: '60s', target: 1000 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  setupTimeout: '300s',
};

function uuidv4() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function setup() {
  const stamp = `${Date.now() % 1000000}`;
  const tokens = [];

  // Register users in parallel batches: argon2 hashing dominates this phase.
  const BATCH = 25;
  for (let start = 0; start < USERS; start += BATCH) {
    const requests = [];
    for (let i = start; i < Math.min(start + BATCH, USERS); i += 1) {
      requests.push({
        method: 'POST',
        url: `${HTTP_URL}/auth/register`,
        body: JSON.stringify({
          username: `lt${stamp}_${i}`,
          password: PASSWORD,
          displayName: `Load Tester ${i}`,
        }),
        params: { headers: { 'Content-Type': 'application/json' } },
      });
    }
    const responses = http.batch(requests);
    for (const res of responses) {
      if (res.status !== 201) {
        throw new Error(`registration failed: ${res.status} ${res.body}`);
      }
      tokens.push(JSON.parse(res.body).accessToken);
    }
  }

  // First ROOMS users each create one room.
  const roomIds = [];
  for (let i = 0; i < ROOMS; i += 1) {
    const res = http.post(
      `${HTTP_URL}/rooms`,
      JSON.stringify({ name: `load room ${stamp} ${i}` }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens[i]}`,
        },
      },
    );
    if (res.status !== 201) {
      throw new Error(`room creation failed: ${res.status} ${res.body}`);
    }
    roomIds.push(JSON.parse(res.body).room.id);
  }

  return { tokens, roomIds };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const roomId = data.roomIds[(__VU - 1) % data.roomIds.length];
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;

  let nextAckId = 100;
  const pendingAcks = {};

  ws.connect(url, {}, (socket) => {
    function sendEvent(event, payload) {
      const id = nextAckId;
      nextAckId += 1;
      pendingAcks[id] = Date.now();
      socket.send(`42${id}${JSON.stringify([event, payload])}`);
      return id;
    }

    socket.on('message', (msg) => {
      if (msg[0] === '0') {
        socket.send(`40${JSON.stringify({ token })}`);
        return;
      }
      if (msg === '2') {
        socket.send('3');
        return;
      }
      if (msg.startsWith('44')) {
        connectErrors.add(1);
        socket.close();
        return;
      }
      if (msg.startsWith('43')) {
        const match = msg.match(/^43(\d+)(\[.*\])$/s);
        if (!match) return;
        const sentAt = pendingAcks[match[1]];
        if (sentAt !== undefined) {
          ackLatency.add(Date.now() - sentAt);
          delete pendingAcks[match[1]];
        }
        const response = JSON.parse(match[2])[0];
        if (response && response.ok === false) errorAcks.add(1);
        return;
      }
      if (msg.startsWith('40')) {
        sendEvent('room:join', { roomId });
        // De-synchronize senders, then send on a steady cadence.
        socket.setTimeout(
          () => {
            socket.setInterval(() => {
              sendEvent('message:send', {
                roomId,
                clientMsgId: uuidv4(),
                body: `t:${Date.now()}`,
              });
              messagesSent.add(1);
            }, MSG_INTERVAL_MS);
          },
          1 + Math.floor(Math.random() * MSG_INTERVAL_MS),
        );
        return;
      }
      if (msg.startsWith('42')) {
        const payload = JSON.parse(msg.slice(2));
        if (payload[0] === 'message:new') {
          messagesReceived.add(1);
          const body = payload[1] && payload[1].body;
          if (typeof body === 'string' && body.startsWith('t:')) {
            broadcastLatency.add(Date.now() - Number(body.slice(2)));
          }
        }
      }
    });

    socket.on('error', () => {
      connectErrors.add(1);
    });

    socket.setTimeout(() => socket.close(), SESSION_MS);
  });
}
