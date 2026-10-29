/**
 * Tests for card-impact/parse.ts and card-impact/stats.ts.
 *
 * Run with: npx tsx lib/card-impact/card-impact.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseGameCards, type GameCardSummary } from './parse';
import { addGame, emptyDeckCardStats, scoreCards } from './stats';
import { splitConcatenatedGames } from '../condenser/patterns';

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
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

function assertClose(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const TEMUR = 'Ai(1)-Temur Roar Upgraded';
const DORAN = 'Ai(2)-Doran Big Butts';

const forge215 = fs.readFileSync(path.join(__dirname, 'fixtures', 'forge-2.0.15-game.txt'), 'utf-8');
const forge210 = splitConcatenatedGames(
  fs.readFileSync(path.join(__dirname, '..', 'condenser', 'fixtures', 'real-4game-log.txt'), 'utf-8'),
);

// ---------------------------------------------------------------------------
// parseGameCards
// ---------------------------------------------------------------------------

test('parse (2.0.15): winner and turns taken', () => {
  const game = parseGameCards(forge215);
  assertEqual(game.winner, TEMUR, 'winner');
  assertEqual(game.turnsTaken[TEMUR], 10, 'Temur turns');
});

test('parse (2.0.15): first cast turn comes from the caster\'s own turn count', () => {
  const game = parseGameCards(forge215);
  const ureni = game.plays.find((p) => p.player === TEMUR && p.name === 'Ureni of the Unwritten');
  assert(ureni !== undefined, 'Ureni should be a play');
  assertEqual(ureni!.turn, 6, 'Ureni cast turn');
});

test('parse (2.0.15): damage to players is credited by card id', () => {
  const game = parseGameCards(forge215);
  const ureni = game.plays.find((p) => p.name === 'Ureni of the Unwritten')!;
  assertEqual(ureni.damageToPlayers, 69, 'Ureni damage');
});

test('parse (2.0.15): leaving the battlefield and opponent targeting are tracked', () => {
  const game = parseGameCards(forge215);
  const miirym = game.plays.find((p) => p.name === 'Miirym, Sentinel Wyrm')!;
  assertEqual(miirym.leftBattlefield, true, 'Miirym left the battlefield');
  assertEqual(miirym.targetedByOpponents, 1, 'Generous Gift targeted Miirym');
  const sarkhan = game.plays.find((p) => p.name === 'Sarkhan, Soul Aflame')!;
  assertEqual(sarkhan.leftBattlefield, false, 'Sarkhan stayed');
});

test('parse (2.0.15): lands count as plays', () => {
  const game = parseGameCards(forge215);
  assert(game.plays.some((p) => p.player === TEMUR && p.name === 'Ketria Triome'), 'Ketria Triome played');
});

test('parse (2.0.10): lowercase captions and ids on cast lines', () => {
  const game = parseGameCards(forge210[0]);
  assertEqual(game.winner, 'Ai(3)-Explorers of the Deep', 'winner');
  const doran = game.plays.find((p) => p.player === 'Ai(1)-Doran Big Butts' && p.name === 'Doran, Besieged by Time');
  assert(doran !== undefined, 'Doran cast');
  assertEqual(doran!.turn, 3, 'Doran cast turn');
  assertEqual(doran!.damageToPlayers, 10, 'Doran damage');
});

test('parse: a recast commander counts once, at its first cast', () => {
  const log = [
    `Turn: Turn 1 (${TEMUR})`,
    `Turn: Turn 2 (${DORAN})`,
    `Turn: Turn 3 (${TEMUR})`,
    `Add To Stack: ${TEMUR} cast Ureni of the Unwritten`,
    `Turn: Turn 4 (${DORAN})`,
    `Turn: Turn 5 (${TEMUR})`,
    `Add To Stack: ${TEMUR} cast Ureni of the Unwritten`,
  ].join('\n');
  const plays = parseGameCards(log).plays.filter((p) => p.name === 'Ureni of the Unwritten');
  assertEqual(plays.length, 1, 'one play');
  assertEqual(plays[0].turn, 2, 'first cast on Temur\'s 2nd turn');
});

test('parse: damage from a card both players cast is credited by attacker id', () => {
  const log = [
    `Turn: Turn 1 (${TEMUR})`,
    `Add To Stack: ${TEMUR} cast Sol Ring`,
    `Add To Stack: ${TEMUR} cast Grizzly Bears`,
    `Turn: Turn 2 (${DORAN})`,
    `Add To Stack: ${DORAN} cast Grizzly Bears`,
    `Turn: Turn 3 (${TEMUR})`,
    `Combat: ${TEMUR} assigned Grizzly Bears (7) to attack ${DORAN}.`,
    `Damage: Grizzly Bears (7) deals 2 combat damage to ${DORAN}.`,
  ].join('\n');
  const bears = parseGameCards(log).plays.filter((p) => p.name === 'Grizzly Bears');
  assertEqual(bears.find((p) => p.player === TEMUR)!.damageToPlayers, 2, 'Temur bears');
  assertEqual(bears.find((p) => p.player === DORAN)!.damageToPlayers, 0, 'Doran bears');
});

// ---------------------------------------------------------------------------
// addGame / scoreCards
// ---------------------------------------------------------------------------

function game(winner: string | null, turns: number, plays: { name: string; turn: number }[]): GameCardSummary {
  return {
    winner,
    turnsTaken: { [TEMUR]: turns, [DORAN]: turns },
    plays: plays.map((p) => ({
      player: TEMUR,
      name: p.name,
      turn: p.turn,
      damageToPlayers: 0,
      leftBattlefield: false,
      targetedByOpponents: 0,
    })),
  };
}

test('addGame: counts the deck baseline for every turn it reached', () => {
  const stats = addGame(emptyDeckCardStats(), game(TEMUR, 3, []), TEMUR);
  assertEqual(stats.games, 1, 'games');
  assertEqual(stats.aliveAt.slice(0, 4), [1, 1, 1, 0], 'alive at turns 1..4');
  assertEqual(stats.closesFromAlive.slice(0, 3), [1, 1, 1], 'a turn-3 win is within 3 turns of turns 1..3');
});

test('addGame: ignores plays from other seats', () => {
  const g = game(TEMUR, 5, [{ name: 'Sol Ring', turn: 1 }]);
  const stats = addGame(emptyDeckCardStats(), g, DORAN);
  assertEqual(Object.keys(stats.cards).length, 0, 'no cards for Doran');
  assertEqual(stats.wins, 0, 'Doran lost');
});

test('scoreCards: a card cast right before every win has positive close lift', () => {
  let stats = emptyDeckCardStats();
  // Two wins on turn 8 right after casting Bomb on turn 7; two slow losses without it.
  stats = addGame(stats, game(TEMUR, 8, [{ name: 'Bomb', turn: 7 }, { name: 'Filler', turn: 2 }]), TEMUR);
  stats = addGame(stats, game(TEMUR, 8, [{ name: 'Bomb', turn: 7 }, { name: 'Filler', turn: 2 }]), TEMUR);
  stats = addGame(stats, game(DORAN, 12, [{ name: 'Filler', turn: 2 }]), TEMUR);
  stats = addGame(stats, game(DORAN, 12, [{ name: 'Filler', turn: 2 }]), TEMUR);

  const scores = scoreCards(stats);
  assertEqual(scores[0].name, 'Bomb', 'Bomb ranks first');
  // Turn 7: deck alive in 4 games, closed in 2 → baseline 0.5; Bomb closed 2 of 2 → +0.5.
  assertClose(scores[0].closeLift, 0.5, 'Bomb close lift');
  // Filler is cast in every game, so it matches the baseline exactly.
  const filler = scores.find((s) => s.name === 'Filler')!;
  assertClose(filler.winLift, 0, 'Filler win lift');
  assertClose(filler.castRate, 1, 'Filler cast rate');
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`\nPassed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);
if (failed > 0) process.exit(1);
