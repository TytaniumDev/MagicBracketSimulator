import { NextResponse } from 'next/server';
import { listAllDecks } from '@/lib/deck-store-factory';
import { getColorIdentityByKey } from '@/lib/deck-metadata';

/**
 * GET /api/deck-color-identity?names=Deck1,Deck2,...
 * Returns color identity (WUBRG) for each deck name that we can resolve.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const namesParam = searchParams.get('names');
    const names: string[] = namesParam
      ? namesParam
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : [];

    const decks = await listAllDecks();
    const result: Record<string, string[]> = {};

    for (const deck of decks) {
      const colorIdentity =
        deck.colorIdentity && deck.colorIdentity.length > 0
          ? deck.colorIdentity
          : getColorIdentityByKey(deck.id) ?? getColorIdentityByKey(deck.filename);
      if (colorIdentity?.length) {
        result[deck.name] = colorIdentity;
      }
    }

    if (names.length > 0) {
      const filtered: Record<string, string[]> = {};
      for (const name of names) {
        if (result[name]) {
          filtered[name] = result[name];
        }
      }
      return NextResponse.json(filtered);
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get deck color identity:', error);
    return NextResponse.json(
      { error: 'Failed to get deck color identity' },
      { status: 500 }
    );
  }
}
