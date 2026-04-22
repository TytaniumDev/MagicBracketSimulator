/**
 * Unit tests for the claim-sim override header encoder.
 * Run with: npx tsx lib/override-header.test.ts
 */

import { encodeOverrideHeader, OVERRIDE_HEADER_NONE } from './override-header';

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
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('Running override-header tests...\n');

test('null override encodes as "none"', () => {
  assertEqual(encodeOverrideHeader(null), OVERRIDE_HEADER_NONE, 'null');
});

test('positive integer override encodes as string digits', () => {
  assertEqual(encodeOverrideHeader(1), '1', 'min');
  assertEqual(encodeOverrideHeader(4), '4', 'typical');
  assertEqual(encodeOverrideHeader(20), '20', 'max from existing validators');
});

console.log('\n-------------------');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
