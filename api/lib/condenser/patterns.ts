/**
 * =============================================================================
 * Forge Log Analyzer - Pattern Definitions
 * =============================================================================
 *
 * This file contains all regex patterns used to parse Forge game logs.
 *
 * ## Forge Log Format Overview
 *
 * Forge outputs game logs in a text format where:
 *   - Turns are marked at the start of a line (two known formats)
 *   - Actions are listed line by line under each turn
 *   - Each line typically describes one game action
 *
 * ### Format 1 (older):
 * ```
 * Turn 1: Player A
 * Player A plays Forest.
 * Player A passes priority.
 * Turn 1: Player B
 * Player B plays Island.
 * Turn 2: Player A
 * Player A casts Sol Ring (CMC 1).
 * ```
 *
 * ### Format 2 (current):
 * ```
 * Turn: Turn 1 (Ai(4)-Draconic Dissent)
 * Phase: Ai(4)-Draconic Dissent's Untap step
 * Land: Ai(4)-Draconic Dissent played Island
 * Turn: Turn 2 (Ai(1)-Doran Big Butts)
 * Phase: Ai(1)-Doran Big Butts' Untap step
 * ```
 *
 * ## Pattern Categories
 *
 * 1. IGNORE patterns: Lines we filter out (noise that doesn't help analysis)
 * 2. KEEP patterns: Lines we keep (significant game events)
 * 3. EXTRACTION patterns: Used to extract metadata (turn numbers, players)
 *
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// SECTION 1: PATTERNS TO IGNORE (Noise Filtering)
// -----------------------------------------------------------------------------
// These patterns match lines that don't provide useful information for
// power-level analysis. We filter these out to reduce log size.

/**
 * Pattern: "Player passes priority"
 *
 * Why ignore: Priority passes happen dozens of times per turn and don't
 * indicate anything about deck power level. This is the biggest source
 * of log bloat.
 *
 * Forge example: "Player A passes priority."
 */
export const IGNORE_PRIORITY_PASS = /player\s+passes\s+priority/i;

/**
 * Pattern: "Untap step"
 *
 * Why ignore: Every turn has an untap step. It's a phase marker, not an action.
 * We track turns via "Turn N:" lines instead.
 *
 * Forge example: "Untap step."
 */
export const IGNORE_UNTAP_STEP = /untap\s+step/i;

/**
 * Pattern: "Draw step" (basic, without extra draws)
 *
 * Why ignore: Normal draw steps happen every turn. We only care about
 * EXTRA card draw (Rhystic Study triggers, etc.), which is handled
 * separately by KEEP_EXTRA_DRAW.
 *
 * Forge example: "Draw step."
 */
export const IGNORE_DRAW_STEP = /draw\s+step/i;

/**
 * Pattern: Bare "Turn N:" with nothing else
 *
 * Why ignore: These are just turn markers without content. We extract
 * turn information separately; keeping empty turn lines adds noise.
 *
 * Forge example: "Turn 5:\n"
 */
export const IGNORE_BARE_TURN = /^Turn\s+\d+:\s*$/i;

/**
 * All ignore patterns collected for easy iteration.
 */
export const IGNORE_PATTERNS = [
  IGNORE_PRIORITY_PASS,
  IGNORE_UNTAP_STEP,
  IGNORE_DRAW_STEP,
  IGNORE_BARE_TURN,
];

// -----------------------------------------------------------------------------
// SECTION 2: PATTERNS TO KEEP (Significant Events)
// -----------------------------------------------------------------------------
// These patterns match lines that ARE significant for power-level analysis.
// Each pattern targets a specific type of game event.

/**
 * Pattern: Extra card draw (beyond normal draw step)
 *
 * Why keep: Extra card draw indicates card advantage engines, which are
 * a strong signal of deck power. Drawing 2+ cards or "additional" cards
 * suggests Rhystic Study, Consecrated Sphinx, etc.
 *
 * Forge examples:
 *   - "Player A draws 2 cards."
 *   - "Player B draws an additional card."
 *   - "Draw 3 cards."
 *
 * Note: This is checked when a line would otherwise be ignored due to
 * IGNORE_DRAW_STEP. If extra draw is detected, we KEEP the line.
 */
export const KEEP_EXTRA_DRAW = /draw(s)?\s+(an?\s+)?(additional|extra|\d+)\s+card|draw\s+\d+\s+card/i;

/**
 * Pattern: Life total changes
 *
 * Why keep: Life changes indicate damage dealt, life gain, and game pacing.
 * A deck that deals 40+ damage by turn 5 is more powerful than one that
 * chips away slowly.
 *
 * Forge examples:
 *   - "[LIFE] Life: Ai(1)-Doran Big Butts 40 -> 37" (native Forge log)
 *   - "Player A loses 5 life."
 *   - "Player B gains 4 life."
 */
export const KEEP_LIFE_CHANGE = /^\[LIFE\]\s+Life:|life\s+(total\s+)?(change|loss|gain|to)|(\d+)\s+life|loses?\s+\d+\s+life|gains?\s+\d+\s+life/i;

