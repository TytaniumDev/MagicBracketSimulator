/**
 * Tiny LRU helpers for Map-backed in-memory caches.
 *
 * ECMAScript Maps iterate in insertion order, so we get LRU semantics by
 * (a) re-inserting on access so the touched entry moves to the end, and
 * (b) evicting the first key (least-recently-used) when full.
 *
 * No dependencies, no class, no allocation on cache hits beyond the reinsert.
 */

/**
 * Mark `key` as most-recently-used and return its value (or undefined if
 * absent). Safe to call on a missing key — it's a no-op.
 */
export function lruTouch<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key) as V;
  map.delete(key);
  map.set(key, value);
  return value;
}

/**
 * Evict least-recently-used entries until `map.size < maxSize`. Call this
 * before inserting a new entry if the cache has grown to capacity.
 */
export function lruEvictIfFull<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
