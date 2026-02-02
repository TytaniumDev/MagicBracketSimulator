import { NextResponse } from 'next/server';
import { loadPrecons } from '@/lib/precons';
import { getColorIdentityByKey } from '@/lib/deck-metadata';

export async function GET() {
  try {
    const precons = loadPrecons();
    const preconsWithColor = precons.map((p) => {
      const colorIdentity = getColorIdentityByKey(p.id);
      return {
        id: p.id,
        name: p.name,
        primaryCommander: p.primaryCommander,
        colorIdentity,
      };
    });
    return NextResponse.json({
      precons: preconsWithColor,
    });
  } catch (error) {
    console.error('Failed to load precons:', error);
    return NextResponse.json(
      { error: 'Failed to load precons' },
      { status: 500 }
    );
  }
}
