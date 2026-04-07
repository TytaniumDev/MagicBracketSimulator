import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { createDeck } from '@/lib/deck-store-factory';
import { parseCommanderFromContent } from '@/lib/saved-decks';
import { getColorIdentity } from '@/lib/scryfall';
import { fetchDeckAsDck, parseTextAsDck, isMoxfieldUrl, isArchidektUrl, isManaboxUrl, isManaPoolUrl } from '@/lib/ingestion';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

/**
 * POST /api/decks/create - Create a deck from URL or pasted text
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
    if (!body || typeof body !== 'object') {
      return badRequestResponse('Invalid request body');
    }
    const { deckUrl, deckText, deckName, deckLink } = body;

    let name: string;
    let dck: string;
    let link: string | undefined;

    const url = typeof deckUrl === 'string' ? deckUrl.trim() : '';
    const text = typeof deckText === 'string' ? deckText.trim() : '';

    if (url) {
      if (!isMoxfieldUrl(url) && !isArchidektUrl(url) && !isManaboxUrl(url) && !isManaPoolUrl(url)) {
        return badRequestResponse('Invalid deck URL. Please use Moxfield, Archidekt, ManaBox, or ManaPool URLs.');
      }

      const result = await fetchDeckAsDck(url);
      name = result.name;
      dck = result.dck;
      link = url;
    } else if (text) {
      const customName = typeof deckName === 'string' ? deckName.trim() : '';
      const result = parseTextAsDck(text);
      name = customName || result.name;
      dck = result.dck;
      if (typeof deckLink === 'string' && deckLink.trim()) {
        link = deckLink.trim();
      }
    } else {
      return badRequestResponse('Either deckUrl or deckText is required');
    }

    if (link) {
      try {
        const parsedUrl = new URL(link);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return badRequestResponse('Deck link must be a valid HTTP or HTTPS URL');
        }
      } catch (err) {
        return badRequestResponse('Deck link must be a valid URL');
      }
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
