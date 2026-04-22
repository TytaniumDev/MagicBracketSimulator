/**
 * Unit tests for parseOverrideHeader.
 * Run with: npx tsx src/override.test.ts
 */

import { parseOverrideHeader } from './override.js';

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

console.log('Running override header parser tests...\n');

test('null header returns undefined (leave override alone)', () => {
  assertEqual(parseOverrideHeader(null), undefined, 'missing header');
});

test('"none" returns null (explicit clear)', () => {
  assertEqual(parseOverrideHeader('none'), null, '"none" string');
});

test('valid positive integer returns the number', () => {
  assertEqual(parseOverrideHeader('1'), 1, 'min');
  assertEqual(parseOverrideHeader('4'), 4, 'typical');
  assertEqual(parseOverrideHeader('20'), 20, 'upper boundary of API validators');
  assertEqual(parseOverrideHeader('50'), 50, 'beyond 20 passes through (API validates on write)');
});

test('zero / negative / non-integer / garbage returns undefined', () => {
  assertEqual(parseOverrideHeader('0'), undefined, 'zero rejected');
  assertEqual(parseOverrideHeader('-3'), undefined, 'negative rejected');
  assertEqual(parseOverrideHeader('1.5'), undefined, 'fractional rejected');
  assertEqual(parseOverrideHeader('foo'), undefined, 'non-numeric rejected');
  assertEqual(parseOverrideHeader(''), undefined, 'empty string rejected');
  assertEqual(parseOverrideHeader('3abc'), undefined, 'trailing garbage rejected');
});

console.log('\n-------------------');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
