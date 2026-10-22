import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CacheStatus, Mode } from './types.js';

export const INTENT_BITS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25,
  INTERACTION: 1 << 26,
  MESSAGE_AUDIT: 1 << 27,
  FORUMS_EVENT: 1 << 28,
  AUDIO_ACTION: 1 << 29,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
} as const;

export type IntentName = keyof typeof INTENT_BITS;
export type EventTransport = 'off' | 'websocket' | 'webhook';

export interface Config {
  appId?: string;
  appSecret?: string;
  staticToken?: string;
  apiBase: string;
  tokenUrl: string;
  mode: Mode;
  timeoutMs: number;
  rateLimit: boolean;
  uploadRoot?: string;
  downloadDir: string;
  maxUploadBytes: number;
  eventTransport: EventTransport;
  eventAutostart: boolean;
  intents: number;
  intentsRaw: string;
  shard: [number, number];
  eventBuffer: number;
  eventTtlMs: number;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  auditLog?: string;
  auditContent: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ResolvedConfig {
  config: Config;
  warnings: string[];
}

const VALID_INTENTS = Object.keys(INTENT_BITS) as IntentName[];
const DEFAULT_INTENTS =
  INTENT_BITS.GROUP_AND_C2C_EVENT | INTENT_BITS.INTERACTION | INTENT_BITS.PUBLIC_GUILD_MESSAGES;

function presence(name: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`expected a boolean (true/false/1/0/on/off), got "${raw}"`);
}

function parseInteger(raw: string | undefined, fallback: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function parseMode(raw: string | undefined, hasAuth: boolean, warnings: string[]): Mode {
  const value = raw?.trim().toLowerCase();
  if (value && !['docs', 'read', 'write'].includes(value)) {
    throw new Error(`QQBOT_MCP_MODE must be one of docs, read, write; got "${raw}"`);
  }
  if (!hasAuth) {
    if (value && value !== 'docs') {
      warnings.push(`QQBOT_MCP_MODE=${value} ignored: no AppID/AppSecret or access token configured — running in docs mode.`);
    }
    return 'docs';
  }
  return (value as Mode | undefined) ?? 'read';
}

function parseIntents(raw: string | undefined, warnings: string[]): { intents: number; raw: string } {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === 'auto') return { intents: DEFAULT_INTENTS, raw: 'auto' };
  if (/^0x[0-9a-f]+$/i.test(value)) return { intents: Number.parseInt(value, 16), raw: value };
  if (/^\d+$/.test(value)) return { intents: Number(value), raw: value };
  const names = value.split(/[,\s|+]+/).filter(Boolean);
  let intents = 0;
  for (const name of names) {
    if (name.toLowerCase() === 'all') {
      intents = Object.values(INTENT_BITS).reduce((sum, bit) => sum | bit, 0);
      continue;
    }
    const normalized = name.toUpperCase();
    if (!(normalized in INTENT_BITS)) {
      warnings.push(`Unknown intent "${name}" ignored. Valid: ${VALID_INTENTS.join(', ')}, all`);
      continue;
    }
    intents |= INTENT_BITS[normalized as IntentName];
  }
  if (intents === 0) {
    warnings.push('No valid intents parsed; falling back to auto.');
    intents = DEFAULT_INTENTS;
  }
  return { intents, raw: value };
}

function parseShard(raw: string | undefined, warnings: string[]): [number, number] {
  const value = raw?.trim() || '0,1';
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || !parts.every((part) => Number.isInteger(part) && part >= 0)) {
    warnings.push(`Invalid QQBOT_MCP_SHARD="${raw}", using 0,1.`);
    return [0, 1];
  }
  const [id, count] = parts as [number, number];
  if (count < 1 || id >= count) {
    warnings.push(`Invalid QQBOT_MCP_SHARD="${raw}" (need 0 <= id < count), using 0,1.`);
    return [0, 1];
  }
  return [id, count];
}

function normalizeBase(raw: string | undefined): string {
  const value = (raw?.trim() || 'https://api.bot.qq.com').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error(`QQBOT_API_BASE must be an absolute http(s) URL, got "${raw}"`);
  return value;
}

