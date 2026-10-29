/**
 * Unit tests for isWorkerOrAllowlistedUser.
 * Run with: npx tsx lib/worker-auth.test.ts
 */

import { NextRequest } from 'next/server';
import { isWorkerOrAllowlistedUser, type WorkerAuthDeps } from './worker-auth';

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

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/jobs/j1/logs/simulation', {
    method: 'POST',
    headers,
  });
}

function deps(overrides: Partial<WorkerAuthDeps> = {}): WorkerAuthDeps {
  return {
    isWorkerRequest: () => false,
    verifyAuth: async () => ({ uid: 'u1', email: 'u1@example.com' }),
    isInAllowedUsers: async () => true,
    ...overrides,
  };
}

async function main() {
  console.log('Running worker-auth tests...\n');

  await test('accepts the worker secret without checking a token', async () => {
    let verified = false;
    const ok = await isWorkerOrAllowlistedUser(
      request(),
      deps({
        isWorkerRequest: () => true,
        verifyAuth: async () => {
          verified = true;
          throw new Error('should not be called');
        },
      }),
    );
    assertEqual(ok, true, 'worker secret accepted');
    assertEqual(verified, false, 'token not verified');
  });

  await test('rejects a request with no secret and no token', async () => {
    const ok = await isWorkerOrAllowlistedUser(request(), deps());
    assertEqual(ok, false, 'anonymous rejected');
  });

  await test('accepts a valid token for an allowlisted user', async () => {
    let checkedUid = '';
    const ok = await isWorkerOrAllowlistedUser(
      request({ Authorization: 'Bearer t' }),
      deps({
        isInAllowedUsers: async (uid) => {
          checkedUid = uid;
          return true;
        },
      }),
    );
    assertEqual(ok, true, 'allowlisted user accepted');
    assertEqual(checkedUid, 'u1', 'allowlist checked for token uid');
  });

  await test('rejects a valid token for a user without access', async () => {
    const ok = await isWorkerOrAllowlistedUser(
      request({ Authorization: 'Bearer t' }),
      deps({ isInAllowedUsers: async () => false }),
    );
    assertEqual(ok, false, 'non-allowlisted user rejected');
  });

  await test('rejects an invalid token without throwing', async () => {
    const ok = await isWorkerOrAllowlistedUser(
      request({ Authorization: 'Bearer bad' }),
      deps({
        verifyAuth: async () => {
          throw new Error('Invalid token');
        },
      }),
    );
    assertEqual(ok, false, 'invalid token rejected');
  });

  await test('rejects when the allowlist lookup fails', async () => {
    const ok = await isWorkerOrAllowlistedUser(
      request({ Authorization: 'Bearer t' }),
      deps({
        isInAllowedUsers: async () => {
          throw new Error('firestore unavailable');
        },
      }),
    );
    assertEqual(ok, false, 'lookup failure rejected');
  });

  console.log('\n-------------------');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
