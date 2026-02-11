/**
 * Unit tests for deck ingestion (ManaBox URL detection and extraction).
 *
 * Run with: npx tsx test/ingestion.test.ts
 */

import { isManaboxUrl, isMoxfieldUrl, isArchidektUrl, toDck } from '../lib/ingestion';
import { extractManaboxDeckId } from '../lib/ingestion/manabox';

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
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function runTests() {
  console.log('Running ingestion unit tests...\n');

  // -------------------------------------------------------------------------
  // ManaBox URL detection
  // -------------------------------------------------------------------------

  test('isManaboxUrl accepts https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA', () => {
    assert(isManaboxUrl('https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA'), 'Expected true');
  });

  test('isManaboxUrl accepts www.manabox.app', () => {
    assert(isManaboxUrl('https://www.manabox.app/decks/abc123'), 'Expected true');
  });

  test('isManaboxUrl accepts http', () => {
    assert(isManaboxUrl('http://manabox.app/decks/xyz_123'), 'Expected true');
  });

  test('isManaboxUrl rejects Moxfield URL', () => {
    assert(!isManaboxUrl('https://moxfield.com/decks/abc123'), 'Expected false');
  });

  test('isManaboxUrl rejects Archidekt URL', () => {
    assert(!isManaboxUrl('https://archidekt.com/decks/123456'), 'Expected false');
  });

  test('isManaboxUrl rejects invalid URL', () => {
    assert(!isManaboxUrl('https://example.com/other'), 'Expected false');
  });

  // -------------------------------------------------------------------------
  // ManaBox deck ID extraction
  // -------------------------------------------------------------------------

  test('extractManaboxDeckId extracts deck ID', () => {
    const id = extractManaboxDeckId('https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA');
    assertEqual(id, 'iB_rScEtT_6hnOlPUUQ-vA', 'deck ID');
  });

  test('extractManaboxDeckId returns null for non-ManaBox URL', () => {
    assertEqual(extractManaboxDeckId('https://moxfield.com/decks/abc'), null, 'should be null');
  });

  // -------------------------------------------------------------------------
  // Moxfield/Archidekt still work (regression)
  // -------------------------------------------------------------------------

  test('isMoxfieldUrl accepts Moxfield URL', () => {
    assert(isMoxfieldUrl('https://moxfield.com/decks/abc123'), 'Expected true');
  });

  test('isArchidektUrl accepts Archidekt URL', () => {
    assert(isArchidektUrl('https://archidekt.com/decks/123456'), 'Expected true');
  });

  // -------------------------------------------------------------------------
  // Security Checks (File Format Injection)
  // -------------------------------------------------------------------------

  test('toDck sanitizes newlines in deck name', () => {
    const maliciousDeck = {
      name: 'Normal Name\n[metadata]\nInjected=True',
      commanders: [{ name: 'Sol Ring', quantity: 1, isCommander: true }],
      mainboard: [{ name: 'Forest', quantity: 99 }]
    };
    const output = toDck(maliciousDeck);

    // Check that newlines are replaced with spaces
    assert(output.includes('Name=Normal Name [metadata] Injected=True'), 'Name should be sanitized');
    // Ensure injection didn't create a new line
    const injectedKeyRegex = /^Injected=True/m;
    assert(!injectedKeyRegex.test(output), 'Deck name should not allow newline injection');
  });

  test('toDck sanitizes newlines in card names', () => {
    const maliciousDeck = {
      name: 'Normal Name',
      commanders: [{ name: 'Sol Ring\nInjectedCard', quantity: 1, isCommander: true }],
      mainboard: [{ name: 'Forest', quantity: 99 }]
    };
    const output = toDck(maliciousDeck);

    // Check that newlines are replaced with spaces
    assert(output.includes('1 Sol Ring InjectedCard'), 'Card name should be sanitized');
    // Ensure injection didn't create a new line
    const injectedCardRegex = /^InjectedCard/m;
    assert(!injectedCardRegex.test(output), 'Card name should not allow newline injection');
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

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
