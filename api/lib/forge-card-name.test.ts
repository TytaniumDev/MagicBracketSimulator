/**
 * Tests for forge-card-name.ts.
 *
 * Run with: npx tsx lib/forge-card-name.test.ts
 */

import { forgeCardName, normalizeDckForForge } from './forge-card-name';

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

test('forgeCardName: keeps the front face of a two-part card', () => {
  assertEqual(forgeCardName('Whirlwing Stormbrood // Dynamic Soar'), 'Whirlwing Stormbrood', 'omen');
  assertEqual(forgeCardName('Fire // Ice'), 'Fire', 'split');
});

test('forgeCardName: leaves single-faced names alone', () => {
  assertEqual(forgeCardName('Sol Ring'), 'Sol Ring', 'plain');
  assertEqual(forgeCardName('  Sol Ring '), 'Sol Ring', 'trimmed');
});

test('normalizeDckForForge: rewrites card lines and keeps set suffixes', () => {
  const dck = [
    '[metadata]',
    'Name=Temur // Test',
    '[commander]',
    '1 Ureni of the Unwritten',
    '[main]',
    '1 Whirlwing Stormbrood // Dynamic Soar',
    '1x Brazen Borrower // Petty Theft|ELD|39',
    '2 Forest',
  ].join('\n');
  assertEqual(
    normalizeDckForForge(dck).split('\n'),
    [
      '[metadata]',
      'Name=Temur // Test',
      '[commander]',
      '1 Ureni of the Unwritten',
      '[main]',
      '1 Whirlwing Stormbrood',
      '1x Brazen Borrower|ELD|39',
      '2 Forest',
    ],
    'lines',
  );
});

test('normalizeDckForForge: returns decks without two-part cards unchanged', () => {
  const dck = '[main]\n1 Sol Ring\r\n1 Forest';
  assertEqual(normalizeDckForForge(dck), dck, 'unchanged');
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\nPassed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);
if (failed > 0) process.exit(1);
