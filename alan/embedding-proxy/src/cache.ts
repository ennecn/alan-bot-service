/**
 * Simple LRU cache using Map insertion order.
 * Map.keys() iterates in insertion order — oldest first.
 * On get-hit, we delete and re-insert to move to end (most recent).
 */
export class LRUCache<V> {
  private map = new Map<string, V>();

  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first key)
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}
