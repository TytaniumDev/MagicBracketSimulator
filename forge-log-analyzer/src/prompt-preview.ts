/**
 * Builds the exact system and user prompts that would be sent to Gemini.
 * Used when the Analysis Service is unreachable (e.g. not running) so the
 * frontend can still show the prompt preview.
 *
 * Kept in sync with analysis-service/judge_agent.py (SYSTEM_PROMPT, _build_user_prompt, rubric).
 */

const SYSTEM_PROMPT = `You are a Magic: The Gathering Commander Rules Committee Judge. 

Analyze the provided decklists and game outcomes for ALL 4 DECKS and assign a power bracket (1-5) to EACH deck.

Use the rubric provided to determine brackets based on:
1. **Speed**: The turn numbers when each deck wins. Earlier wins = higher bracket.
2. **Consistency**: Win rate and variance in winning turns.
3. **Card Quality**: Game Changers, tutors, fast mana, and power cards in the decklist.

The Commander Brackets system uses these turn expectations:
- Bracket 1 (Exhibition): Expect to play 9+ turns before win/loss
- Bracket 2 (Core): Expect to play 8+ turns before win/loss  
- Bracket 3 (Upgraded): Expect to play 6+ turns before win/loss
- Bracket 4 (Optimized): Expect to play 4+ turns before win/loss
- Bracket 5 (cEDH): Game could end on any turn

Respond with a JSON object containing a "results" array with EXACTLY 4 entries (one per deck), each with:
- "deck_name": string (must match the deck name provided)
- "bracket": integer 1-5
- "confidence": "High" or "Medium" or "Low"
- "reasoning": string explaining why this bracket based on wins, turn speed, and decklist
- "weaknesses": string describing deck weaknesses

Example response format:
{
  "results": [
    {"deck_name": "Deck A", "bracket": 3, "confidence": "High", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck B", "bracket": 2, "confidence": "Medium", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck C", "bracket": 3, "confidence": "High", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck D", "bracket": 4, "confidence": "Low", "reasoning": "...", "weaknesses": "..."}
  ]
}

Respond with JSON only, no markdown or extra text.
`;

const RUBRIC = `# Bracket Rubric (Official Beta Guidance - October 2025)

Use this rubric to assign a power bracket (1-5) to each Commander deck based on decklists and game outcomes.

## Bracket Definitions

- **Bracket 1 (Exhibition)**: Expect to play **9+ turns** before win/loss. Decks prioritize theme and flavor over power. Win conditions are thematic and substandard.

- **Bracket 2 (Core)**: Expect to play **8+ turns** before win/loss. Unoptimized and straightforward. Win conditions are incremental, telegraphed, and disruptable.

- **Bracket 3 (Upgraded)**: Expect to play **6+ turns** before win/loss. Powered up with strong synergy and high card quality. Can deploy win conditions in one big turn from accrued resources.

- **Bracket 4 (Optimized)**: Expect to play **4+ turns** before win/loss. Lethal, consistent, and fast. Features efficient tutors, fast mana, and high-efficiency disruption.

- **Bracket 5 (cEDH)**: Game could end on **any turn**. Meticulously designed for the competitive metagame with razor-thin margins for error.

## Key Signals to Look For

**Game Changers** (cards that indicate higher brackets when present):
- Fast mana: Sol Ring, Mana Crypt, Mana Vault, Chrome Mox, Mox Diamond, Lion's Eye Diamond, Ancient Tomb, Grim Monolith
- Efficient tutors: Demonic Tutor, Vampiric Tutor, Imperial Seal, Mystical Tutor, Enlightened Tutor, Worldly Tutor, Gamble
- Free spells: Force of Will, Fierce Guardianship
- Value engines: Rhystic Study, Smothering Tithe, Necropotence, Consecrated Sphinx, Seedborn Muse
- Powerful cards: Cyclonic Rift, Ad Nauseam, Thassa's Oracle, Underworld Breach

**Win Speed**: The average turn a deck wins on is the primary bracket indicator.
**Consistency**: Low variance in winning turns indicates a more optimized deck.
**Win Rate**: Higher win rate suggests the deck may be above the table's power level.
`;

interface DeckInfo {
  name: string;
  decklist?: string;
}

interface DeckOutcome {
  wins: number;
  winning_turns: number[];
  turns_lost_on: number[];
}

interface PayloadForPreview {
  decks: DeckInfo[];
  total_games: number;
  outcomes: Record<string, DeckOutcome>;
}

function buildUserPrompt(payload: PayloadForPreview): string {
  const { decks, total_games, outcomes } = payload;
  const parts: string[] = [
    '## Bracket Rubric\n\n',
    RUBRIC,
    `\n\n## Game Summary\n\nTotal games played: ${total_games}\n\n`,
  ];

  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i];
    const deckName = deck?.name ?? `Deck ${i + 1}`;
    const decklist = deck?.decklist ?? '(No decklist provided)';
    const outcome = outcomes[deckName] ?? { wins: 0, winning_turns: [], turns_lost_on: [] };
    const wins = outcome.wins ?? 0;
    const winningTurns = outcome.winning_turns ?? [];
    const turnsLostOn = outcome.turns_lost_on ?? [];

    parts.push(`### Deck ${i + 1}: ${deckName}\n\n`);
    parts.push('**Performance:**\n');
    parts.push(`- Wins: ${wins} / ${total_games}\n`);
    if (winningTurns.length > 0) {
      const avg = winningTurns.reduce((a, b) => a + b, 0) / winningTurns.length;
      parts.push(`- Winning turns: ${JSON.stringify(winningTurns)} (avg: ${avg.toFixed(1)})\n`);
    } else {
      parts.push('- Winning turns: none\n');
    }
    if (turnsLostOn.length > 0) {
      const avg = turnsLostOn.reduce((a, b) => a + b, 0) / turnsLostOn.length;
      parts.push(`- Turns lost on: ${JSON.stringify(turnsLostOn)} (avg: ${avg.toFixed(1)})\n`);
    }
    parts.push('\n**Decklist:**\n```\n');
    parts.push(decklist);
    parts.push('\n```\n\n');
  }

  parts.push('\nAssign a bracket (1-5) to EACH of the 4 decks and respond with JSON only.');
  return parts.join('');
}

/**
 * Builds the exact prompts that would be sent to Gemini for the given payload.
 * Use when the Analysis Service is unreachable so the UI can still show the preview.
 */
export function buildPromptPreview(payload: PayloadForPreview): { system_prompt: string; user_prompt: string } {
  return {
    system_prompt: SYSTEM_PROMPT,
    user_prompt: buildUserPrompt(payload),
  };
}
