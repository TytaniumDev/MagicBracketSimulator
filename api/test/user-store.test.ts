/**
 * User access store tests: access requests, approval, and the one-time copy
 * of the legacy allowedUsers and accessRequests collections.
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
  const { getFirestore } = await import('../lib/firestore-client');
  const { getUserAccess, requestAccess, approveUser } = await import('../lib/user-store');
  const { isInAllowedUsers } = await import('../lib/allowed-users');
  const db = getFirestore();
  const run = Date.now();
  const uid = (name: string) => `user-test-${run}-${name}`;

  // Legacy records, copied by the migration on the store's first call.
  await db.collection('config').doc('legacyUsersMigration').delete();
  await db.collection('allowedUsers').doc(uid('old-allowed')).set({ email: 'old@example.com', approvedAt: new Date() });
  await db.collection('accessRequests').add({
    uid: uid('old-pending'), email: 'pending@example.com', displayName: 'Pen', message: 'hi',
    status: 'pending', createdAt: new Date(),
  });
  await db.collection('accessRequests').add({
    uid: uid('old-approved-request'), email: 'done@example.com', status: 'approved', createdAt: new Date(),
  });
  await db.collection('users').doc(uid('already-moved')).set({ email: 'kept@example.com', status: 'requested' });
  await db.collection('allowedUsers').doc(uid('already-moved')).set({ email: 'old@example.com' });

  await test('legacy allowed users and pending requests are copied once', async () => {
    assertEqual((await getUserAccess(uid('old-allowed')))?.status, 'allowed', 'allowed user');
    const pending = await getUserAccess(uid('old-pending'));
    assertEqual([pending?.status, pending?.email, pending?.message], ['requested', 'pending@example.com', 'hi'], 'pending');
    assertEqual(await getUserAccess(uid('old-approved-request')), null, 'resolved request not copied');
    const kept = await getUserAccess(uid('already-moved'));
    assertEqual([kept?.status, kept?.email], ['requested', 'kept@example.com'], 'existing users doc kept');
    assertEqual((await db.collection('config').doc('legacyUsersMigration').get()).exists, true, 'marker');
  });

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
    assertEqual(await requestAccess(uid('old-allowed'), { email: 'x', displayName: null, message: null }), 'allowed', 'status');
    assertEqual((await getUserAccess(uid('old-allowed')))?.status, 'allowed', 'still allowed');
  });

  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
