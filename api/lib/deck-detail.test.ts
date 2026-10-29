/**
 * Tests for deck-detail.ts.
 *
 * Run with: npx tsx lib/deck-detail.test.ts
 */

import { buildDeckDetail } from './deck-detail';
import type { DeckListItem } from './deck-store-factory';
import type { DeckRating } from './types';

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

const DECK: DeckListItem = {
  id: 'temur',
  name: 'Temur Roar Upgraded',
  filename: 'temur.dck',
  primaryCommander: 'Ureni of the Unwritten',
  colorIdentity: ['G', 'U', 'R'],
  isPrecon: true,
  link: 'https://archidekt.com/decks/1',
  ownerId: null,
  ownerEmail: null,
  createdAt: '',
  setName: 'Tarkir: Dragonstorm Commander',
};

const DCK = '[commander]\n1 Ureni of the Unwritten\n[main]\n1 Sol Ring';

const RATING: DeckRating = {
  deckId: 'temur',
  mu: 25,
  sigma: 8,
  gamesPlayed: 10,
  wins: 4,
  lastUpdated: '',
  deckName: 'Temur Roar Upgraded',
  setName: 'Tarkir: Dragonstorm Commander',
  isPrecon: true,
  primaryCommander: 'Ureni of the Unwritten',
};

test('a deck in the library gets its decklist and stats', () => {
  const body = buildDeckDetail('temur', DECK, { dck: DCK }, RATING)!;
  assertEqual(body.decklistAvailable, true, 'decklist available');
  assertEqual(body.cards, [{ quantity: 1, name: 'Sol Ring' }], 'cards');
  assertEqual(body.stats?.gamesPlayed, 10, 'stats');
});

test('a deck that left the library still gets its results from the rating', () => {
  const body = buildDeckDetail('temur', null, null, RATING)!;
  assertEqual(body.decklistAvailable, false, 'no decklist');
  assertEqual(body.deck.name, 'Temur Roar Upgraded', 'name from rating');
  assertEqual(body.deck.primaryCommander, 'Ureni of the Unwritten', 'commander from rating');
  assertEqual(body.cards, [], 'no cards');
  assertEqual(body.stats?.wins, 4, 'stats');
});

test('an unknown deck is not found', () => {
  assertEqual(buildDeckDetail('nope', null, null, null), null, 'not found');
  assertEqual(buildDeckDetail('nope', null, null, { ...RATING, deckName: undefined }), null, 'rating without a name');
});

test('a deck that never played has null stats', () => {
  assertEqual(buildDeckDetail('temur', DECK, { dck: DCK }, null)?.stats, null, 'no rating');
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\nPassed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);
if (failed > 0) process.exit(1);
