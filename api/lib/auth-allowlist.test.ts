/**
 * Unit tests for isAllowedAccount (the allowlist behind verifyAllowedUser).
 * Run with: npx tsx lib/auth-allowlist.test.ts
 */

export {};

// auth.ts reads these at import time, so set them before importing it.
process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
process.env.ADMIN_EMAILS = 'Admin@Example.com';
process.env.ALLOWED_EMAILS = 'friend@example.com';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
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

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const { isAllowedAccount } = await import('./auth');
  const approved = new Set(['approved-uid']);
  const lookup = async (uid: string) => approved.has(uid);
  const failingLookup = async (): Promise<boolean> => {
    throw new Error('lookup should not run');
  };

  console.log('Running allowlist tests...\n');

  await test('rejects a signed-in account that was never approved', async () => {
    assertEqual(await isAllowedAccount('stranger', 'stranger@example.com', lookup), false, 'stranger');
  });

  await test('accepts an account approved into allowedUsers', async () => {
    assertEqual(await isAllowedAccount('approved-uid', 'new@example.com', lookup), true, 'approved');
  });

  await test('accepts admins without a lookup, case-insensitively', async () => {
    assertEqual(await isAllowedAccount('admin-uid', 'admin@EXAMPLE.com', failingLookup), true, 'admin');
  });

  await test('accepts emails listed in ALLOWED_EMAILS without a lookup', async () => {
    assertEqual(await isAllowedAccount('friend-uid', 'Friend@example.com', failingLookup), true, 'env email');
  });

  console.log('\n-------------------');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
