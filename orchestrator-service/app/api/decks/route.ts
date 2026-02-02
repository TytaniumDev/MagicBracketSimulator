import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks, createDeck } from '@/lib/deck-store-factory';
import { parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl } from '@/lib/ingestion';

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
 * POST /api/decks - Create a deck from URL
 * Body: { deckUrl: string }
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
    const { deckUrl } = body;

    const url = typeof deckUrl === 'string' ? deckUrl.trim() : '';
    if (!url) {
      return NextResponse.json(
        { error: 'deckUrl is required' },
        { status: 400 }
      );
    }

    if (!isMoxfieldUrl(url) && !isArchidektUrl(url) && !isManaboxUrl(url)) {
      return NextResponse.json(
        { error: 'Invalid deck URL. Please use Moxfield, Archidekt, or ManaBox URLs.' },
        { status: 400 }
      );
    }

    const result = await fetchDeckAsDck(url);
    const name = result.name;
    const dck = result.dck;
    const link = url;

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
