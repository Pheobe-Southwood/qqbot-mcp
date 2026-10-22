import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { Logger } from '../util/logger.js';
import { ToolError, errorMessage } from '../client/errors.js';
import { signWebhookValidation, verifyWebhookSignature } from '../util/ed25519.js';
import type { EventStore } from './store.js';

export type WebhookState = 'idle' | 'listening' | 'closed';

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * QQ webhook receiver. Handles the op=13 URL validation handshake and verifies
 * X-Signature-Ed25519 on every event before buffering it.
 */
export class WebhookServer {
  private server?: Server;
  private state: WebhookState = 'idle';
  private actualPort?: number;
  private lastError?: string;
  private startedAt?: number;
  private requests = 0;
  private verified = 0;
  private rejected = 0;
  private validations = 0;

  constructor(
    private readonly config: Config,
    private readonly store: EventStore,
    private readonly logger: Logger,
  ) {}

  async start(options: { port?: number; host?: string; path?: string } = {}): Promise<Record<string, unknown>> {
    if (this.state === 'listening') return this.status();
    if (!this.config.appId || !this.config.appSecret) {
      throw new ToolError('Webhook transport requires QQBOT_APP_ID and QQBOT_APP_SECRET (the secret signs events).');
    }
    const host = options.host ?? this.config.webhookHost;
    const port = options.port ?? this.config.webhookPort;
    const path = normalizePath(options.path ?? this.config.webhookPath);
    const server = createServer((request, response) => {
      void this.handle(request, response, path);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    }).catch((error) => {
      this.lastError = errorMessage(error);
      this.state = 'closed';
      throw new ToolError(`Failed to start webhook server on ${host}:${port}: ${this.lastError}`);
    });
    const address = server.address();
    this.actualPort = typeof address === 'object' && address ? address.port : port;
    this.state = 'listening';
    this.startedAt = Date.now();
    this.lastError = undefined;
    this.logger.info('Webhook listening.', { host, port: this.actualPort, path });
    return this.status();
  }

  async stop(): Promise<Record<string, unknown>> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }).catch(() => undefined);
    }
    this.state = 'closed';
    return this.status();
  }

  status(): Record<string, unknown> {
    return {
      state: this.state,
      listening: this.state === 'listening',
      host: this.config.webhookHost,
      port: this.actualPort ?? this.config.webhookPort,
      path: this.config.webhookPath,
      started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      requests: this.requests,
      verified: this.verified,
      rejected: this.rejected,
      validations: this.validations,
      last_error: this.lastError ?? null,
    };
  }

  private async handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    this.requests += 1;
    if (request.method !== 'POST') {
      respond(response, 405, { error: 'method not allowed' });
      return;
    }
    if ((request.url ?? '').split('?')[0] !== path) {
      respond(response, 404, { error: 'not found' });
      return;
    }
    const declaredLength = Number(request.headers['content-length'] ?? '0');
    if (declaredLength > MAX_BODY_BYTES) {
      this.rejected += 1;
      respond(response, 413, { error: 'payload too large' });
      return;
    }
    let raw: string;
    try {
      raw = await readBody(request);
    } catch (error) {
      this.rejected += 1;
      respond(response, 413, { error: errorMessage(error) });
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.rejected += 1;
      respond(response, 400, { error: 'invalid json' });
      return;
    }

    const data = asRecord(payload.d);
    // URL validation handshake (op 13) is not signed by QQ.
    if (Number(payload.op) === 13 && typeof data.plain_token === 'string') {
      const eventTs = String(data.event_ts ?? '');
      const signature = signWebhookValidation(this.config.appSecret!, eventTs, data.plain_token);
      this.validations += 1;
      this.logger.info('Webhook URL validation answered.');
      respond(response, 200, { plain_token: data.plain_token, signature });
      return;
    }

    const signature = headerValue(request.headers['x-signature-ed25519']);
    const timestamp = headerValue(request.headers['x-signature-timestamp']);
    if (!signature || !timestamp || !verifyWebhookSignature(this.config.appSecret!, signature, timestamp, raw)) {
      this.rejected += 1;
      this.logger.warn('Webhook signature rejected.', { has_signature: Boolean(signature), has_timestamp: Boolean(timestamp) });
      respond(response, 401, { error: 'invalid signature' });
      return;
    }
    this.verified += 1;

    if (Number(payload.op) === 0 && typeof payload.t === 'string') {
      this.store.push({
        id: typeof payload.id === 'string' ? payload.id : `${payload.t}:${String(payload.s ?? Date.now())}`,
        type: payload.t,
        data: payload.d,
        raw: payload,
      });
    }
    respond(response, 200, { op: 12, d: {} });
  }
}

function normalizePath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('payload too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}
