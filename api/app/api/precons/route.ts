/**
 * GET /api/precons - List precons (legacy; use GET /api/decks and filter by isPrecon)
 */
import { NextResponse } from 'next/server';
import { listAllDecks } from '@/lib/deck-store-factory';

export async function GET() {
  try {
    const decks = await listAllDecks();
    const precons = decks
      .filter((d) => d.isPrecon)
      .map((d) => ({
        id: d.id,
        name: d.name,
        primaryCommander: d.primaryCommander,
        colorIdentity: d.colorIdentity,
      }));
    return NextResponse.json({ precons });
  } catch (error) {
    console.error('Failed to load precons:', error);
    return NextResponse.json(
      { error: 'Failed to load precons' },
      { status: 500 }
    );
  }
}
