/**
 * Tests for gcs-retry.ts — retry classification for GCS operations.
 *
 * Run with: npx tsx lib/gcs-retry.test.ts
 */

import { isRetryableGcsError } from './gcs-retry';

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

// ---------------------------------------------------------------------------
// Non-Error inputs
// ---------------------------------------------------------------------------

test('returns false for non-Error values', () => {
  assert(!isRetryableGcsError('some string'), 'string should not be retryable');
  assert(!isRetryableGcsError(null), 'null should not be retryable');
  assert(!isRetryableGcsError(undefined), 'undefined should not be retryable');
  assert(!isRetryableGcsError({ message: 'socket hang up' }), 'plain object should not be retryable');
});

// ---------------------------------------------------------------------------
// Known-retryable message substrings (existing behavior)
// ---------------------------------------------------------------------------

test('retries on socket hang up', () => {
  assert(isRetryableGcsError(new Error('socket hang up')), 'socket hang up');
});

test('retries on ECONNRESET (case-insensitive)', () => {
  assert(isRetryableGcsError(new Error('ECONNRESET')), 'uppercase ECONNRESET');
  assert(isRetryableGcsError(new Error('read econnreset')), 'lowercase within message');
});

test('retries on ETIMEDOUT', () => {
  assert(isRetryableGcsError(new Error('connect ETIMEDOUT 1.2.3.4:443')), 'ETIMEDOUT');
});

test('retries on ECONNREFUSED', () => {
  assert(isRetryableGcsError(new Error('connect ECONNREFUSED')), 'ECONNREFUSED');
});

test('retries on generic network error wording', () => {
  assert(isRetryableGcsError(new Error('Network error while uploading')), 'network error');
});

// ---------------------------------------------------------------------------
// Regression for issue #158: TLS-handshake socket disconnect
// ---------------------------------------------------------------------------

test('retries on "Client network socket disconnected before secure TLS connection was established" (issue #158)', () => {
  // Exact message observed in Sentry MAGIC-BRACKET-API-3.
  const err = new Error(
    'request to https://storage.googleapis.com/upload/storage/v1/b/magic-bracket-simulator-artifacts/o?name=jobs%2F4ipRXXpEREnNZa2sAVka%2Fraw%2Fgame_001.txt&uploadType=resumable failed, reason: Client network socket disconnected before secure TLS connection was established'
  );
  assert(isRetryableGcsError(err), 'TLS socket disconnect should be retryable');
});

test('retries on bare "Client network socket disconnected" wording', () => {
  const err = new Error('Client network socket disconnected before secure TLS connection was established');
  assert(isRetryableGcsError(err), 'bare TLS disconnect wording should be retryable');
});

// ---------------------------------------------------------------------------
// HTTP status codes
// ---------------------------------------------------------------------------

test('retries on 429/500/502/503/504 via .code', () => {
  for (const code of [429, 500, 502, 503, 504]) {
    const err = Object.assign(new Error('server blew up'), { code });
    assert(isRetryableGcsError(err), `code ${code} should be retryable`);
  }
});

test('does NOT retry on 400/401/403/404', () => {
  for (const code of [400, 401, 403, 404]) {
    const err = Object.assign(new Error('nope'), { code });
    assert(!isRetryableGcsError(err), `code ${code} should not be retryable`);
  }
});

// ---------------------------------------------------------------------------
// Non-retryable cases
// ---------------------------------------------------------------------------

test('does not retry on arbitrary application errors', () => {
  assert(!isRetryableGcsError(new Error('permission denied')), 'permission denied');
  assert(!isRetryableGcsError(new Error('invalid bucket name')), 'invalid bucket');
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
