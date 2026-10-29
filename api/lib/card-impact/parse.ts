/**
 * Extract per-card events from one Forge game log, for card impact stats.
 *
 * Reads the lines that tie a card to its controller and to what it did:
 *   Turn: Turn 5 (Ai(1)-Temur Roar Upgraded)
 *   Add To Stack: Ai(1)-Temur Roar Upgraded cast Miirym, Sentinel Wyrm
 *   Add To Stack: Ai(1)-Temur Roar Upgraded triggered Karakyk Guardian
 *   Add To Stack: Ai(2)-Doran cast Generous Gift targeting [Miirym, Sentinel Wyrm (1)]
 *   Land: Ai(1)-Temur Roar Upgraded played Ketria Triome (20)
 *   Combat: Ai(1)-Temur Roar Upgraded assigned Miirym, Sentinel Wyrm (1) to attack Ai(4)-...
 *   Damage: Miirym, Sentinel Wyrm (1) deals 6 combat damage to Ai(4)-Cavalry Charge Upgraded.
 *   Zone Change: Miirym, Sentinel Wyrm (1) was put into Graveyard from Battlefield.
 *
 * Captions changed case between Forge versions ("Add to stack" in 2.0.10,
 * "Add To Stack" in 2.0.12+), so every caption match is case-insensitive.
 * Forge 2.0.10 also put the card id on cast lines; 2.0.12+ doesn't, so
 * ids are learned from whichever lines carry them. Zone changes only
 * appear in Forge 2.0.11+.
 *
 * Cards can reach the battlefield without being cast (Ureni of the Unwritten
 * puts Dragons straight onto it, and Forge logs no zone change for that), so
 * a card also counts as played the first time it triggers, activates or
 * attacks. Tokens are skipped, since they aren't cards in the deck, and so
 * are cards another player already played (stolen ones).
 */
import { extractWinner } from '../condenser/turns';

/** First time a player cast, played or used a card in one game, and what it did after. */
export interface CardPlay {
  /** Forge player label, e.g. "Ai(1)-Temur Roar Upgraded". */
  player: string;
  name: string;
  /** The player's own turn count when it was first cast, played or used (1-based). */
  turn: number;
  /** Damage this card dealt to players (any player, which in practice means opponents). */
  damageToPlayers: number;
  /** True once it went from the battlefield to a graveyard or exile. */
  leftBattlefield: boolean;
  /** Spells cast by other players that targeted it. */
  targetedByOpponents: number;
}

export interface GameCardSummary {
  winner: string | null;
  /** Turns each player took in this game. */
  turnsTaken: Record<string, number>;
  plays: CardPlay[];
}

const TURN_LINE = /^Turn: Turn \d+ \((.+)\)\s*$/i;
const STACK_LINE = /^Add to stack: (.+)$/i;
/** What follows the player on an "Add To Stack" line. */
const STACK_ACTION = /^(cast|triggered|activated) (.+)$/i;
const TOKEN_NAME = /\bToken$/i;
const LAND_LINE = /^Land: (.+?) played (.+?) \((\d+)\)\s*$/i;
const ATTACK_LINE = /^Combat: (.+?) assigned (.+) to attack /i;
const DAMAGE_LINE = /^Damage: (.+?) \((\d+)\) deals (\d+) (?:combat )?damage to (.+?)\.?\s*$/i;
const LEFT_BATTLEFIELD_LINE = /^Zone Change: (.+?) \((\d+)\) was put into (?:Graveyard|Exile) from Battlefield/i;
/** "Name (12)" items in a list like "A, B (1), C (2) and D (3)". */
const CARD_REF = /\s*(?:and\s+)?(.+?) \((\d+)\),?/g;
const TRAILING_ID = /^(.*?) \((\d+)\)$/;

function parseCardRefs(list: string): { name: string; id: string }[] {
  return [...list.matchAll(CARD_REF)].map((m) => ({ name: m[1].trim(), id: m[2] }));
}

/** Split "Card Name (12)" into name and id; the id is optional. */
function splitTrailingId(text: string): { name: string; id: string | null } {
  const match = TRAILING_ID.exec(text.trim());
  return match ? { name: match[1], id: match[2] } : { name: text.trim(), id: null };
}

function findPlayers(lines: string[]): string[] {
  const players = new Set<string>();
  for (const line of lines) {
    const match = TURN_LINE.exec(line);
    if (match) players.add(match[1].trim());
  }
  // Longest first, so a player whose label prefixes another's can't steal its lines.
  return [...players].sort((a, b) => b.length - a.length);
}

