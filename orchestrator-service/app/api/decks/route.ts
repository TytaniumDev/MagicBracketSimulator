import { NextResponse } from 'next/server';
import { listSavedDecks, saveDeck } from '@/lib/saved-decks';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl } from '@/lib/ingestion';

/**
 * GET /api/decks - List all saved decks
 */
export async function GET() {
  try {
    const decks = listSavedDecks();
    return NextResponse.json({ decks });
  } catch (error) {
    console.error('Failed to list saved decks:', error);
    return NextResponse.json(
      { error: 'Failed to list saved decks' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/decks - Save a deck from URL or text
 * Body: { deckUrl?: string, deckText?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deckUrl, deckText } = body;

    // Validate: exactly one of deckUrl or deckText required
    if (!deckUrl && !deckText) {
      return NextResponse.json(
        { error: 'Either deckUrl or deckText is required' },
        { status: 400 }
      );
    }
    if (deckUrl && deckText) {
      return NextResponse.json(
        { error: 'Provide either deckUrl or deckText, not both' },
        { status: 400 }
      );
    }

    let name: string;
    let dck: string;

    if (deckUrl) {
      // Validate URL format
      if (!isMoxfieldUrl(deckUrl) && !isArchidektUrl(deckUrl)) {
        return NextResponse.json(
          { error: 'Invalid deck URL. Please use Moxfield or Archidekt URLs.' },
          { status: 400 }
        );
      }

      // Fetch deck from URL
      const result = await fetchDeckAsDck(deckUrl);
      name = result.name;
      dck = result.dck;
    } else {
      // Parse deck from text
      const result = parseTextAsDck(deckText);
      name = result.name;
      dck = result.dck;
    }

    // Save the deck
    const savedDeck = saveDeck(name, dck);

    return NextResponse.json(savedDeck, { status: 201 });
  } catch (error) {
    console.error('Failed to save deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to save deck';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
