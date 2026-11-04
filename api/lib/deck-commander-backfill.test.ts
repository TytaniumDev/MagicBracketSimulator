/**
 * Tests for commanderFixes, the decks the commander backfill updates.
 *
 * Run with: npx tsx lib/deck-commander-backfill.test.ts
 */
import { commanderFixes } from './deck-commander-backfill';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}\n  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const withCommander = '[metadata]\nName=Deck\n[commander]\n1 Atraxa, Praetors\' Voice|C16|28\n[main]\n1 Sol Ring\n';

test('a deck missing its commander gets the one in its .dck', () => {
  assertEqual(
    commanderFixes([
      { id: 'a', name: 'A', dck: withCommander },
      { id: 'b', name: 'B', dck: withCommander, primaryCommander: null },
    ]),
    [
      { id: 'a', name: 'A', primaryCommander: 'Atraxa, Praetors\' Voice' },
      { id: 'b', name: 'B', primaryCommander: 'Atraxa, Praetors\' Voice' },
    ],
    'fixes',
  );
});

test('a deck that already names its commander is left alone', () => {
  assertEqual(commanderFixes([{ id: 'a', name: 'A', dck: withCommander, primaryCommander: 'Atraxa, Praetors\' Voice' }]), [], 'fixes');
});

test('a deck with no commander section is left alone', () => {
  assertEqual(commanderFixes([{ id: 'a', name: 'A', dck: '[main]\n1 Sol Ring\n' }]), [], 'fixes');
});

if (failed > 0) process.exit(1);
console.log('\nAll tests passed!');