/**
 * Pattern: High mana value spell cast (CMC >= 5)
 *
 * Why keep: Casting expensive spells early indicates strong ramp and
 * powerful cards. A turn-3 Craterhoof is very different from a turn-10
 * Craterhoof.
 *
 * Forge examples:
 *   - "Player A casts Consecrated Sphinx (CMC 6)."
 *   - "casts Expropriate (CMC 9)"
 *   - "CMC 7"
 *
 * Note: We specifically look for CMC values of 5 or higher. CMC 1-4
 * spells are common and less indicative of power level.
 */
export const KEEP_SPELL_HIGH_CMC = /cast(s|ing)?\s+.*?(?:\(?\s*CMC\s*([5-9]|\d{2,})|\(([5-9]|\d{2,})\s*\))|CMC\s*([5-9]|\d{2,})/i;

/**
 * Pattern: Any spell cast (for activity tracking)
 *
 * Why keep (lower priority): Even non-high-CMC casts tell us about
 * deck activity. A deck that casts 5 spells per turn is doing more
 * than one that casts 1.
 *
 * Forge examples:
 *   - "Player A casts Sol Ring."
 *   - "Player B casts Lightning Bolt (CMC 1)."
 */
export const KEEP_SPELL_CAST = /\bcasts?\s+/i;

/**
 * Pattern: Graveyard to battlefield zone change
 *
 * Why keep: Reanimation and recursion are powerful strategies. Moving
 * cards from graveyard to battlefield often indicates combo potential
 * or value engines.
 *
 * Forge examples:
 *   - "Graveyard -> Battlefield"
 *   - "Put target creature from graveyard onto battlefield."
 *   - "graveyard to battlefield"
 */
export const KEEP_ZONE_CHANGE_GY_BF = /graveyard\s*->\s*battlefield|graveyard\s+to\s+battlefield|put.*from.*graveyard.*onto.*battlefield/i;

/**
 * Pattern: Win condition met / game over
 *
 * Why keep: Obviously, we need to know who won and when. This is critical
 * for determining "effective turn count for win" - a key power metric.
 *
 * Forge examples:
 *   - "Player A wins the game."
 *   - "Game Over."
 *   - "Player B wins the match."
 */
export const KEEP_WIN_CONDITION = /wins?\s+the\s+game|game\s+over|winner|wins\s+the\s+match|loses\s+the\s+game/i;

/**
 * Pattern: Commander cast
 *
 * Why keep: In Commander format, casting your commander is significant.
 * Commanders often enable the deck's strategy.
 *
 * Forge examples:
 *   - "Player A casts their commander"
 *   - "casts commander from command zone"
 */
export const KEEP_COMMANDER_CAST = /casts?\s+(their\s+)?commander|from\s+command\s+zone/i;

/**
 * Pattern: Combat actions
 *
 * Why keep: Combat damage is how most games are won. Tracking attacks
 * helps understand the deck's aggression level.
 *
 * Forge examples:
 *   - "Player A attacks with 3 creatures."
 *   - "declares attackers"
 *   - "combat damage"
 *   - "Combat: Ai(3)-Marchesa assigned Warren Soultrader (258) and Skyclave Shadowcat (264) to attack Ai(4)-Explorers of the Deep."
 *   - "Damage: Warren Soultrader (258) deals 3 combat damage to Ai(4)-Explorers of the Deep."
 */
export const KEEP_COMBAT = /attacks?\s+with|declares?\s+attack|combat\s+damage|assigned\s+.*\s+to\s+attack/i;

/**
 * Pattern: Land played
 *
 * Why keep: Land drops indicate mana development and ramp capability.
 * Tracking lands helps understand the deck's curve and consistency.
 *
 * Forge examples:
 *   - "Land: Ai(1)-Doran Big Butts played Forest (41)"
 *   - "Land: Player A played Island"
 */
export const KEEP_LAND_PLAYED = /^Land:/i;

// -----------------------------------------------------------------------------
// SECTION 3: EXTRACTION PATTERNS (Metadata)
// -----------------------------------------------------------------------------
// These patterns extract structured information from lines.

/**
 * Pattern: Turn line with player
 *
 * Used to: Identify turn boundaries and which player is active.
 * Capturing groups:
 *   - Group 1: Turn number (e.g., "5")
 *   - Group 2: Player identifier (e.g., "Player A", "Bob")
 *
 * Forge format: "Turn N: Player X" or "Turn N: X"
 *
 * Note: This is a MULTILINE pattern - ^ matches start of each line.
 */
export const EXTRACT_TURN_LINE = /^Turn\s+(\d+)(?::\s*(.+?)\s*)?$/im;

/**
 * Pattern: Turn number only (for finding all turns in a log)
 *
 * Used to: Build a list of (turn_number, position) for slicing the log
 * into per-turn chunks.
 *
 * Forge formats:
 *   - "Turn N: Player X" (older format)
 *   - "Turn: Turn N (PlayerName)" (current format)
 *
 * We match both by allowing an optional "Turn:" prefix before "Turn N".
 */
export const EXTRACT_TURN_NUMBER = /^Turn:?\s*Turn\s+(\d+)/gim;

/**
 * Pattern: Mana production/usage
 *
 * Used to: Count mana events per turn for the "mana development" metric.
 *
 * Forge examples:
 *   - "adds {G}{G} to mana pool"
 *   - "produces 2 mana"
 *   - "taps for {W}"
 *   - "Tap Sol Ring for 2 mana"
 */
export const EXTRACT_MANA_PRODUCED = /(?:adds?|produces?|tap(s|ped)?\s+for)\s+[\w\s{}\d]*mana|(\d+)\s+mana\s+produced/i;

/**
 * Pattern: Tap for mana (additional mana detection)
 *
 * Used to: Catch "Tap X for Y" patterns that indicate mana production.
 */
export const EXTRACT_TAP_FOR = /tap(s|ped)?\s+.*?\s+for/i;

/**
 * Pattern: Card draw events
 *
 * Used to: Count cards drawn per turn.
 * Capturing group:
 *   - Group 1: Number of cards drawn (if specified, e.g., "3")
 *
 * Forge examples:
 *   - "draws a card" -> 1 card
 *   - "draws 3 cards" -> 3 cards
 */
export const EXTRACT_DRAW_MULTIPLE = /draws?\s+(\d+)\s+cards?/i;
export const EXTRACT_DRAW_SINGLE = /draws?\s+(?:a\s+)?card(?!s)/i;

/**
 * Pattern: CMC extraction from cast lines
 *
 * Used to: Extract the mana value of a cast spell.
 * Capturing group:
 *   - Group 1: The CMC number
 *
 * Forge examples:
 *   - "casts Sol Ring (CMC 1)" -> CMC 1
 *   - "casts Expropriate (9)" -> CMC 9
 */
export const EXTRACT_CMC = /\((?:CMC\s*)?(\d+)\)/i;

/**
 * Pattern: Winner extraction
 *
 * Used to: Identify who won the game.
 * Capturing group:
 *   - Group 1: The winner's name/identifier
 *
 * Forge examples:
 *   - "Player A wins the game." -> "Player A"
 *   - "Ai(3)-Explorers of the Deep has won!" -> "Ai(3)-Explorers of the Deep"
 *   - "Game outcome: Ai(3)-Explorers of the Deep has won because..." -> "Ai(3)-Explorers of the Deep"
 */
export const EXTRACT_WINNER = /(.+?)\s+(?:wins\s+the\s+game|has\s+won!?)(?:\s|$|!|\.)/i;

/**
 * Pattern: Player identifier from turn line
 *
 * Used to: Extract which player is active from turn lines.
 *
 * Forge formats:
 *   - "Turn N: Player X" (older format) → capture group 1
 *   - "Turn: Turn N (PlayerName)" (current format) → capture group 2
 *
 * Note: Player names can contain parentheses (e.g., "Ai(4)-Draconic Dissent"),
 * so we match everything from the opening paren after the turn number up to
 * the last closing paren on the line.
 *
 * The caller should check both capture groups and use the first non-undefined.
 */
export const EXTRACT_ACTIVE_PLAYER = /^Turn\s+\d+:\s*(.+?)\s*$|^Turn:\s*Turn\s+\d+\s*\((.+)\)\s*$/im;

// -----------------------------------------------------------------------------
// SECTION 4: GAME SPLITTING
// -----------------------------------------------------------------------------

/**
 * Pattern: Game Result marker that separates concatenated games.
 *
 * When running multiple games per container, Forge outputs all games
 * back-to-back with a "Game Result: Game N ended..." line between them.
 *
 * Forge example: "Game Result: Game 1 ended in 38105 ms. Ai(3)-Explorers of the Deep has won!"
 */
export const GAME_RESULT_PATTERN = /^Game Result: Game \d+ ended/im;

/**
 * Split a concatenated multi-game log into individual game logs.
 *
 * When running 4 games per container, the stdout is a single concatenated
 * blob. This function splits it by "Game Result: Game N ended..." markers.
 *
 * @param rawLog - The concatenated raw log text
 * @returns Array of individual game log strings (1 per game)
 */
export function splitConcatenatedGames(rawLog: string): string[] {
  const trimmed = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!trimmed) return [];

  const gameEndPattern = /(Game Result: Game \d+ ended[^\n]*\n?)/;
  const parts = trimmed.split(gameEndPattern);
  if (parts.length < 2) return [trimmed];

  const games: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const content = (parts[i] + parts[i + 1]).trim();
    if (content.length === 0) continue;
    const firstTurn = content.indexOf('Turn: Turn 1 (Ai(');
    if (firstTurn >= 0) {
      games.push(content.slice(firstTurn).trim());
    } else {
      games.push(content);
    }
  }
  return games.length > 0 ? games : [trimmed];
}
