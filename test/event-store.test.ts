import { describe, expect, it, vi } from 'vitest';
import { EventStore } from '../src/events/store.js';

function makeStore(options: Partial<{ capacity: number; ttlMs: number }> = {}) {
  let now = 1_700_000_000_000;
  const store = new EventStore({
    capacity: options.capacity ?? 3,
    ttlMs: options.ttlMs ?? 60_000,
    now: () => now,
  });
  return { store, advance: (ms: number) => (now += ms) };
}

describe('EventStore', () => {
  it('buffers, filters by type and consumes on poll', () => {
    const { store } = makeStore({ capacity: 10 });
    store.push({ id: '1', type: 'C2C_MESSAGE_CREATE', data: { content: 'hi' } });
    store.push({ id: '2', type: 'GROUP_AT_MESSAGE_CREATE', data: { content: 'yo' } });
    const first = store.poll({ types: ['c2c_message_create'] });
    expect(first.events).toHaveLength(1);
    expect(first.events[0].data).toEqual({ content: 'hi' });
    const second = store.poll({});
    expect(second.events.map((event) => event.id)).toEqual(['2']);
    expect(store.status().buffered).toBe(0);
  });

  it('peek does not consume, since_seq filters old events', () => {
    const { store } = makeStore({ capacity: 10 });
    store.push({ type: 'A', data: 1 });
    store.push({ type: 'A', data: 2 });
    const peeked = store.poll({ peek: true, limit: 1 });
    expect(peeked.events).toHaveLength(1);
    expect(store.status().buffered).toBe(2);
    const since = store.poll({ sinceSeq: 1 });
    expect(since.events.map((event) => event.data)).toEqual([2]);
  });

  it('deduplicates event ids', () => {
    const { store } = makeStore({ capacity: 10 });
    store.push({ id: 'same', type: 'A', data: 1 });
    store.push({ id: 'same', type: 'A', data: 2 });
    expect(store.status().buffered).toBe(1);
    expect(store.status().duplicates).toBe(1);
  });

  it('drops the oldest event when capacity is exceeded', () => {
    const { store } = makeStore({ capacity: 2 });
    store.push({ id: '1', type: 'A', data: 1 });
    store.push({ id: '2', type: 'A', data: 2 });
    store.push({ id: '3', type: 'A', data: 3 });
    const result = store.poll({});
    expect(result.events.map((event) => event.id)).toEqual(['2', '3']);
    expect(result.dropped).toBe(1);
  });

  it('expires old events by TTL', () => {
    const { store, advance } = makeStore({ ttlMs: 1_000, capacity: 10 });
    store.push({ id: 'old', type: 'A', data: 1 });
    advance(1_001);
    expect(store.status().buffered).toBe(0);
    expect(store.status().expired).toBe(1);
  });

  it('wait resolves immediately for buffered matches and consumes them', async () => {
    const { store } = makeStore({ capacity: 10 });
    store.push({ id: '1', type: 'C2C_MESSAGE_CREATE', data: {} });
    const result = await store.wait({ types: ['C2C_MESSAGE_CREATE'], timeoutMs: 100 });
    expect(result.timed_out).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(store.status().buffered).toBe(0);
  });

  it('wait resolves when a new event arrives', async () => {
    const { store } = makeStore({ capacity: 10 });
    const pending = store.wait({ types: ['GROUP_AT_MESSAGE_CREATE'], timeoutMs: 1_000 });
    store.push({ id: '1', type: 'C2C_MESSAGE_CREATE', data: {} });
    store.push({ id: '2', type: 'GROUP_AT_MESSAGE_CREATE', data: { content: 'new' } });
    const result = await pending;
    expect(result.timed_out).toBe(false);
    expect(result.events[0].id).toBe('2');
    expect(store.status().waiters).toBe(0);
  });

  it('wait times out with timed_out=true', async () => {
    const { store } = makeStore({ capacity: 10 });
    const result = await store.wait({ timeoutMs: 20 });
    expect(result.timed_out).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('wait can be aborted', async () => {
    const { store } = makeStore({ capacity: 10 });
    const controller = new AbortController();
    const pending = store.wait({ timeoutMs: 5_000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(store.status().waiters).toBe(0);
  });

  it('clears the buffer', () => {
    const { store } = makeStore({ capacity: 10 });
    store.push({ id: '1', type: 'A', data: 1 });
    expect(store.clear()).toBe(1);
    expect(store.status().buffered).toBe(0);
  });
});
