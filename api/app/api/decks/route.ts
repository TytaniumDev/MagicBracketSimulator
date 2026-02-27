import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks, createDeck } from '@/lib/deck-store-factory';
import { parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl } from '@/lib/ingestion';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

/**
 * GET /api/decks - List all decks (precons + every user's submissions, public)
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
    return errorResponse('Failed to list decks', 500);
  }
}

/**
 * POST /api/decks - Create a deck from URL or pasted text
 * Body: { deckUrl: string } OR { deckText: string, deckName?: string }
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { deckUrl, deckText, deckName, deckLink } = body;

    let name: string;
    let dck: string;
    let link: string | undefined;

    const url = typeof deckUrl === 'string' ? deckUrl.trim() : '';
    const text = typeof deckText === 'string' ? deckText.trim() : '';

    if (url) {
      // URL-based import
      if (!isMoxfieldUrl(url) && !isArchidektUrl(url) && !isManaboxUrl(url)) {
        return badRequestResponse('Invalid deck URL. Please use Moxfield, Archidekt, or ManaBox URLs.');
      }

      const result = await fetchDeckAsDck(url);
      name = result.name;
      dck = result.dck;
      link = url;
    } else if (text) {
      // Text-based import
      const customName = typeof deckName === 'string' ? deckName.trim() : '';
      const result = parseTextAsDck(text);
      name = customName || result.name;
      dck = result.dck;
      // Use provided link (e.g., Moxfield URL for manual paste flow)
      if (typeof deckLink === 'string' && deckLink.trim()) {
        link = deckLink.trim();
      }
    } else {
      return badRequestResponse('Either deckUrl or deckText is required');
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
    return errorResponse(error instanceof Error ? error.message : 'Failed to save deck', 500);
  }
}
