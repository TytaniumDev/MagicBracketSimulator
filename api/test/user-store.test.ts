/**
 * User access store tests: access requests and approval.
 *
 * Firestore only (LOCAL mode has no access control), so this skips unless
 * pointed at the Firestore emulator:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/user-store.test.ts
 */
import { USE_FIRESTORE } from '../lib/env';

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
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

async function main() {
  if (!USE_FIRESTORE) {
    console.log('Skipping user store tests: Firestore only (set FIRESTORE_EMULATOR_HOST).');
    return;
  }
  const { getUserAccess, requestAccess, approveUser, ensureAllowed } = await import('../lib/user-store');
  const { isInAllowedUsers } = await import('../lib/allowed-users');
  const run = Date.now();
  const uid = (name: string) => `user-test-${run}-${name}`;

  await test('requestAccess records a request once', async () => {
    const request = { email: 'new@example.com', displayName: 'New', message: 'please' };
    assertEqual(await requestAccess(uid('new'), request), null, 'first request');
    assertEqual(await requestAccess(uid('new'), request), 'requested', 'second request');
    const access = await getUserAccess(uid('new'));
    assertEqual([access?.status, access?.message], ['requested', 'please'], 'record');
    assertEqual(access?.requestedAt instanceof Date, true, 'requestedAt');
  });

  await test('approveUser gives access and reports the status before', async () => {
    assertEqual(await isInAllowedUsers(uid('new')), false, 'not allowed yet');
    assertEqual((await approveUser(uid('new')))?.status, 'requested', 'before');
    assertEqual((await approveUser(uid('new')))?.status, 'allowed', 'already approved');
    assertEqual(await isInAllowedUsers(uid('new')), true, 'allowed');
    assertEqual((await getUserAccess(uid('new')))?.approvedAt instanceof Date, true, 'approvedAt');
  });

  await test('approveUser returns null for a user who never asked', async () => {
    assertEqual(await approveUser(uid('stranger')), null, 'stranger');
    assertEqual(await getUserAccess(uid('stranger')), null, 'no record created');
  });

  await test('requestAccess leaves an allowed user allowed', async () => {
    assertEqual(await requestAccess(uid('new'), { email: 'x', displayName: null, message: null }), 'allowed', 'status');
    assertEqual((await getUserAccess(uid('new')))?.status, 'allowed', 'still allowed');
  });

  await test('ensureAllowed gives a pre-approved account an allowed record', async () => {
    await ensureAllowed(uid('admin'), 'admin@example.com');
    const access = await getUserAccess(uid('admin'));
    assertEqual(access?.status, 'allowed', 'status');
    assertEqual(access?.email, 'admin@example.com', 'email');
  });

  await test('ensureAllowed allows a pending request and leaves an allowed record as it was', async () => {
    await requestAccess(uid('pending'), { email: 'p@example.com', displayName: 'P', message: 'hi' });
    await ensureAllowed(uid('pending'), 'p@example.com');
    const access = await getUserAccess(uid('pending'));
    assertEqual(access?.status, 'allowed', 'status');
    assertEqual(access?.message, 'hi', 'request kept');
    const approvedAt = access?.approvedAt?.getTime();
    await ensureAllowed(uid('pending'), 'p@example.com');
    assertEqual((await getUserAccess(uid('pending')))?.approvedAt?.getTime(), approvedAt, 'approvedAt unchanged');
  });

  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
