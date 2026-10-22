import { sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ed25519KeysFromSecret, signWebhookValidation, verifyWebhookSignature } from '../src/util/ed25519.js';
import { WebhookServer } from '../src/events/webhook.js';
import { EventStore } from '../src/events/store.js';
import { resolveConfig } from '../src/config.js';
import { Logger } from '../src/util/logger.js';

const SECRET = 'DG5g3B4j9X2KOErG';
const EVENT_TS = '1725442341';
const PLAIN_TOKEN = 'Arq0D5A61EgUu4OxUvOp';
const GOLDEN_SIGNATURE =
  '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706';

describe('Ed25519 webhook signatures', () => {
  it('reproduces the wiki validation fixture', () => {
    expect(signWebhookValidation(SECRET, EVENT_TS, PLAIN_TOKEN)).toBe(GOLDEN_SIGNATURE);
  });

  it('verifies a signature over timestamp + raw body', () => {
    const body = JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { content: 'hi' } });
    const keys = ed25519KeysFromSecret(SECRET);
    const signature = sign(null, Buffer.from(`${EVENT_TS}${body}`, 'utf8'), keys.privateKey).toString('hex');
    expect(verifyWebhookSignature(SECRET, signature, EVENT_TS, body)).toBe(true);
    expect(verifyWebhookSignature(SECRET, signature, EVENT_TS, `${body} `)).toBe(false);
    expect(verifyWebhookSignature(SECRET, 'not-hex', EVENT_TS, body)).toBe(false);
  });
});

describe('WebhookServer', () => {
  it('answers op=13 and accepts only signed events', async () => {
    const { config } = resolveConfig({
      QQBOT_APP_ID: 'app',
      QQBOT_APP_SECRET: SECRET,
      QQBOT_MCP_MODE: 'write',
      QQBOT_MCP_EVENT_TRANSPORT: 'webhook',
    });
    const store = new EventStore({ capacity: 10, ttlMs: 60_000 });
    const server = new WebhookServer(config, store, new Logger('error'));
    const started = await server.start({ host: '127.0.0.1', port: 0 });
    const port = Number(started.port);
    const url = `http://127.0.0.1:${port}${config.webhookPath}`;
    try {
      const validation = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 13, d: { plain_token: PLAIN_TOKEN, event_ts: EVENT_TS } }),
      });
      expect(validation.status).toBe(200);
      expect(await validation.json()).toEqual({ plain_token: PLAIN_TOKEN, signature: GOLDEN_SIGNATURE });

      const eventBody = JSON.stringify({
        op: 0,
        id: 'EVENT-1',
        t: 'C2C_MESSAGE_CREATE',
        s: 7,
        d: { content: 'hello', author: { user_openid: 'u' } },
      });
      const keys = ed25519KeysFromSecret(SECRET);
      const signature = sign(null, Buffer.from(`${EVENT_TS}${eventBody}`, 'utf8'), keys.privateKey).toString('hex');
      const accepted = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': EVENT_TS,
        },
        body: eventBody,
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ op: 12, d: {} });
      const events = store.poll({ peek: true });
      expect(events.events).toHaveLength(1);
      expect(events.events[0]).toMatchObject({ id: 'EVENT-1', type: 'C2C_MESSAGE_CREATE' });

      const rejected = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: eventBody,
      });
      expect(rejected.status).toBe(401);
      expect(store.status().buffered).toBe(1);
      expect(server.status()).toMatchObject({ verified: 1, rejected: 1, validations: 1 });
    } finally {
      await server.stop();
    }
  });

  it('rejects wrong paths and methods', async () => {
    const { config } = resolveConfig({
      QQBOT_APP_ID: 'app',
      QQBOT_APP_SECRET: SECRET,
      QQBOT_MCP_MODE: 'write',
      QQBOT_MCP_EVENT_TRANSPORT: 'webhook',
    });
    const server = new WebhookServer(config, new EventStore({ capacity: 5, ttlMs: 60_000 }), new Logger('error'));
    const started = await server.start({ host: '127.0.0.1', port: 0 });
    const port = Number(started.port);
    try {
      expect((await fetch(`http://127.0.0.1:${port}/wrong`, { method: 'POST', body: '{}' })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}${config.webhookPath}`)).status).toBe(405);
    } finally {
      await server.stop();
    }
  });
});
