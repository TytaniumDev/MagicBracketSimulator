/**
 * Tests for the precon release date and rate-limit retry in archidekt-sync.ts.
 *
 * Run with: npx tsx lib/archidekt-sync.test.ts
 */

import { preconReleaseDate, fetchPreconDeck } from './archidekt-sync';
import { isArchidektRateLimit } from './ingestion/archidekt';

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

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

test('preconReleaseDate: takes the date from Archidekt createdAt', () => {
  assertEqual(preconReleaseDate({ createdAt: '2023-04-06T12:30:00.123456Z' }), '2023-04-06', 'date');
});

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

/** Answer each fetch with the next status in turn; returns the call count. */
function stubFetch(statuses: number[]): { calls: () => number } {
  let calls = 0;
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls++;
    if (status !== 200) return new Response(null, { status });
    return new Response(JSON.stringify({ name: 'Test', cards: [] }), { status: 200 });
  }) as typeof fetch;
  return { calls: () => calls };
}

const NO_WAIT = { maxAttempts: 3, delayMs: 0 };

async function runAsyncTests() {
  const realFetch = globalThis.fetch;
  try {
    await testAsync('fetchPreconDeck: retries a 429 and returns the deck', async () => {
      const stub = stubFetch([429, 200]);
      await fetchPreconDeck(1, NO_WAIT);
      assertEqual(stub.calls(), 2, 'fetch calls');
    });

    await testAsync('fetchPreconDeck: gives up after the last 429 attempt', async () => {
      const stub = stubFetch([429]);
      let error: unknown;
      try {
        await fetchPreconDeck(1, NO_WAIT);
      } catch (err) {
        error = err;
      }
      assertEqual(isArchidektRateLimit(error), true, 'rate-limit error');
      assertEqual(stub.calls(), 3, 'fetch calls');
    });

    await testAsync('fetchPreconDeck: does not retry other failures', async () => {
      const stub = stubFetch([500]);
      let error: unknown;
      try {
        await fetchPreconDeck(1, NO_WAIT);
      } catch (err) {
        error = err;
      }
      assertEqual(error instanceof Error, true, 'throws');
      assertEqual(isArchidektRateLimit(error), false, 'not a rate limit');
      assertEqual(stub.calls(), 1, 'fetch calls');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
}

runAsyncTests().then(() => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  if (failed > 0) process.exit(1);
});
