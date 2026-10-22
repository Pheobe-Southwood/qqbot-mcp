import WebSocket from 'ws';
import type { Config } from '../config.js';
import type { Logger } from '../util/logger.js';
import type { QqBotClient } from '../client/http.js';
import type { TokenManager } from '../client/token.js';
import { ToolError, errorMessage } from '../client/errors.js';
import type { EventStore } from './store.js';

export type GatewayState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'identifying'
  | 'ready'
  | 'reconnecting'
  | 'closed'
  | 'fatal';

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
  id?: string;
}

const FATAL_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);
const RESET_SESSION_CODES = new Set([4006, 4007, 4008, 4009]);

/**
 * QQ WebSocket gateway client. One shard per process: run multiple instances
 * with QQBOT_MCP_SHARD=0,2 / 1,2 for a multi-shard bot.
 */
export class GatewayClient {
  private socket?: WebSocket;
  private state: GatewayState = 'idle';
  private heartbeatTimer?: NodeJS.Timeout;
  private ackTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private sessionId?: string;
  private lastSeq?: number;
  private readyPayload?: Record<string, unknown>;
  private startedAt?: number;
  private lastError?: string;
  private attempts = 0;
  private manualStop = false;
  private gatewayUrl?: string;
  private connectPromise?: Promise<void>;
  private intents: number;
  private shard: [number, number];

  constructor(
    private readonly config: Config,
    private readonly client: QqBotClient,
    private readonly tokenManager: TokenManager,
    private readonly store: EventStore,
    private readonly logger: Logger,
  ) {
    this.intents = config.intents;
    this.shard = config.shard;
  }

  async start(options: { waitReadyMs?: number; intents?: number; shard?: [number, number] } = {}): Promise<Record<string, unknown>> {
    if (
      this.state === 'ready' ||
      this.state === 'connecting' ||
      this.state === 'reconnecting' ||
      this.state === 'open' ||
      this.state === 'identifying'
    ) {
      return this.status();
    }
    if (options.intents !== undefined) this.intents = options.intents;
    if (options.shard !== undefined) this.shard = options.shard;
    this.manualStop = false;
    this.lastError = undefined;
    this.attempts = 0;
    this.startedAt = Date.now();
    this.state = 'connecting';
    void this.connect().catch((error) => {
      this.lastError = errorMessage(error);
      this.state = 'fatal';
      this.logger.error('Gateway connect failed.', { error: this.lastError });
    });
    const waitReadyMs = options.waitReadyMs ?? 10_000;
    if (waitReadyMs > 0) await this.waitForReady(waitReadyMs);
    return this.status();
  }

