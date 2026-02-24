import { NextRequest } from 'next/server';

// Set CORS_ALLOWED_ORIGINS BEFORE importing middleware (evaluated at module load time)
process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com,https://staging.example.com';

// Simple test runner (matches project convention)
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeRequest(url: string, options?: { method?: string; origin?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (options?.origin) {
    headers['origin'] = options.origin;
  }
  return new NextRequest(url, {
    method: options?.method ?? 'GET',
    headers,
  });
}

async function runTests() {
  console.log('Running CORS middleware tests...');

  // Dynamic import so the env var set above is picked up at module load time
  const { middleware } = await import('../middleware');

  // Test 1: OPTIONS preflight returns 204 with full CORS headers
  await test('OPTIONS preflight returns 204 with full CORS headers', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'OPTIONS',
      origin: 'https://app.example.com',
    });
    const res = middleware(req);
    assert(res.status === 204, `Expected status 204, got ${res.status}`);
    assert(res.headers.get('Access-Control-Allow-Origin') === 'https://app.example.com',
      `Expected origin 'https://app.example.com', got '${res.headers.get('Access-Control-Allow-Origin')}'`);
    assert(res.headers.get('Access-Control-Allow-Methods') === 'GET, POST, DELETE, PATCH, OPTIONS',
      `Unexpected Allow-Methods: ${res.headers.get('Access-Control-Allow-Methods')}`);
    assert(res.headers.get('Access-Control-Allow-Credentials') === 'true',
      `Expected Allow-Credentials 'true', got '${res.headers.get('Access-Control-Allow-Credentials')}'`);
    assert(res.headers.get('Access-Control-Max-Age') === '86400',
      `Expected Max-Age '86400', got '${res.headers.get('Access-Control-Max-Age')}'`);
  });

  // Test 2: Preflight includes X-Firebase-AppCheck in Allow-Headers (regression test)
  await test('Preflight includes X-Firebase-AppCheck in Allow-Headers', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'OPTIONS',
      origin: 'https://app.example.com',
    });
    const res = middleware(req);
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
    assert(allowHeaders.includes('Content-Type'),
      `Allow-Headers missing Content-Type: ${allowHeaders}`);
    assert(allowHeaders.includes('Authorization'),
      `Allow-Headers missing Authorization: ${allowHeaders}`);
    assert(allowHeaders.includes('X-Firebase-AppCheck'),
      `Allow-Headers missing X-Firebase-AppCheck: ${allowHeaders}`);
  });

  // Test 3: Preflight returns empty origin for disallowed origin
  await test('Preflight returns empty origin for disallowed origin', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'OPTIONS',
      origin: 'https://evil.example.com',
    });
    const res = middleware(req);
    assert(res.status === 204, `Expected status 204, got ${res.status}`);
    assert(res.headers.get('Access-Control-Allow-Origin') === '',
      `Expected empty origin, got '${res.headers.get('Access-Control-Allow-Origin')}'`);
  });

  // Test 4: GET /api/* includes CORS headers for allowed origin
  await test('GET /api/* includes CORS headers for allowed origin', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'GET',
      origin: 'https://app.example.com',
    });
    const res = middleware(req);
    assert(res.headers.get('Access-Control-Allow-Origin') === 'https://app.example.com',
      `Expected origin reflected, got '${res.headers.get('Access-Control-Allow-Origin')}'`);
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
    assert(allowHeaders.includes('X-Firebase-AppCheck'),
      `Allow-Headers missing X-Firebase-AppCheck on non-preflight: ${allowHeaders}`);
    assert(res.headers.get('Access-Control-Allow-Credentials') === 'true',
      `Expected Allow-Credentials 'true', got '${res.headers.get('Access-Control-Allow-Credentials')}'`);
  });

  // Test 5: GET /api/* omits CORS headers for disallowed origin
  await test('GET /api/* omits CORS headers for disallowed origin', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'GET',
      origin: 'https://evil.example.com',
    });
    const res = middleware(req);
    assert(res.headers.get('Access-Control-Allow-Origin') === null,
      `Expected no Allow-Origin header, got '${res.headers.get('Access-Control-Allow-Origin')}'`);
  });

  // Test 6: Second configured origin is accepted
  await test('Second configured origin is accepted', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', {
      method: 'GET',
      origin: 'https://staging.example.com',
    });
    const res = middleware(req);
    assert(res.headers.get('Access-Control-Allow-Origin') === 'https://staging.example.com',
      `Expected staging origin reflected, got '${res.headers.get('Access-Control-Allow-Origin')}'`);
  });

  // Test 7: Request without Origin header gets no CORS origin
  await test('Request without Origin header gets no CORS origin', () => {
    const req = makeRequest('http://localhost:3000/api/jobs', { method: 'GET' });
    const res = middleware(req);
    assert(res.headers.get('Access-Control-Allow-Origin') === null,
      `Expected no Allow-Origin header, got '${res.headers.get('Access-Control-Allow-Origin')}'`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('All CORS tests passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
