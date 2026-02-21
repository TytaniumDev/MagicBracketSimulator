/**
 * Tests for deck name matching utilities.
 *
 * Regression tests using real data from job bI9EDRyCU3GJDVBqM2Vi where
 * precon decks with set suffixes (e.g. "Blood Rites - The Lost Caverns of
 * Ixalan Commander") were not matched by the old endsWith('-ShortName') logic.
 *
 * Run with: npx tsx lib/condenser/deck-match.test.ts
 */

import { matchesDeckName, resolveWinnerName } from './deck-match';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`\u2713 ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`\u2717 ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running deck-match tests...\n');

  // =========================================================================
  // matchesDeckName — basic cases
  // =========================================================================

  await test('exact match', () => {
    assert(matchesDeckName('Blood Rites', 'Blood Rites'), 'exact should match');
  });

  await test('Ai-prefixed endsWith match (no set suffix)', () => {
    assert(matchesDeckName('Ai(1)-Doran Big Butts', 'Doran Big Butts'), 'Ai prefix endsWith');
  });

  await test('no match for unrelated names', () => {
    assert(!matchesDeckName('Ai(1)-Doran Big Butts', 'Blood Rites'), 'should not match');
  });

  await test('no match for partial name collision', () => {
    // "Blood" is a prefix of "Blood Rites" but not followed by " - "
    assert(!matchesDeckName('Ai(2)-Blood Rites - The Lost Caverns', 'Blood'), 'partial should not match');
  });

  await test('no match when short name is substring in middle', () => {
    assert(!matchesDeckName('Ai(2)-The Blood Rites Deck', 'Blood Rites'), 'substring should not match');
  });

  // =========================================================================
  // matchesDeckName — precon set suffix (the bug regression)
  // =========================================================================

  await test('precon: Blood Rites - The Lost Caverns of Ixalan Commander', () => {
    assert(
      matchesDeckName('Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander', 'Blood Rites'),
      'Blood Rites precon should match'
    );
  });

  await test('precon: Counter Blitz - Final Fantasy Commander', () => {
    assert(
      matchesDeckName('Ai(3)-Counter Blitz - Final Fantasy Commander', 'Counter Blitz'),
      'Counter Blitz precon should match'
    );
  });

  await test('precon: World Shaper - Edge of Eternities Commander Deck', () => {
    assert(
      matchesDeckName('Ai(4)-World Shaper - Edge of Eternities Commander Deck', 'World Shaper'),
      'World Shaper precon should match'
    );
  });

  await test('precon: Doran Big Butts (custom, no set suffix)', () => {
    assert(
      matchesDeckName('Ai(1)-Doran Big Butts', 'Doran Big Butts'),
      'Doran Big Butts should match via endsWith'
    );
  });

  // =========================================================================
  // matchesDeckName — hyphenated deck names
  // =========================================================================

  await test('hyphenated deck name matches via endsWith', () => {
    assert(
      matchesDeckName('Ai(1)-Some-Hyphenated-Name', 'Some-Hyphenated-Name'),
      'hyphenated name should match'
    );
  });

  await test('hyphenated deck name with set suffix matches via startsWith', () => {
    assert(
      matchesDeckName('Ai(1)-Veloci-RAMP-Tor - Jurassic World Collection', 'Veloci-RAMP-Tor'),
      'hyphenated precon should match'
    );
  });

  // =========================================================================
  // resolveWinnerName
  // =========================================================================

  const deckNames = ['Doran Big Butts', 'Blood Rites', 'Counter Blitz', 'World Shaper'];

  await test('resolveWinnerName: exact match', () => {
    assertEqual(resolveWinnerName('Blood Rites', deckNames), 'Blood Rites', 'exact');
  });

  await test('resolveWinnerName: Ai-prefixed', () => {
    assertEqual(
      resolveWinnerName('Ai(1)-Doran Big Butts', deckNames),
      'Doran Big Butts',
      'Ai prefix'
    );
  });

  await test('resolveWinnerName: precon with set suffix', () => {
    assertEqual(
      resolveWinnerName('Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander', deckNames),
      'Blood Rites',
      'precon set suffix'
    );
  });

  await test('resolveWinnerName: unrecognized returns original', () => {
    assertEqual(
      resolveWinnerName('Ai(5)-Unknown Deck', deckNames),
      'Ai(5)-Unknown Deck',
      'no match returns original'
    );
  });

  // =========================================================================
  // Full tally regression with sample sim data from job bI9EDRyCU3GJDVBqM2Vi
  // =========================================================================

  await test('full tally regression: all 4 decks get correct win counts', () => {
    const names = ['Doran Big Butts', 'Blood Rites', 'Counter Blitz', 'World Shaper'];
    // Simulated winner strings as they appear in Forge logs
    const winners = [
      'Ai(1)-Doran Big Butts',
      'Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander',
      'Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander',
      'Ai(3)-Counter Blitz - Final Fantasy Commander',
      'Ai(1)-Doran Big Butts',
      'Ai(4)-World Shaper - Edge of Eternities Commander Deck',
      'Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander',
      'Ai(1)-Doran Big Butts',
    ];

    const tally: Record<string, number> = {};
    for (const name of names) tally[name] = 0;

    for (const w of winners) {
      const matched = resolveWinnerName(w, names);
      tally[matched] = (tally[matched] ?? 0) + 1;
    }

    assertEqual(tally['Doran Big Butts'], 3, 'Doran wins');
    assertEqual(tally['Blood Rites'], 3, 'Blood Rites wins');
    assertEqual(tally['Counter Blitz'], 1, 'Counter Blitz wins');
    assertEqual(tally['World Shaper'], 1, 'World Shaper wins');

    // Verify no unknown keys leaked in
    const totalWins = Object.values(tally).reduce((s, n) => s + n, 0);
    assertEqual(totalWins, winners.length, 'total wins should equal winners array length');
  });

  // =========================================================================
  // Summary
  // =========================================================================

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
