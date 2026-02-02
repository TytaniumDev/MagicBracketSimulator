import { NextResponse } from 'next/server';
import { listSavedDecks, saveDeck, parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentityByKey, setColorIdentity } from '@/lib/deck-metadata';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl } from '@/lib/ingestion';

/**
 * GET /api/decks - List all saved decks
 */
export async function GET() {
  try {
    const decks = listSavedDecks();
    const decksWithColor = decks.map((deck) => {
      const colorIdentity = getColorIdentityByKey(deck.filename);
      return { ...deck, colorIdentity };
    });
    return NextResponse.json({ decks: decksWithColor });
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
      if (!isMoxfieldUrl(deckUrl) && !isArchidektUrl(deckUrl) && !isManaboxUrl(deckUrl)) {
        return NextResponse.json(
          { error: 'Invalid deck URL. Please use Moxfield, Archidekt, or ManaBox URLs.' },
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

    // Resolve and store commander color identity
    const commander = parseCommanderFromContent(dck);
    let colorIdentity: string[] | undefined;
    if (commander) {
      colorIdentity = await getColorIdentity(commander);
      if (colorIdentity.length > 0) {
        setColorIdentity(savedDeck.filename, colorIdentity);
      }
    }

    return NextResponse.json({ ...savedDeck, colorIdentity }, { status: 201 });
  } catch (error) {
    console.error('Failed to save deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to save deck';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
