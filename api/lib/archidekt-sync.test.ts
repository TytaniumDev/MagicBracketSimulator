/**
 * Tests for the precon release cutoff in archidekt-sync.ts.
 *
 * Run with: npx tsx lib/archidekt-sync.test.ts
 */

import { isAfterPreconCutoff, preconReleaseDate, PRECON_CUTOFF_DATE } from './archidekt-sync';

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

test('preconReleaseDate: takes the date from Archidekt createdAt', () => {
  assertEqual(preconReleaseDate({ createdAt: '2023-04-06T12:30:00.123456Z' }), '2023-04-06', 'date');
});

test('isAfterPreconCutoff: keeps March of the Machine Commander and later', () => {
  // Dates as Archidekt_Precons lists them.
  assertEqual(isAfterPreconCutoff({ createdAt: '2023-04-06T00:00:00Z' }), true, 'March of the Machine');
  assertEqual(isAfterPreconCutoff({ createdAt: '2026-10-28T20:09:02Z' }), true, 'Star Trek');
  assertEqual(isAfterPreconCutoff({ createdAt: `${PRECON_CUTOFF_DATE}T00:00:00Z` }), true, 'cutoff day');
});

test('isAfterPreconCutoff: drops precons released before March of the Machine', () => {
  assertEqual(isAfterPreconCutoff({ createdAt: '2023-01-27T00:00:00Z' }), false, 'Phyrexia: All Will Be One');
  assertEqual(isAfterPreconCutoff({ createdAt: '2021-12-30T00:00:00Z' }), false, 'Commander 2011');
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\nPassed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);
if (failed > 0) process.exit(1);
