/**
 * Tests for lru.ts helpers.
 *
 * Run with: npx tsx lib/lru.test.ts
 */

import { lruTouch, lruEvictIfFull } from './lru';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// lruTouch
// ---------------------------------------------------------------------------

test('lruTouch: returns undefined for missing key', () => {
  const m = new Map<string, number>();
  assertEqual(lruTouch(m, 'x'), undefined, 'missing key');
});

test('lruTouch: returns value for existing key', () => {
  const m = new Map<string, number>([['a', 1]]);
  assertEqual(lruTouch(m, 'a'), 1, 'existing key value');
});

test('lruTouch: moves touched entry to end of insertion order', () => {
  const m = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  lruTouch(m, 'a');
  const keys = [...m.keys()];
  assertEqual(keys[0], 'b', 'b should become first');
  assertEqual(keys[1], 'c', 'c should become second');
  assertEqual(keys[2], 'a', 'a should be last');
});

test('lruTouch: touching last entry is a no-op for order', () => {
  const m = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  lruTouch(m, 'c');
  assertEqual([...m.keys()].join(','), 'a,b,c', 'order unchanged');
});

test('lruTouch: does not modify map for missing key', () => {
  const m = new Map<string, number>([['a', 1]]);
  lruTouch(m, 'missing');
  assertEqual(m.size, 1, 'size unchanged');
  assertEqual(m.get('a'), 1, 'value unchanged');
});

// ---------------------------------------------------------------------------
// lruEvictIfFull
// ---------------------------------------------------------------------------

test('lruEvictIfFull: no eviction when under capacity', () => {
  const m = new Map<string, number>([['a', 1], ['b', 2]]);
  lruEvictIfFull(m, 5);
  assertEqual(m.size, 2, 'size unchanged');
});

test('lruEvictIfFull: evicts oldest entry when at capacity', () => {
  const m = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  lruEvictIfFull(m, 3);
  assertEqual(m.size, 2, 'one evicted');
  assert(!m.has('a'), 'a should be evicted');
  assert(m.has('b'), 'b remains');
  assert(m.has('c'), 'c remains');
});

test('lruEvictIfFull: respects recency updates from lruTouch', () => {
  const m = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  lruTouch(m, 'a'); // a becomes most-recent
  lruEvictIfFull(m, 3);
  assert(!m.has('b'), 'b (oldest after touch) should be evicted');
  assert(m.has('a'), 'a should remain (just touched)');
  assert(m.has('c'), 'c remains');
});

test('lruEvictIfFull: evicts multiple entries when over capacity', () => {
  const m = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
    ['d', 4],
  ]);
  lruEvictIfFull(m, 2);
  assertEqual(m.size, 1, 'should evict down to size < maxSize');
  assert(m.has('d'), 'newest remains');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log('\n--- Test Summary ---');
console.log(`Passed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results
    .filter((r) => !r.passed)
    .forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  process.exit(1);
}
