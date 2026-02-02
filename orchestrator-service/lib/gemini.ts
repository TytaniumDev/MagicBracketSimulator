import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs/promises';
import * as path from 'path';

// Types for analyze payload and results
export interface DeckInfo {
  name: string;
  decklist: string;
}

export interface DeckOutcome {
  wins: number;
  winning_turns: number[];
  turns_lost_on: number[];
}

export interface AnalyzePayload {
  decks: DeckInfo[];
  total_games: number;
  outcomes: Record<string, DeckOutcome>;
}

export interface DeckBracketResult {
  deck_name: string;
  bracket: number;
  confidence: 'High' | 'Medium' | 'Low';
  reasoning: string;
  weaknesses?: string;
}

export interface AnalysisResult {
  results: DeckBracketResult[];
}

// Model configuration
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// System prompt (ported from Python judge_agent.py)
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

Respond with JSON only, no markdown or extra text.`;

/**
 * Load the rubric file
 */
async function loadRubric(): Promise<string> {
  try {
    // Try multiple locations
    const possiblePaths = [
      path.join(process.cwd(), 'rubric.md'),
      path.join(__dirname, '..', '..', 'rubric.md'),
      '/app/rubric.md', // Cloud Run path
    ];

    for (const rubricPath of possiblePaths) {
      try {
        const content = await fs.readFile(rubricPath, 'utf-8');
        return content;
      } catch {
        continue;
      }
    }
    
    console.warn('Rubric file not found');
    return '(No rubric file found.)';
  } catch (error) {
    console.error('Error loading rubric:', error);
    return '(Error loading rubric.)';
  }
}

/**
 * Build the user prompt with decklists and outcomes
 */
function buildUserPrompt(
  payload: AnalyzePayload,
  rubricText: string
): string {
  const parts: string[] = [
    '## Bracket Rubric\n\n',
    rubricText,
    `\n\n## Game Summary\n\nTotal games played: ${payload.total_games}\n\n`,
  ];

  // Add each deck's info
  payload.decks.forEach((deck, i) => {
    const deckName = deck.name;
    const decklist = deck.decklist || '(No decklist provided)';
    const outcome = payload.outcomes[deckName] || {
      wins: 0,
      winning_turns: [],
      turns_lost_on: [],
    };

    const wins = outcome.wins || 0;
    const winningTurns = outcome.winning_turns || [];
    const turnsLostOn = outcome.turns_lost_on || [];

    parts.push(`### Deck ${i + 1}: ${deckName}\n\n`);
    parts.push(`**Performance:**\n`);
    parts.push(`- Wins: ${wins} / ${payload.total_games}\n`);
    
    if (winningTurns.length > 0) {
      const avgWinTurn = winningTurns.reduce((a, b) => a + b, 0) / winningTurns.length;
      parts.push(`- Winning turns: [${winningTurns.join(', ')}] (avg: ${avgWinTurn.toFixed(1)})\n`);
    } else {
      parts.push(`- Winning turns: none\n`);
    }
    
    if (turnsLostOn.length > 0) {
      const avgLossTurn = turnsLostOn.reduce((a, b) => a + b, 0) / turnsLostOn.length;
      parts.push(`- Turns lost on: [${turnsLostOn.join(', ')}] (avg: ${avgLossTurn.toFixed(1)})\n`);
    }

    parts.push(`\n**Decklist:**\n\`\`\`\n${decklist}\n\`\`\`\n\n`);
  });

  parts.push('\nAssign a bracket (1-5) to EACH of the 4 decks and respond with JSON only.');

  return parts.join('');
}

/**
 * Parse and validate the Gemini response
 */
function parseAnalysisResponse(responseText: string): AnalysisResult {
  let text = responseText.trim();

  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    // Remove first line if it starts with ```
    if (lines[0].startsWith('```')) {
      lines.shift();
    }
    // Remove last line if it's just ```
    if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
      lines.pop();
    }
    text = lines.join('\n');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse Gemini response as JSON: ${error}`);
  }

  // Handle both formats: {"results": [...]} or just [...]
  let results: unknown[];
  if (typeof parsed === 'object' && parsed !== null && 'results' in parsed) {
    results = (parsed as { results: unknown[] }).results;
  } else if (Array.isArray(parsed)) {
    results = parsed;
  } else {
    throw new Error(`Unexpected response format: ${typeof parsed}`);
  }

  if (!Array.isArray(results)) {
    throw new Error(`Expected results to be an array, got ${typeof results}`);
  }

  // Validate each result
  const validatedResults: DeckBracketResult[] = [];
  for (const r of results) {
    if (typeof r !== 'object' || r === null) {
      throw new Error('Each result must be an object');
    }

    const result = r as Record<string, unknown>;
    
    // Check required keys
    for (const key of ['deck_name', 'bracket', 'confidence', 'reasoning']) {
      if (!(key in result)) {
        throw new Error(`Gemini result missing key: ${key}`);
      }
    }

    const bracket = Number(result.bracket);
    if (isNaN(bracket) || bracket < 1 || bracket > 5) {
      throw new Error(`Invalid bracket: ${result.bracket}`);
    }

    validatedResults.push({
      deck_name: String(result.deck_name),
      bracket,
      confidence: result.confidence as 'High' | 'Medium' | 'Low',
      reasoning: String(result.reasoning),
      weaknesses: result.weaknesses ? String(result.weaknesses) : undefined,
    });
  }

  return { results: validatedResults };
}

/**
 * Analyze decks using Gemini
 */
export async function analyzeDecks(payload: AnalyzePayload): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });

  const rubricText = await loadRubric();
  const userPrompt = buildUserPrompt(payload, rubricText);

  try {
    const result = await model.generateContent(userPrompt);
    const response = result.response;
    const text = response.text();

    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    return parseAnalysisResponse(text);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Gemini API error: ${error.message}`);
    }
    throw new Error('Unknown Gemini API error');
  }
}

/**
 * Build prompt preview (for debugging)
 */
export async function buildPromptPreview(payload: AnalyzePayload): Promise<{
  system_prompt: string;
  user_prompt: string;
}> {
  const rubricText = await loadRubric();
  const userPrompt = buildUserPrompt(payload, rubricText);

  return {
    system_prompt: SYSTEM_PROMPT,
    user_prompt: userPrompt,
  };
}
