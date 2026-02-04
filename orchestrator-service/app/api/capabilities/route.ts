import { NextResponse } from 'next/server';
import { MoxfieldApi } from '@/lib/moxfield-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    moxfieldIngestionEnabled: MoxfieldApi.isConfigured(),
  });
}
