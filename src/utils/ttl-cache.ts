/**
 * Small in-memory LRU + TTL cache (Map-based, insertion order = recency).
 * - `get` refreshes recency; the least recently used entry is evicted at capacity.
 * - Expired entries are dropped lazily on access and eagerly during `set`.
 * - Single-process only, like the rest of the server's in-memory state.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;

  constructor(opts: { ttlMs: number; maxEntries: number; nowFn?: () => number }) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = Math.max(1, opts.maxEntries);
    this.nowFn = opts.nowFn ?? (() => Date.now());
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.nowFn()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency (LRU): delete + re-insert moves the key to the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.pruneExpired();
    while (this.entries.size >= this.maxEntries) {
      // First key in insertion order is the least recently used.
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value: this.valueCopy(value), expiresAt: this.nowFn() + this.ttlMs });
  }

  /** Current number of live (non-expired) entries. */
  size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneExpired(): void {
    const now = this.nowFn();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private valueCopy(value: V): V {
    // Defensive shallow copy: cached objects must not be mutated by callers.
    return value !== null && typeof value === 'object' ? ({ ...(value as object) } as V) : value;
  }
}
