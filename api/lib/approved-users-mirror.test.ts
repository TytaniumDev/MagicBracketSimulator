/**
 * Unit tests for the approved-users mirror (approved-users-mirror.ts).
 * Run with: npx tsx lib/approved-users-mirror.test.ts
 */

export {};

// The mirror only runs in GCP mode.
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const { createApprovedUsersMirror } = await import('./approved-users-mirror');

  await test('writes each uid once per instance', async () => {
    const writes: string[] = [];
    const mirror = createApprovedUsersMirror(async (uid) => { writes.push(uid); });
    await mirror('a');
    await mirror('a');
    await mirror('b');
    assertEqual(writes, ['a', 'b'], 'writes');
  });

  await test('retries a uid after a failed write without throwing', async () => {
    let attempts = 0;
    const mirror = createApprovedUsersMirror(async () => {
      attempts++;
      if (attempts === 1) throw new Error('rtdb down');
    });
    await mirror('a');
    await mirror('a');
    await mirror('a');
    assertEqual(attempts, 2, 'attempts');
  });

  if (failed > 0) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll approved-users mirror tests passed');
}

main();
