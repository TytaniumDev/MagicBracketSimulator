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

  // Fetch precons for use in tests
  let preconIds: string[] = [];
  
  // Test: GET /api/precons
  await test('GET /api/precons returns precon list', async () => {
    const response = await fetch(`${BASE_URL}/api/precons`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    
    const data = await response.json();
    assert(Array.isArray(data.precons), 'Expected precons array');
    assert(data.precons.length >= 4, 'Expected at least 4 precons for testing');
    assert(data.precons[0].id, 'Expected precon to have id');
    assert(data.precons[0].name, 'Expected precon to have name');
    
    // Store first 4 precon IDs for later tests
    preconIds = data.precons.slice(0, 4).map((p: { id: string }) => p.id);
  });

  // Test: POST /api/jobs - missing deckIds
  await test('POST /api/jobs rejects missing deckIds', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('deckIds'), 'Expected deckIds required error');
  });

  // Test: POST /api/jobs - wrong number of deckIds
  await test('POST /api/jobs rejects wrong number of deckIds', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckIds: preconIds.slice(0, 2), // Only 2
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.toLowerCase().includes('exactly 4'), 'Expected exactly 4 deckIds error');
  });

  // Test: POST /api/jobs - invalid deck ID
  await test('POST /api/jobs rejects invalid deck ID', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckIds: ['invalid-id-1', 'invalid-id-2', 'invalid-id-3', 'invalid-id-4'],
        simulations: 5,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('Invalid deck ID'), 'Expected invalid deck ID error');
  });

  // Test: POST /api/jobs - simulations out of range
  await test('POST /api/jobs rejects invalid simulations', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckIds: preconIds,
        simulations: 201,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('between 1 and 100'), 'Expected simulations range error');
  });

  // Test: POST /api/jobs - parallelism out of range
  await test('POST /api/jobs rejects invalid parallelism', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckIds: preconIds,
        simulations: 5,
        parallelism: 10,
      }),
    });
    
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error.includes('between 1 and 8'), 'Expected parallelism range error');
  });

  // Test: POST /api/jobs - create job with 4 precons
  await test('POST /api/jobs creates job with 4 precon deck IDs', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckIds: preconIds,
        simulations: 1,
        parallelism: 1,
      }),
    });
    
    assert(response.status === 201, `Expected 201, got ${response.status}`);
    const data = await response.json();
    assert(data.id, 'Expected job id');
    assert(data.status === 'QUEUED', 'Expected QUEUED status');
    assert(data.name, 'Expected name (simulations - datetime)');
    assert(Array.isArray(data.deckNames) && data.deckNames.length === 4, 'Expected 4 deckNames');
    assert(data.parallelism === 1, 'Expected parallelism 1');
  });

  // Test: GET /api/jobs - list jobs
  let createdJobId: string | null = null;
  await test('GET /api/jobs returns job list', async () => {
    const response = await fetch(`${BASE_URL}/api/jobs`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    
    const data = await response.json();
    assert(Array.isArray(data.jobs), 'Expected jobs array');
    assert(data.jobs.length > 0, 'Expected at least one job from previous test');
    
    const job = data.jobs[0];
    assert(job.id, 'Expected job id');
    assert(job.name, 'Expected name');
    assert(Array.isArray(job.deckNames) && job.deckNames.length === 4, 'Expected 4 deckNames');
    assert(job.status, 'Expected status');
    createdJobId = job.id;
  });

  // Test: DELETE /api/jobs/[id] - delete a job
  await test('DELETE /api/jobs/[id] deletes job and returns 204', async () => {
    if (!createdJobId) throw new Error('No job id from previous test');
    const response = await fetch(`${BASE_URL}/api/jobs/${encodeURIComponent(createdJobId)}`, {
      method: 'DELETE',
    });
    assert(response.status === 204, `Expected 204, got ${response.status}`);
    const getResponse = await fetch(`${BASE_URL}/api/jobs/${encodeURIComponent(createdJobId)}`);
    assert(getResponse.status === 404, 'Expected job to be gone (404)');
  });

  // Test: POST /api/decks - reject invalid deck URL
  await test('POST /api/decks rejects invalid deck URL', async () => {
    const response = await fetch(`${BASE_URL}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckUrl: 'https://example.com/not-a-deck',
      }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    const data = await response.json();
    assert(data.error?.includes('ManaBox') || data.error?.includes('Moxfield'), 'Expected supported URLs in error');
  });

  // Test: POST /api/decks - save a deck from ManaBox URL (requires network)
  await test('POST /api/decks saves deck from ManaBox URL', async () => {
    const response = await fetch(`${BASE_URL}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckUrl: 'https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA',
      }),
    });
    assert(response.status === 201, `Expected 201, got ${response.status}`);
    const data = await response.json();
    assert(data.id, 'Expected deck id');
    assert(data.name === 'Temur Roar Upgraded', `Expected deck name, got ${data.name}`);
  });

  // Test: POST /api/decks - save a deck from text
  await test('POST /api/decks saves deck from text', async () => {
    const deckText = `[metadata]
Name=Test Deck

[Commander]
1 Ashling the Pilgrim

[Main]
1 Sol Ring
98 Mountain`;

    const response = await fetch(`${BASE_URL}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckText,
      }),
    });
    
    assert(response.status === 201, `Expected 201, got ${response.status}`);
    const data = await response.json();
    assert(data.id, 'Expected deck id (filename)');
    assert(data.name === 'Test Deck', 'Expected deck name from metadata');
  });

  // Test: GET /api/decks - list saved decks
  await test('GET /api/decks returns saved deck list', async () => {
    const response = await fetch(`${BASE_URL}/api/decks`);
    assert(response.ok, `Expected 200, got ${response.status}`);
    
    const data = await response.json();
    assert(Array.isArray(data.decks), 'Expected decks array');
    // Should have at least the test deck we just created
    assert(data.decks.length > 0, 'Expected at least one saved deck');
    assert(data.decks[0].id, 'Expected deck id');
    assert(data.decks[0].name, 'Expected deck name');
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
