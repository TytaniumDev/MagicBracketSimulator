import { NextRequest } from 'next/server';

process.env.CORS_ALLOWED_ORIGINS = '*';

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  const { middleware } = await import('../middleware');

  await test('Wildcard allows any origin as literal "*" and disables credentials', () => {
    const req = new NextRequest('http://localhost:3000/api/jobs', {
      method: 'GET',
      headers: { origin: 'https://evil.com' },
    });
    const res = middleware(req);
    assert(res.headers.get('Access-Control-Allow-Origin') === '*', 'Expected *');
    assert(res.headers.get('Access-Control-Allow-Credentials') === null, 'Expected credentials to be omitted or false');
  });

  if (failed > 0) process.exit(1);
}
runTests();
