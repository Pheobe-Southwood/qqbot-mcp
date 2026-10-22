import { describe, expect, it } from 'vitest';
import { INTENT_BITS, resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('defaults to docs mode without credentials', () => {
    const { config } = resolveConfig({});
    expect(config.mode).toBe('docs');
    expect(config.appId).toBeUndefined();
    expect(config.appSecret).toBeUndefined();
  });

  it('downgrades read/write to docs when credentials are absent, with a warning', () => {
    const { config, warnings } = resolveConfig({ QQBOT_MCP_MODE: 'write' });
    expect(config.mode).toBe('docs');
    expect(warnings.join(' ')).toContain('docs mode');
  });

  it('defaults to read mode when credentials exist', () => {
    const { config } = resolveConfig({ QQBOT_APP_ID: '123', QQBOT_APP_SECRET: 'secret' });
    expect(config.mode).toBe('read');
    expect(config.tokenUrl).toBe('https://api.bot.qq.com/app/getAppAccessToken');
  });

  it('accepts write mode', () => {
    const { config } = resolveConfig({
      QQBOT_APP_ID: '123',
      QQBOT_APP_SECRET: 'secret',
      QQBOT_MCP_MODE: 'write',
    });
    expect(config.mode).toBe('write');
  });

  it('rejects invalid modes and numbers', () => {
    expect(() => resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's', QQBOT_MCP_MODE: 'admin' })).toThrow(
      /docs, read, write/,
    );
    expect(() => resolveConfig({ QQBOT_MCP_TIMEOUT_MS: 'soon' })).toThrow(/QQBOT_MCP_TIMEOUT_MS/);
    expect(() =>
      resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's', QQBOT_MCP_EVENT_TRANSPORT: 'carrier-pigeon' }),
    ).toThrow(/EVENT_TRANSPORT/);
  });

  it('parses intents by name, number and all', () => {
    const auto = resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's' }).config;
    expect(auto.intents).toBe(
      INTENT_BITS.GROUP_AND_C2C_EVENT | INTENT_BITS.INTERACTION | INTENT_BITS.PUBLIC_GUILD_MESSAGES,
    );
    const named = resolveConfig({
      QQBOT_APP_ID: '1',
      QQBOT_APP_SECRET: 's',
      QQBOT_MCP_INTENTS: 'GUILDS,GROUP_AND_C2C_EVENT',
    }).config;
    expect(named.intents).toBe(INTENT_BITS.GUILDS | INTENT_BITS.GROUP_AND_C2C_EVENT);
    const numeric = resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's', QQBOT_MCP_INTENTS: '33554432' }).config;
    expect(numeric.intents).toBe(INTENT_BITS.GROUP_AND_C2C_EVENT);
    const all = resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's', QQBOT_MCP_INTENTS: 'all' }).config;
    expect(all.intents).toBe(Object.values(INTENT_BITS).reduce((sum, bit) => sum | bit, 0));
  });

  it('disables events when the transport needs missing credentials', () => {
    const off = resolveConfig({ QQBOT_MCP_EVENT_TRANSPORT: 'websocket' });
    expect(off.config.eventTransport).toBe('off');
    expect(off.warnings.join(' ')).toContain('Event transport disabled');

    const webhookTokenOnly = resolveConfig({
      QQBOT_ACCESS_TOKEN: 'tok',
      QQBOT_MCP_EVENT_TRANSPORT: 'webhook',
    });
    expect(webhookTokenOnly.config.eventTransport).toBe('off');
    expect(webhookTokenOnly.warnings.join(' ')).toContain('Webhook transport requires');
  });

  it('clamps upload size to the 200MB hard limit', () => {
    expect(() =>
      resolveConfig({
        QQBOT_APP_ID: '1',
        QQBOT_APP_SECRET: 's',
        QQBOT_MCP_MAX_UPLOAD_BYTES: String(300 * 1024 * 1024),
      }),
    ).toThrow(/MAX_UPLOAD_BYTES/);
  });

  it('parses shard and webhook defaults', () => {
    const { config } = resolveConfig({ QQBOT_APP_ID: '1', QQBOT_APP_SECRET: 's', QQBOT_MCP_SHARD: '1,2' });
    expect(config.shard).toEqual([1, 2]);
    expect(config.webhookHost).toBe('127.0.0.1');
    expect(config.webhookPort).toBe(8787);
    expect(config.webhookPath).toBe('/qqbot/webhook');
  });
});
