/**
 * Tests for dck-cards.ts.
 *
 * Run with: npx tsx lib/dck-cards.test.ts
 */

import { parseDckCards } from './dck-cards';

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
  if (a !== e) {
    throw new Error(`${message}: expected ${e}, got ${a}`);
  }
}

const SAMPLE = [
  '[metadata]',
  'Name=Temur Roar Upgraded',
  'Format=Commander',
  '[commander]',
  '1 Ureni of the Unwritten',
  '[main]',
  '1 Sol Ring|C21|263',
  '10 Forest',
  '',
  '1 Fire // Ice',
  '[sideboard]',
  '1 Lightning Bolt',
].join('\n');

test('splits commanders from the main deck', () => {
  const { commanders, main } = parseDckCards(SAMPLE);
  assertEqual(commanders, [{ quantity: 1, name: 'Ureni of the Unwritten' }], 'commanders');
  assertEqual(main.map((c) => c.name), ['Sol Ring', 'Forest', 'Fire // Ice'], 'main names');
});

test('strips set and collector suffix and keeps quantities', () => {
  const { main } = parseDckCards(SAMPLE);
  assertEqual(main[0], { quantity: 1, name: 'Sol Ring' }, 'Sol Ring');
  assertEqual(main[1], { quantity: 10, name: 'Forest' }, 'Forest');
});

test('ignores metadata and sideboard lines', () => {
  const { main } = parseDckCards(SAMPLE);
  assertEqual(main.some((c) => c.name === 'Lightning Bolt'), false, 'sideboard excluded');
});

test('handles CRLF, mixed-case headers and "1x" quantities', () => {
  const dck = '[Commander]\r\n1x Atraxa, Praetors\' Voice\r\n[MAIN]\r\n2x Island\r\n';
  const { commanders, main } = parseDckCards(dck);
  assertEqual(commanders, [{ quantity: 1, name: "Atraxa, Praetors' Voice" }], 'commander');
  assertEqual(main, [{ quantity: 2, name: 'Island' }], 'main');
});

test('returns empty lists for content without card sections', () => {
  assertEqual(parseDckCards('[metadata]\nName=Empty'), { commanders: [], main: [] }, 'empty');
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\nPassed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);
if (failed > 0) process.exit(1);
