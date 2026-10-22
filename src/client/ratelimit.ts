import { RateLimitError } from './errors.js';

interface Bucket {
  limit: number;
  windowMs: number;
  hits: number[];
}

interface ParsedLimit {
  limit: number;
  windowMs: number;
}

/** Parse QQ doc rate strings such as "100 QPS", "30 QPM", "2 QPM / 10 QPM burst". */
export function parseRateLimit(raw: string | undefined): ParsedLimit | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d+)\s*QP([SM])/i);
  if (!match) return undefined;
  const limit = Number(match[1]);
  const windowMs = (match[2] ?? 'S').toUpperCase() === 'S' ? 1_000 : 60_000;
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  return { limit, windowMs };
}

/**
 * Per-route sliding-window limiter. Conservative by design: when the docs do not
 * declare a limit we use 10 qps for reads and 5 qps for writes. Callers get an
 * immediate RateLimitError (with retry_after_ms) instead of being queued.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly enabled = true) {}

  acquire(key: string, rateLimit: string | undefined, fallback: ParsedLimit): void {
    if (!this.enabled) return;
    const parsed = parseRateLimit(rateLimit) ?? fallback;
    const now = Date.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.limit !== parsed.limit || bucket.windowMs !== parsed.windowMs) {
      bucket = { ...parsed, hits: [] };
      this.buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < bucket!.windowMs);
    if (bucket.hits.length >= bucket.limit) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfterMs = Math.max(1, bucket.windowMs - (now - oldest));
      throw new RateLimitError(
        `Local rate limit reached for ${key} (${parsed.limit}/${parsed.windowMs / 1000}s). Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      );
    }
    bucket.hits.push(now);
  }

  status(): Array<{ key: string; used: number; limit: number; windowMs: number }> {
    const now = Date.now();
    return [...this.buckets.entries()].map(([key, bucket]) => ({
      key,
      used: bucket.hits.filter((timestamp) => now - timestamp < bucket.windowMs).length,
      limit: bucket.limit,
      windowMs: bucket.windowMs,
    }));
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < bucket.windowMs);
      if (bucket.hits.length === 0) this.buckets.delete(key);
    }
  }
}

export const DEFAULT_READ_LIMIT: ParsedLimit = { limit: 10, windowMs: 1_000 };
export const DEFAULT_WRITE_LIMIT: ParsedLimit = { limit: 5, windowMs: 1_000 };
