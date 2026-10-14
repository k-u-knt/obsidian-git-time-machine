/** Size-bounded LRU cache. Map iteration order is insertion order, so the first key is the least recently used. */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  private total = 0;

  constructor(
    private readonly maxSize: number,
    private readonly sizeOf: (v: V) => number,
  ) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.total -= this.sizeOf(old);
      this.map.delete(key);
    }
    const size = this.sizeOf(value);
    if (size > this.maxSize) return;
    this.map.set(key, value);
    this.total += size;
    while (this.total > this.maxSize) {
      const [k, v] = this.map.entries().next().value as [K, V];
      this.map.delete(k);
      this.total -= this.sizeOf(v);
    }
  }
}
