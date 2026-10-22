import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseRateLimit, RateLimiter } from '../src/client/ratelimit.js';
import { RateLimitError } from '../src/client/errors.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('rate limit parsing', () => {
  it('parses QPS and QPM strings', () => {
    expect(parseRateLimit('100 QPS')).toEqual({ limit: 100, windowMs: 1_000 });
    expect(parseRateLimit('30 QPM')).toEqual({ limit: 30, windowMs: 60_000 });
    expect(parseRateLimit('2 QPM / 10 QPM burst')).toEqual({ limit: 2, windowMs: 60_000 });
    expect(parseRateLimit('no limit')).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit then throws retry_after_ms', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const limiter = new RateLimiter(true);
    limiter.acquire('GET /x', '2 QPS', { limit: 10, windowMs: 1_000 });
    limiter.acquire('GET /x', '2 QPS', { limit: 10, windowMs: 1_000 });
    try {
      limiter.acquire('GET /x', '2 QPS', { limit: 10, windowMs: 1_000 });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
    }
    vi.advanceTimersByTime(1_001);
    expect(() => limiter.acquire('GET /x', '2 QPS', { limit: 10, windowMs: 1_000 })).not.toThrow();
  });

  it('uses independent buckets per route', () => {
    const limiter = new RateLimiter(true);
    limiter.acquire('GET /a', '1 QPS', { limit: 1, windowMs: 1_000 });
    expect(() => limiter.acquire('GET /b', '1 QPS', { limit: 1, windowMs: 1_000 })).not.toThrow();
  });

  it('is a no-op when disabled', () => {
    const limiter = new RateLimiter(false);
    for (let i = 0; i < 100; i++) limiter.acquire('GET /x', '1 QPS', { limit: 1, windowMs: 1_000 });
    expect(limiter.status()).toEqual([]);
  });
});