function normalizePath(raw: string | undefined): string {
  const value = raw?.trim() || '/qqbot/webhook';
  return value.startsWith('/') ? value : `/${value}`;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const warnings: string[] = [];
  const appId = presence('QQBOT_APP_ID', env.QQBOT_APP_ID);
  const appSecret = presence('QQBOT_APP_SECRET', env.QQBOT_APP_SECRET);
  const staticToken = presence('QQBOT_ACCESS_TOKEN', env.QQBOT_ACCESS_TOKEN);
  const hasAuth = Boolean(staticToken || (appId && appSecret));
  if ((appId && !appSecret) || (!appId && appSecret)) {
    warnings.push('Only one of QQBOT_APP_ID / QQBOT_APP_SECRET is set; app credentials are ignored.');
  }
  const mode = parseMode(env.QQBOT_MCP_MODE, hasAuth, warnings);
  const apiBase = normalizeBase(env.QQBOT_API_BASE);
  const timeoutMs = parseInteger(env.QQBOT_MCP_TIMEOUT_MS, 30_000, 'QQBOT_MCP_TIMEOUT_MS', 1_000, 300_000);
  const eventBuffer = parseInteger(env.QQBOT_MCP_EVENT_BUFFER, 1_000, 'QQBOT_MCP_EVENT_BUFFER', 1, 100_000);
  const eventTtlMs = parseInteger(env.QQBOT_MCP_EVENT_TTL_MS, 30 * 60_000, 'QQBOT_MCP_EVENT_TTL_MS', 1_000);
  const maxUploadBytes = parseInteger(
    env.QQBOT_MCP_MAX_UPLOAD_BYTES,
    200 * 1024 * 1024,
    'QQBOT_MCP_MAX_UPLOAD_BYTES',
    1,
    200 * 1024 * 1024,
  );
  const webhookPort = parseInteger(env.QQBOT_MCP_WEBHOOK_PORT, 8787, 'QQBOT_MCP_WEBHOOK_PORT', 0, 65_535);
  const logLevelRaw = (env.QQBOT_MCP_LOG_LEVEL?.trim().toLowerCase() || 'info') as Config['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevelRaw)) {
    throw new Error(`QQBOT_MCP_LOG_LEVEL must be debug, info, warn or error; got "${env.QQBOT_MCP_LOG_LEVEL}"`);
  }
  const requestedTransport = (env.QQBOT_MCP_EVENT_TRANSPORT?.trim().toLowerCase() || 'off') as EventTransport;
  if (!['off', 'websocket', 'webhook'].includes(requestedTransport)) {
    throw new Error(`QQBOT_MCP_EVENT_TRANSPORT must be off, websocket or webhook; got "${env.QQBOT_MCP_EVENT_TRANSPORT}"`);
  }
  let eventTransport = requestedTransport;
  if (eventTransport !== 'off' && !hasAuth) {
    warnings.push('Event transport disabled: AppID/AppSecret (or access token) required.');
    eventTransport = 'off';
  }
  if (eventTransport === 'webhook' && (!appSecret || !appId)) {
    warnings.push('Webhook transport requires QQBOT_APP_ID + QQBOT_APP_SECRET; disabling events.');
    eventTransport = 'off';
  }
  const { intents, raw: intentsRaw } = parseIntents(env.QQBOT_MCP_INTENTS, warnings);
  const shard = parseShard(env.QQBOT_MCP_SHARD, warnings);
  const config: Config = {
    appId,
    appSecret,
    staticToken,
    apiBase,
    tokenUrl: presence('QQBOT_TOKEN_URL', env.QQBOT_TOKEN_URL) || `${apiBase}/app/getAppAccessToken`,
    mode,
    timeoutMs,
    rateLimit: parseBoolean(env.QQBOT_MCP_RATE_LIMIT, true),
    uploadRoot: presence('QQBOT_MCP_UPLOAD_ROOT', env.QQBOT_MCP_UPLOAD_ROOT),
    downloadDir:
      presence('QQBOT_MCP_DOWNLOAD_DIR', env.QQBOT_MCP_DOWNLOAD_DIR) || join(tmpdir(), 'qqbot-mcp-downloads'),
    maxUploadBytes,
    eventTransport,
    eventAutostart: parseBoolean(env.QQBOT_MCP_EVENT_AUTOSTART, false),
    intents,
    intentsRaw,
    shard,
    eventBuffer,
    eventTtlMs,
    webhookHost: presence('QQBOT_MCP_WEBHOOK_HOST', env.QQBOT_MCP_WEBHOOK_HOST) || '127.0.0.1',
    webhookPort,
    webhookPath: normalizePath(presence('QQBOT_MCP_WEBHOOK_PATH', env.QQBOT_MCP_WEBHOOK_PATH)),
    auditLog: presence('QQBOT_MCP_AUDIT_LOG', env.QQBOT_MCP_AUDIT_LOG),
    auditContent: parseBoolean(env.QQBOT_MCP_AUDIT_CONTENT, false),
    logLevel: logLevelRaw,
  };
  return { config, warnings };
}

export function authStatus(config: Config): CacheStatus {
  if (config.staticToken) {
    return { configured: true, source: 'static', expiresAt: null, valid: true };
  }
  if (config.appId && config.appSecret) {
    return { configured: true, source: 'app', expiresAt: null, valid: true };
  }
  return { configured: false, source: 'none', expiresAt: null, valid: false };
}

export function configSummary(config: Config): Record<string, unknown> {
  return {
    mode: config.mode,
    apiBase: config.apiBase,
    appId: config.appId ? `${config.appId.slice(0, 4)}…${config.appId.slice(-2)}` : null,
    credentials: config.staticToken ? 'static-token' : config.appId && config.appSecret ? 'app-id+secret' : 'none',
    timeoutMs: config.timeoutMs,
    rateLimit: config.rateLimit,
    uploadRoot: config.uploadRoot ?? null,
    downloadDir: config.downloadDir,
    maxUploadBytes: config.maxUploadBytes,
    eventTransport: config.eventTransport,
    eventAutostart: config.eventAutostart,
    intents: config.intents,
    intentsRaw: config.intentsRaw,
    shard: config.shard,
    webhook: `${config.webhookHost}:${config.webhookPort}${config.webhookPath}`,
    auditLog: config.auditLog ?? null,
  };
}
