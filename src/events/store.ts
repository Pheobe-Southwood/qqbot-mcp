import type { StoredEvent } from '../types.js';
import { ToolError } from '../client/errors.js';

export interface EventInput {
  id?: string;
  type: string;
  data: unknown;
  raw?: unknown;
  shard?: [number, number];
  receivedAt?: string;
}

export interface EventQuery {
  types?: string[];
  limit?: number;
  peek?: boolean;
  sinceSeq?: number;
}

export interface PollResult {
  events: StoredEvent[];
  remaining: number;
  dropped: number;
  last_seq: number;
}

export interface WaitResult extends PollResult {
  timed_out: boolean;
  waited_ms: number;
}

interface Waiter {
  types?: Set<string>;
  limit: number;
  peek: boolean;
  sinceSeq: number;
  resolve: (result: WaitResult) => void;
  timer: NodeJS.Timeout;
  startedAt: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class EventStore {
  private readonly events: StoredEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly waiters = new Set<Waiter>();
  private sequence = 0;
  private dropped = 0;
  private duplicates = 0;
  private expired = 0;

  constructor(
    private readonly options: { capacity: number; ttlMs: number; now?: () => number },
  ) {}

  push(input: EventInput): StoredEvent {
    const now = this.now();
    this.cleanup(now);
    this.sequence += 1;
    const type = input.type.toUpperCase();
    const id = input.id || `${type}:${this.sequence}`;
    if (this.ids.has(id)) {
      this.duplicates += 1;
      return { seq: this.sequence, id, type, receivedAt: new Date(now).toISOString(), data: input.data, raw: input.raw, shard: input.shard };
    }
    const event: StoredEvent = {
      seq: this.sequence,
      id,
      type,
      receivedAt: input.receivedAt ?? new Date(now).toISOString(),
      data: input.data,
      raw: input.raw ?? input.data,
      ...(input.shard ? { shard: input.shard } : {}),
    };
    this.events.push(event);
    this.ids.add(id);
    while (this.events.length > this.options.capacity) {
      const removed = this.events.shift();
      if (removed) {
        this.ids.delete(removed.id);
        this.dropped += 1;
      }
    }
    this.notify();
    return event;
  }

  poll(query: EventQuery = {}): PollResult {
    this.cleanup(this.now());
    const limit = clampLimit(query.limit);
    const matches = this.matching(query, limit);
    if (!query.peek) this.remove(matches);
    return {
      events: matches.map((event) => event),
      remaining: this.events.length,
      dropped: this.dropped,
      last_seq: this.sequence,
    };
  }

  wait(query: EventQuery & { timeoutMs: number; signal?: AbortSignal }): Promise<WaitResult> {
    this.cleanup(this.now());
    const startedAt = this.now();
    const limit = clampLimit(query.limit);
    const immediate = this.matching(query, limit);
    if (immediate.length > 0) {
      if (!query.peek) this.remove(immediate);
      return Promise.resolve({
        events: immediate.map((event) => event),
        remaining: this.events.length,
        dropped: this.dropped,
        last_seq: this.sequence,
        timed_out: false,
        waited_ms: 0,
      });
    }
    return new Promise<WaitResult>((resolve, reject) => {
      const waiter: Waiter = {
        types: query.types && query.types.length > 0 ? new Set(query.types.map((type) => type.toUpperCase())) : undefined,
        limit,
        peek: Boolean(query.peek),
        sinceSeq: query.sinceSeq ?? 0,
        resolve,
        timer: setTimeout(() => undefined, 0),
        startedAt,
        signal: query.signal,
      };
      clearTimeout(waiter.timer);
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
        resolve({
          events: [],
          remaining: this.events.length,
          dropped: this.dropped,
          last_seq: this.sequence,
          timed_out: true,
          waited_ms: this.now() - startedAt,
        });
      }, query.timeoutMs);
      if (query.signal) {
        waiter.onAbort = () => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          reject(new ToolError('wait_events cancelled by the client.'));
        };
        if (query.signal.aborted) {
          waiter.onAbort();
          return;
        }
        query.signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.add(waiter);
      // Re-check after registering: an event could have arrived in between.
      this.notify();
    });
  }

  clear(): number {
    const count = this.events.length;
    this.events.length = 0;
    this.ids.clear();
    return count;
  }

  status(): Record<string, unknown> {
    this.cleanup(this.now());
    const byType: Record<string, number> = {};
    for (const event of this.events) byType[event.type] = (byType[event.type] ?? 0) + 1;
    return {
      buffered: this.events.length,
      capacity: this.options.capacity,
      ttl_ms: this.options.ttlMs,
      last_seq: this.sequence,
      dropped: this.dropped,
      duplicates: this.duplicates,
      expired: this.expired,
      waiters: this.waiters.size,
      by_type: byType,
      oldest: this.events[0]?.receivedAt ?? null,
      newest: this.events[this.events.length - 1]?.receivedAt ?? null,
    };
  }

  private matching(query: EventQuery, limit: number): StoredEvent[] {
    const types = query.types && query.types.length > 0 ? new Set(query.types.map((type) => type.toUpperCase())) : undefined;
    const sinceSeq = query.sinceSeq ?? 0;
    const result: StoredEvent[] = [];
    for (const event of this.events) {
      if (event.seq <= sinceSeq) continue;
      if (types && !types.has(event.type)) continue;
      result.push(event);
      if (result.length >= limit) break;
    }
    return result;
  }

  private remove(events: StoredEvent[]): void {
    if (events.length === 0) return;
    const removing = new Set(events.map((event) => event.seq));
    for (let index = this.events.length - 1; index >= 0; index--) {
      const event = this.events[index]!;
      if (removing.has(event.seq)) {
        this.events.splice(index, 1);
        this.ids.delete(event.id);
      }
    }
  }

  private notify(): void {
    if (this.waiters.size === 0) return;
    for (const waiter of [...this.waiters]) {
      const query: EventQuery = {
        types: waiter.types ? [...waiter.types] : undefined,
        limit: waiter.limit,
        sinceSeq: waiter.sinceSeq,
      };
      const matches = this.matching(query, waiter.limit);
      if (matches.length === 0) continue;
      if (!waiter.peek) this.remove(matches);
      clearTimeout(waiter.timer);
      if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
      this.waiters.delete(waiter);
      waiter.resolve({
        events: matches,
        remaining: this.events.length,
        dropped: this.dropped,
        last_seq: this.sequence,
        timed_out: false,
        waited_ms: this.now() - waiter.startedAt,
      });
    }
  }

  private cleanup(now: number): void {
    const cutoff = now - this.options.ttlMs;
    while (this.events.length > 0) {
      const first = this.events[0]!;
      if (Date.parse(first.receivedAt) >= cutoff) break;
      this.events.shift();
      this.ids.delete(first.id);
      this.expired += 1;
    }
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}
