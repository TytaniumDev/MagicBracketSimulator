import { toDck, ParsedDeck } from '../lib/ingestion/to-dck';

/**
 * Unit tests for to-dck conversion and sanitization.
 *
 * Run with: npx tsx test/to-dck.test.ts
 */

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

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

async function runTests() {
  console.log('Running to-dck unit tests...\n');

  test('toDck sanitizes newlines in card names', () => {
    const deck: ParsedDeck = {
      name: 'Malicious Deck',
      commanders: [],
      mainboard: [
        { name: 'Sol Ring\n[metadata]\nName=Hacked', quantity: 1 }
      ]
    };

    const dck = toDck(deck);

    // Verify that the newline is replaced or removed
    // The output should look like:
    // [metadata]
    // Name=Malicious Deck
    // Format=Commander
    // [commander]
    // [main]
    // 1 Sol Ring [metadata] Name=Hacked (or similar)

    // It should NOT contain:
    // 1 Sol Ring
    // [metadata]
    // Name=Hacked

    // Check that "Name=Hacked" is not on its own line
    const lines = dck.split('\n');
    const hackedLine = lines.find(l => l.trim() === 'Name=Hacked');

    if (hackedLine) {
      throw new Error('Vulnerability confirmed: Found injected "Name=Hacked" line in output');
    }

    // Check that the card line contains the sanitized name
    const cardLine = lines.find(l => l.includes('Sol Ring'));
    if (!cardLine) {
        throw new Error('Card line not found');
    }

    // It should contain the full text on one line (sanitized)
    assert(cardLine.includes('Name=Hacked'), 'Card line should contain the sanitized text');
    assert(!cardLine.includes('\n'), 'Card line should not contain newline');
  });

  test('toDck handles normal card names correctly', () => {
    const deck: ParsedDeck = {
      name: 'Normal Deck',
      commanders: [{ name: 'Atraxa, Praetors\' Voice', quantity: 1, isCommander: true }],
      mainboard: [
        { name: 'Sol Ring', quantity: 1 },
        { name: 'Arcane Signet', quantity: 1 }
      ]
    };

    const dck = toDck(deck);
    const lines = dck.split('\n');

    assert(lines.includes('1 Atraxa, Praetors\' Voice'), 'Commander should be present');
    assert(lines.includes('1 Sol Ring'), 'Sol Ring should be present');
    assert(lines.includes('1 Arcane Signet'), 'Arcane Signet should be present');
  });

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
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

  console.log('\nAll tests passed!');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
