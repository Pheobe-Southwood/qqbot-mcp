import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { GatewayClient } from '../src/events/gateway.js';
import { EventStore } from '../src/events/store.js';
import { resolveConfig } from '../src/config.js';
import { Logger } from '../src/util/logger.js';
import type { QqBotClient } from '../src/client/http.js';
import type { TokenManager } from '../src/client/token.js';

const logger = new Logger('error');
let server: WebSocketServer | undefined;
let gateway: GatewayClient | undefined;

afterEach(async () => {
  await gateway?.stop();
  gateway = undefined;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('GatewayClient', () => {
  it('identifies, receives READY, buffers events and heartbeats', async () => {
    const received: Array<Record<string, unknown>> = [];
    let identified = false;
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.on('connection', (socket: WebSocket) => {
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 100 } }));
      socket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(payload);
        if (payload.op === 2) {
          identified = true;
          socket.send(JSON.stringify({ op: 11 }));
          socket.send(
            JSON.stringify({
              op: 0,
              s: 1,
              t: 'READY',
              d: { session_id: 'SESSION-1', user: { username: 'test-bot' }, shard: [0, 1] },
            }),
          );
          socket.send(
            JSON.stringify({
              op: 0,
              s: 2,
              t: 'C2C_MESSAGE_CREATE',
              id: 'EVENT-1',
              d: { content: 'hello' },
            }),
          );
        }
        if (payload.op === 1) socket.send(JSON.stringify({ op: 11 }));
      });
    });

    const config = resolveConfig({
      QQBOT_ACCESS_TOKEN: 'tok',
      QQBOT_MCP_MODE: 'read',
    }).config;
    const client = {
      call: vi.fn(async () => ({ ok: true, httpStatus: 200, data: { url: `ws://127.0.0.1:${port}` }, url: '' })),
    } as unknown as QqBotClient;
    const tokens = {
      get: vi.fn(async () => 'tok'),
      invalidate: vi.fn(),
    } as unknown as TokenManager;
    const store = new EventStore({ capacity: 10, ttlMs: 60_000 });
    gateway = new GatewayClient(config, client, tokens, store, logger);
    const status = await gateway.start({ waitReadyMs: 3_000 });
    expect(status).toMatchObject({ state: 'ready', session_id: 'SESSION-1', bot: { username: 'test-bot' } });
    expect(identified).toBe(true);
    const identify = received.find((payload) => payload.op === 2);
    expect(identify?.d).toMatchObject({ token: 'QQBot tok', shard: [0, 1] });
    expect(store.status().buffered).toBe(2);
    const events = store.poll({ types: ['C2C_MESSAGE_CREATE'] });
    expect(events.events[0]).toMatchObject({ id: 'EVENT-1', data: { content: 'hello' } });

    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(received.some((payload) => payload.op === 1)).toBe(true);
  });
});
