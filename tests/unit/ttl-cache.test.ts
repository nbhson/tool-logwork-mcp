import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/utils/ttl-cache.js';

describe('TtlCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1000, maxEntries: 3 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    let now = 1000;
    const cache = new TtlCache<string, number>({
      ttlMs: 500,
      maxEntries: 3,
      nowFn: () => now,
    });
    cache.set('a', 1);
    now += 499;
    expect(cache.get('a')).toBe(1);
    now += 2;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry at capacity', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so 'b' becomes the LRU entry.
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('size() counts only live entries and prunes expired ones', () => {
    let now = 0;
    const cache = new TtlCache<string, number>({ ttlMs: 100, maxEntries: 10, nowFn: () => now });
    cache.set('a', 1);
    cache.set('b', 2);
    now = 101;
    expect(cache.size()).toBe(0);
  });

  it('clear() removes every entry', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1000, maxEntries: 5 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('shallow-copies cached objects so later mutation by the caller is invisible', () => {
    const cache = new TtlCache<string, { v: number }>({ ttlMs: 1000, maxEntries: 5 });
    const value = { v: 1 };
    cache.set('a', value);
    value.v = 999;
    expect(cache.get('a')?.v).toBe(1);
  });

  it('treats maxEntries of at least 1', () => {
    const cache = new TtlCache<string, number>({ ttlMs: 1000, maxEntries: 0 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it('calls the injected now function on reads and writes', () => {
    const nowFn = vi.fn(() => 42);
    const cache = new TtlCache<string, number>({ ttlMs: 10, maxEntries: 2, nowFn });
    cache.set('a', 1);
    cache.get('a');
    expect(nowFn).toHaveBeenCalled();
  });
});
