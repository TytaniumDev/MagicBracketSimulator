import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Allow multiple origins via environment variable (comma-separated) or default to localhost
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

function getAllowedOrigin(request: NextRequest): { origin: string; credentials: boolean } | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  // Check if origin matches any allowed origin explicitly
  if (ALLOWED_ORIGINS.includes(origin)) {
    return { origin, credentials: true };
  }

  // Check for wildcard
  // Security: Do not dynamically reflect the origin. Return literal '*' and disable credentials.
  if (ALLOWED_ORIGINS.includes('*')) {
    return { origin: '*', credentials: false };
  }

  return null;
}

export function middleware(request: NextRequest) {
  const corsConfig = getAllowedOrigin(request);

  if (request.method === 'OPTIONS') {
    const headers = new Headers({
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firebase-AppCheck',
      'Access-Control-Max-Age': '86400',
    });

    if (corsConfig) {
      headers.set('Access-Control-Allow-Origin', corsConfig.origin);
      if (corsConfig.credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true');
      }
    } else {
      headers.set('Access-Control-Allow-Origin', '');
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return new NextResponse(null, {
      status: 204,
      headers,
    });
  }

  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/') && corsConfig) {
    response.headers.set('Access-Control-Allow-Origin', corsConfig.origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
    if (corsConfig.credentials) {
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
