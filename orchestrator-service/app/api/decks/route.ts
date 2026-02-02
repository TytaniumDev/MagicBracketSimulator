import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks, createDeck } from '@/lib/deck-store-factory';
import { parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl } from '@/lib/ingestion';

/**
 * GET /api/decks - List all decks (precons + every user's submissions)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const decks = await listAllDecks();
    return NextResponse.json({ decks });
  } catch (error) {
    console.error('Failed to list decks:', error);
    return NextResponse.json(
      { error: 'Failed to list decks' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/decks - Create a deck from URL or text
 * Body: { deckUrl?: string, deckText?: string }
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { deckUrl, deckText } = body;

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
    let link: string | null = null;

    if (deckUrl) {
      const url = typeof deckUrl === 'string' ? deckUrl.trim() : '';
      if (!isMoxfieldUrl(url) && !isArchidektUrl(url) && !isManaboxUrl(url)) {
        return NextResponse.json(
          { error: 'Invalid deck URL. Please use Moxfield, Archidekt, or ManaBox URLs.' },
          { status: 400 }
        );
      }
      const result = await fetchDeckAsDck(url);
      name = result.name;
      dck = result.dck;
      link = url;
    } else {
      const text = typeof deckText === 'string' ? deckText.trim() : '';
      if (!text) {
        return NextResponse.json(
          { error: 'deckText is required when not using deckUrl' },
          { status: 400 }
        );
      }
      const result = parseTextAsDck(text);
      name = result.name;
      dck = result.dck;
    }

    const commander = parseCommanderFromContent(dck);
    let colorIdentity: string[] | undefined;
    if (commander) {
      colorIdentity = await getColorIdentity(commander);
    }

    const savedDeck = await createDeck({
      name,
      dck,
      link,
      ownerId: user.uid,
      ownerEmail: user.email,
      colorIdentity,
    });

    return NextResponse.json(
      { ...savedDeck, colorIdentity },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to save deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to save deck';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
