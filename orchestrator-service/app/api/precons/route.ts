import { NextResponse } from 'next/server';
import { loadPrecons } from '@/lib/precons';

export async function GET() {
  try {
    const precons = loadPrecons();
    return NextResponse.json({
      precons: precons.map(p => ({
        id: p.id,
        name: p.name,
        primaryCommander: p.primaryCommander,
      })),
    });
  } catch (error) {
    console.error('Failed to load precons:', error);
    return NextResponse.json(
      { error: 'Failed to load precons' },
      { status: 500 }
    );
  }
}
