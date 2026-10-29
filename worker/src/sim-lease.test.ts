/**
 * Unit tests for the sim lease keeper and idle poll backoff.
 * Run with: npx tsx src/sim-lease.test.ts
 */
import { keepSimLease, nextIdlePollMs, type SimLeaseStatus } from './sim-lease.js';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}\n  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the keeper against a scripted list of extend results. */
async function runKeeper(results: (SimLeaseStatus | null)[], waitMs: number) {
  let calls = 0;
  const ended: string[] = [];
  const stop = keepSimLease({
    extend: async () => results[Math.min(calls++, results.length - 1)],
    onEnd: (status) => ended.push(status),
    intervalMs: 5,
  });
  await tick(waitMs);
  stop();
  return { calls, ended };
}

async function main() {
  await test('keeps extending while the API says extended', async () => {
    const { calls, ended } = await runKeeper(['extended'], 40);
    if (calls < 3) throw new Error(`expected several extensions, got ${calls}`);
    assertEqual(ended.length, 0, 'never ended');
  });

  await test('a failed call (null) is retried, not treated as the end', async () => {
    const { calls, ended } = await runKeeper([null, null, 'extended'], 40);
    if (calls < 3) throw new Error(`expected retries, got ${calls}`);
    assertEqual(ended.length, 0, 'never ended');
  });

  await test('stops and reports once on lost', async () => {
    const { calls, ended } = await runKeeper(['extended', 'lost'], 60);
    assertEqual(calls, 2, 'no extensions after lost');
    assertEqual(ended.join(','), 'lost', 'onEnd called once');
  });

  await test('stops and reports once on cancelled', async () => {
    const { ended } = await runKeeper(['cancelled'], 40);
    assertEqual(ended.join(','), 'cancelled', 'onEnd called once');
  });

  await test('stop() before the first tick never extends', async () => {
    let calls = 0;
    const stop = keepSimLease({ extend: async () => { calls++; return 'extended'; }, onEnd: () => {}, intervalMs: 20 });
    stop();
    await tick(40);
    assertEqual(calls, 0, 'no calls');
  });

  await test('idle poll backoff doubles up to the cap', () => {
    assertEqual(nextIdlePollMs(3000, 3000, 60000), 6000, 'first doubling');
    assertEqual(nextIdlePollMs(48000, 3000, 60000), 60000, 'capped');
    assertEqual(nextIdlePollMs(60000, 3000, 60000), 60000, 'stays at cap');
    assertEqual(nextIdlePollMs(0, 3000, 60000), 6000, 'never below base');
  });

  if (failed > 0) process.exit(1);
}

main();