export function parseGameCards(gameLog: string): GameCardSummary {
  const lines = gameLog.replace(/\r\n?/g, '\n').split('\n');
  const players = findPlayers(lines);
  const playerSet = new Set(players);
  const lineOwner = (text: string) => players.find((p) => text.startsWith(p + ' ')) ?? null;

  const turnsTaken: Record<string, number> = {};
  for (const p of players) turnsTaken[p] = 0;

  const plays = new Map<string, CardPlay>();
  const idOwner = new Map<string, string>();
  const nameOwners = new Map<string, Set<string>>();
  const playKey = (player: string, name: string) => `${player}\u0000${name}`;

  const recordPlay = (player: string, name: string, id: string | null) => {
    if (id) idOwner.set(id, player);
    const owners = nameOwners.get(name) ?? new Set<string>();
    owners.add(player);
    nameOwners.set(name, owners);
    const key = playKey(player, name);
    if (!plays.has(key)) {
      plays.set(key, {
        player,
        name,
        turn: Math.max(1, turnsTaken[player] ?? 0),
        damageToPlayers: 0,
        leftBattlefield: false,
        targetedByOpponents: 0,
      });
    }
  };

  /**
   * Record a card first seen through a trigger, activation or attack rather
   * than a cast. A card another player already played is theirs (it was
   * stolen, e.g. by Mark of Mutiny), so its damage stays credited to them.
   */
  const recordSeen = (player: string, name: string, id: string | null) => {
    if (TOKEN_NAME.test(name)) return;
    const knownOwner = id ? idOwner.get(id) : undefined;
    if (knownOwner && knownOwner !== player) return;
    const owners = nameOwners.get(name);
    if (!knownOwner && owners && !owners.has(player)) return;
    recordPlay(player, name, id);
  };

  /** Which player's play a card reference belongs to: by id, else by a name only one player cast. */
  const playFor = (name: string, id: string | null): CardPlay | undefined => {
    let owner = id ? idOwner.get(id) : undefined;
    if (!owner) {
      const owners = nameOwners.get(name);
      if (owners?.size === 1) owner = [...owners][0];
    }
    return owner ? plays.get(playKey(owner, name)) : undefined;
  };

  for (const raw of lines) {
    const line = raw.trim();
    let match: RegExpExecArray | null;

    if ((match = TURN_LINE.exec(line))) {
      const player = match[1].trim();
      turnsTaken[player] = (turnsTaken[player] ?? 0) + 1;
      continue;
    }

    if ((match = STACK_LINE.exec(line))) {
      const rest = match[1].trim();
      const caster = lineOwner(rest);
      const action = caster ? STACK_ACTION.exec(rest.slice(caster.length + 1)) : null;
      if (!caster || !action) continue;
      const [spell, targets] = action[2].split(' targeting [');
      const { name, id } = splitTrailingId(spell);
      if (action[1].toLowerCase() === 'cast') recordPlay(caster, name, id);
      else recordSeen(caster, name, id);
      for (const target of parseCardRefs(targets ?? '')) {
        const targetPlay = playFor(target.name, target.id);
        if (targetPlay && targetPlay.player !== caster) targetPlay.targetedByOpponents++;
      }
      continue;
    }

    if ((match = LAND_LINE.exec(line))) {
      const player = lineOwner(match[0].slice(match[0].indexOf(':') + 1).trim());
      if (player) recordPlay(player, match[2].trim(), match[3]);
      continue;
    }

    if ((match = ATTACK_LINE.exec(line))) {
      const attacker = match[1].trim();
      if (!playerSet.has(attacker)) continue;
      for (const ref of parseCardRefs(match[2])) {
        recordSeen(attacker, ref.name, ref.id);
      }
      continue;
    }

    if ((match = DAMAGE_LINE.exec(line))) {
      const target = match[4].trim();
      if (!playerSet.has(target)) continue;
      const play = playFor(match[1].trim(), match[2]);
      if (play) play.damageToPlayers += parseInt(match[3], 10);
      continue;
    }

    if ((match = LEFT_BATTLEFIELD_LINE.exec(line))) {
      const play = playFor(match[1].trim(), match[2]);
      if (play) play.leftBattlefield = true;
    }
  }

  const winnerText = extractWinner(gameLog);
  const winner = winnerText ? players.find((p) => winnerText.startsWith(p)) ?? null : null;

  return { winner, turnsTaken, plays: [...plays.values()] };
}
