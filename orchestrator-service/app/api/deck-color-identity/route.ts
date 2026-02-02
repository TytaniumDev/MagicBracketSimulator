import { NextResponse } from 'next/server';
import { loadPrecons } from '@/lib/precons';
import { listSavedDecks } from '@/lib/saved-decks';
import { getColorIdentityByKey } from '@/lib/deck-metadata';

/**
 * GET /api/deck-color-identity?names=Deck1,Deck2,...
 * Returns color identity (WUBRG) for each deck name that we can resolve.
 * Deck names are matched against precon names and saved deck names.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const namesParam = searchParams.get('names');
    const names: string[] = namesParam
      ? namesParam.split(',').map((n) => n.trim()).filter(Boolean)
      : [];

    const result: Record<string, string[]> = {};

    // Precons: name -> precon.id -> getColorIdentityByKey(id)
    const precons = loadPrecons();
    for (const precon of precons) {
      const colorIdentity = getColorIdentityByKey(precon.id);
      if (colorIdentity?.length) {
        result[precon.name] = colorIdentity;
      }
    }

    // Saved decks: name -> filename -> getColorIdentityByKey(filename)
    const savedDecks = listSavedDecks();
    for (const deck of savedDecks) {
      const colorIdentity = getColorIdentityByKey(deck.filename);
      if (colorIdentity?.length) {
        result[deck.name] = colorIdentity;
      }
    }

    // If names were requested, return only those (preserving order); otherwise return full map
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
