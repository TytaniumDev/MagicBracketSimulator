/**
 * Integration tests for the Orchestrator Service
 * 
 * Run with: npx tsx test/integration.test.ts
 * 
 * Prerequisites:
 * - Next.js dev server running: npm run dev
 * - For full E2E: Docker with forge-sim image, Analysis Service running
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running integration tests...\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  // Test: GET /api/precons
  await test('GET /api/precons returns precon list', async () => {
    const response = await fetch(`${BASE_URL}/api/precons`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    
    const data = await response.json();
    assert(Array.isArray(data.precons), 'Expected precons array');
    assert(data.precons.length > 0, 'Expected at least one precon');
    assert(data.precons[0].id, 'Expected precon to have id');
    assert(data.precons[0].name, 'Expected precon to have name');
  });

  // Test: POST /api/jobs - missing deck
  await test('POST /api/jobs rejects missing deck', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opponentMode: 'random',
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('deckUrl or deckText'), 'Expected deck required error');
  });

  // Test: POST /api/jobs - invalid URL
  await test('POST /api/jobs rejects invalid URL', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckUrl: 'https://example.com/deck',
        opponentMode: 'random',
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('Invalid deck URL'), 'Expected invalid URL error');
  });

  // Test: POST /api/jobs - simulations out of range
  await test('POST /api/jobs rejects invalid simulations', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckText: '[Commander]\n1 Test Commander\n[Main]\n99 Mountain',
        opponentMode: 'random',
        simulations: 100,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('between 1 and 10'), 'Expected simulations range error');
  });

  // Test: POST /api/jobs - specific mode needs 3 opponents
  await test('POST /api/jobs specific mode requires 3 opponents', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckText: '[Commander]\n1 Test Commander\n[Main]\n99 Mountain',
        opponentMode: 'specific',
        opponentIds: ['lorehold-legacies'], // Only 1
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('exactly 3'), 'Expected 3 opponents error');
  });

  // Test: POST /api/jobs - create job with text deck (random opponents)
  await test('POST /api/jobs creates job with text deck', async () => {
    const deckText = `[Commander]
1 Ashling the Pilgrim

[Main]
1 Sol Ring
98 Mountain`;

    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckText,
        opponentMode: 'random',
        simulations: 1,
      }),
    });
    
    assert(response.status === 201, `Expected 201, got ${response.status}`);
    const data = await response.json();
    assert(data.id, 'Expected job id');
    assert(data.status === 'QUEUED', 'Expected QUEUED status');
    assert(data.opponents.length === 3, 'Expected 3 opponents');
    
    // Test: GET /api/jobs/[id]
    const getResponse = await fetch(`${BASE_URL}/api/jobs/${data.id}`);
    assert(getResponse.ok, `Expected 200, got ${getResponse.status}`);
    const jobData = await getResponse.json();
    assert(jobData.id === data.id, 'Expected same job id');
    assert(jobData.deckName === 'Imported Deck', 'Expected default deck name');
  });

  // Test: GET /api/jobs/[id] - not found
  await test('GET /api/jobs/[id] returns 404 for unknown job', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs/nonexistent-id`);
    assert(response.status === 404, `Expected 404, got ${response.status}`);
  });

  // Summary
  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
