import { MoxfieldApi } from '../lib/moxfield-api';

const originalFetch = global.fetch;
const originalEnforceRateLimit = MoxfieldApi['enforceRateLimit'];

// Simple test runner
async function runTests() {
  console.log('Running Moxfield API tests...\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.error(`  Error: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  // Setup / Teardown helper
  const setup = () => {
    process.env.MOXFIELD_USER_AGENT = 'TestAgent/1.0';
    // Mock rate limiter to avoid Firestore calls
    // @ts-ignore - Private method override for testing
    MoxfieldApi['enforceRateLimit'] = async () => {};
  };

  const teardown = () => {
    global.fetch = originalFetch;
    // @ts-ignore
    MoxfieldApi['enforceRateLimit'] = originalEnforceRateLimit;
    delete process.env.MOXFIELD_USER_AGENT;
  };

  await test('fetchDeck should throw if User Agent is missing', async () => {
    teardown(); // Ensure clean state
    try {
      await MoxfieldApi.fetchDeck('123');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('not configured')) {
        throw new Error(`Unexpected error: ${e}`);
      }
    }
  });

  await test('fetchDeck should use configured User Agent', async () => {
    setup();
    let capturedUrl: string | undefined;
    let capturedOptions: any;

    global.fetch = async (url, options) => {
      capturedUrl = url.toString();
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          name: 'Test Deck',
          commanders: {},
          mainboard: {},
        }),
      } as Response;
    };

    await MoxfieldApi.fetchDeck('ABC123_Id');

    if (!capturedUrl?.includes('ABC123_Id')) {
      throw new Error(`Incorrect URL: ${capturedUrl}`);
    }
    if (capturedOptions?.headers?.['User-Agent'] !== 'TestAgent/1.0') {
      throw new Error(`Incorrect User-Agent: ${capturedOptions?.headers?.['User-Agent']}`);
    }
    teardown();
  });

  await test('isConfigured returns correct status', async () => {
    delete process.env.MOXFIELD_USER_AGENT;
    if (MoxfieldApi.isConfigured()) throw new Error('Should be false');

    process.env.MOXFIELD_USER_AGENT = 'test';
    if (!MoxfieldApi.isConfigured()) throw new Error('Should be true');
    teardown();
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