  async stop(): Promise<Record<string, unknown>> {
    this.manualStop = true;
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try {
        socket.close(1000, 'client shutdown');
      } catch {
        socket.terminate();
      }
    }
    this.state = 'closed';
    this.sessionId = undefined;
    this.lastSeq = undefined;
    this.readyPayload = undefined;
    return this.status();
  }

  status(): Record<string, unknown> {
    return {
      state: this.state,
      started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      session_id: this.sessionId ?? null,
      last_seq: this.lastSeq ?? null,
      shard: this.shard,
      intents: this.intents,
      attempts: this.attempts,
      last_error: this.lastError ?? null,
      gateway_url: this.gatewayUrl ?? null,
      bot: this.readyPayload?.user ?? null,
      ready: this.state === 'ready',
      buffered_events: this.store.status().buffered,
    };
  }

  private async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    this.state = this.sessionId ? 'reconnecting' : 'connecting';
    const gateway = await this.client.call('get_gateway_bot');
    const data = asRecord(gateway.data);
    const url = typeof data.url === 'string' ? data.url : undefined;
    if (!url) throw new ToolError('get_gateway_bot did not return a WebSocket URL.', { details: data });
    this.gatewayUrl = url;
    const token = await this.tokenManager.get();
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      this.state = 'open';
      this.logger.info('Gateway socket open.', { shard: this.shard });
    });
    socket.on('message', (raw) => {
      this.handleMessage(raw.toString()).catch((error) => {
        this.lastError = errorMessage(error);
        this.logger.error('Failed to handle gateway message.', { error: this.lastError });
      });
    });
    socket.on('error', (error) => {
      this.lastError = errorMessage(error);
      this.logger.warn('Gateway socket error.', { error: this.lastError });
    });
    socket.on('close', (code, reason) => {
      this.handleClose(code, reason.toString());
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (error) => reject(error));
    });
  }

  private async handleMessage(text: string): Promise<void> {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(text) as GatewayPayload;
    } catch {
      this.logger.warn('Gateway sent non-JSON payload.');
      return;
    }
    switch (payload.op) {
      case 10: {
        const data = asRecord(payload.d);
        const interval = Number(data.heartbeat_interval);
        if (!Number.isFinite(interval) || interval <= 0) {
          throw new ToolError('Gateway Hello is missing heartbeat_interval.', { details: payload.d });
        }
        if (this.sessionId && this.lastSeq !== undefined) {
          await this.send({ op: 6, d: { token: `QQBot ${await this.tokenManager.get()}`, session_id: this.sessionId, seq: this.lastSeq } });
          this.state = 'identifying';
          this.logger.info('Gateway resuming session.', { session_id: this.sessionId, seq: this.lastSeq });
        } else {
          await this.send({
            op: 2,
            d: {
              token: `QQBot ${await this.tokenManager.get()}`,
              intents: this.intents,
              shard: this.shard,
              properties: { $os: process.platform, $browser: 'qqbot-mcp', $device: 'qqbot-mcp' },
            },
          });
          this.state = 'identifying';
          this.logger.info('Gateway identifying.', { intents: this.intents, shard: this.shard });
        }
        this.startHeartbeat(interval);
        break;
      }
      case 11:
        if (this.ackTimer) {
          clearTimeout(this.ackTimer);
          this.ackTimer = undefined;
        }
        break;
      case 1:
        await this.sendHeartbeat();
        break;
      case 7:
        this.logger.info('Gateway requested reconnect.');
        this.reconnect(false);
        break;
      case 9:
        this.logger.warn('Gateway invalidated the session; starting a fresh identify.');
        this.sessionId = undefined;
        this.lastSeq = undefined;
        this.reconnect(true);
        break;
      case 0:
        this.handleDispatch(payload);
        break;
      default:
        this.logger.debug('Unhandled gateway op.', { op: payload.op });
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    if (typeof payload.s === 'number') this.lastSeq = payload.s;
    if (payload.t === 'READY') {
      const data = asRecord(payload.d);
      this.sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
      this.readyPayload = data;
      this.state = 'ready';
      this.attempts = 0;
      this.lastError = undefined;
      this.logger.info('Gateway READY.', {
        session_id: this.sessionId,
        user: asRecord(data.user).username ?? null,
        shard: data.shard ?? this.shard,
      });
    } else if (payload.t === 'RESUMED') {
      this.state = 'ready';
      this.attempts = 0;
      this.logger.info('Gateway RESUMED.');
    }
    if (payload.t) {
      this.store.push({
        id: payload.id ?? `${payload.t}:${payload.s ?? Date.now()}`,
        type: payload.t,
        data: payload.d,
        raw: payload,
        shard: this.shard,
      });
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearTimers();
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, intervalMs);
    void this.sendHeartbeat();
    this.heartbeatTimer.unref();
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.ackTimer) {
      this.logger.warn('Gateway heartbeat not acknowledged; reconnecting.');
      this.socket?.terminate();
      return;
    }
    try {
      await this.send({ op: 1, d: this.lastSeq ?? null });
    } catch (error) {
      this.logger.warn('Failed to send heartbeat.', { error: errorMessage(error) });
      this.socket?.terminate();
      return;
    }
    this.ackTimer = setTimeout(() => {
      this.logger.warn('Gateway heartbeat ACK timeout; reconnecting.');
      this.socket?.terminate();
    }, 10_000);
    this.ackTimer.unref();
  }

  private send(payload: GatewayPayload): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new ToolError('Gateway socket is not open.'));
    }
    return new Promise((resolve, reject) => {
      socket.send(JSON.stringify(payload), (error) => (error ? reject(error) : resolve()));
    });
  }

  private reconnect(resetSession: boolean): void {
    if (this.manualStop) return;
    this.clearTimers();
    if (resetSession) {
      this.sessionId = undefined;
      this.lastSeq = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.close(4000, 'reconnect');
      } catch {
        socket.terminate();
      }
    }
    this.scheduleReconnect();
  }

  private handleClose(code: number, reason: string): void {
    this.socket = undefined;
    this.clearTimers();
    if (this.manualStop) {
      this.state = 'closed';
      return;
    }
    this.logger.warn('Gateway closed.', { code, reason: reason.slice(0, 200) });
    if (code === 4004) {
      this.tokenManager.invalidate();
      this.lastError = 'Gateway rejected the access token (4004). Will retry with a fresh token.';
    } else if (RESET_SESSION_CODES.has(code)) {
      this.sessionId = undefined;
      this.lastSeq = undefined;
      this.lastError = `Gateway session reset (${code}).`;
    } else if (FATAL_CODES.has(code)) {
      this.state = 'fatal';
      this.lastError = `Gateway closed with fatal code ${code}: ${reason}`;
      this.logger.error(this.lastError);
      return;
    } else {
      this.lastError = `Gateway closed (${code}): ${reason}`;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.manualStop || this.reconnectTimer) return;
    this.state = 'reconnecting';
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempts, 5)) + Math.floor(Math.random() * 500);
    this.attempts += 1;
    this.logger.info('Gateway reconnect scheduled.', { delay_ms: delay, attempt: this.attempts });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.manualStop) return;
      void this.connect().catch((error) => {
        this.lastError = errorMessage(error);
        this.logger.warn('Gateway reconnect failed.', { error: this.lastError });
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.heartbeatTimer = undefined;
    this.ackTimer = undefined;
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.state === 'ready' || this.state === 'fatal' || this.state === 'closed') return;
      await sleep(100);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
