import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../util/logger.js';

export interface AuditEntry {
  tool: string;
  api?: string;
  method?: string;
  path?: string;
  target?: unknown;
  ok: boolean;
  code?: string | number;
  duration_ms?: number;
  body?: unknown;
  error?: string;
}

const SECRET_KEYS = /^(authorization|token|access_token|clientsecret|client_secret|appsecret|app_secret|secret|password)$/i;

/** Optional JSONL audit trail. Disabled unless QQBOT_MCP_AUDIT_LOG is set. */
export class AuditLogger {
  constructor(
    private readonly path: string | undefined,
    private readonly includeContent: boolean,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.path);
  }

  async record(entry: AuditEntry): Promise<void> {
    if (!this.path) return;
    const payload = {
      ts: new Date().toISOString(),
      tool: entry.tool,
      ...(entry.api ? { api: entry.api } : {}),
      ...(entry.method ? { method: entry.method } : {}),
      ...(entry.path ? { path: entry.path } : {}),
      ...(entry.target !== undefined ? { target: entry.target } : {}),
      ok: entry.ok,
      ...(entry.code !== undefined ? { code: entry.code } : {}),
      ...(entry.duration_ms !== undefined ? { duration_ms: entry.duration_ms } : {}),
      ...(this.includeContent && entry.body !== undefined ? { body: redact(entry.body).slice(0, 4000) } : {}),
      ...(entry.error ? { error: entry.error.slice(0, 1000) } : {}),
    };
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await appendFile(this.path, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      this.logger.warn('Failed to append audit log entry.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function redact(value: unknown, depth = 0): string {
  if (depth > 4) return '"[depth]"';
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => safeItem(item, depth + 1)));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SECRET_KEYS.test(key) ? '[redacted]' : safeItem(item, depth + 1);
  }
  return JSON.stringify(result);
}

function safeItem(value: unknown, depth: number): unknown {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  try {
    return JSON.parse(redact(value, depth));
  } catch {
    return '[unserializable]';
  }
}
