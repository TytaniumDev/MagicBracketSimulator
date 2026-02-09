import { NextRequest } from 'next/server';
import { isWorkerRequest } from '../lib/auth';

// Simple test runner
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running auth tests...');

  const originalSecret = process.env.WORKER_SECRET;

  try {
    // Test Case 1: Correct Secret
    process.env.WORKER_SECRET = 'super-secret-key';
    await test('isWorkerRequest returns true for correct secret', () => {
      const req = new NextRequest('http://localhost', {
        headers: { 'X-Worker-Secret': 'super-secret-key' }
      });
      assert(isWorkerRequest(req) === true, 'Should return true');
    });

    // Test Case 2: Incorrect Secret
    await test('isWorkerRequest returns false for incorrect secret', () => {
      const req = new NextRequest('http://localhost', {
        headers: { 'X-Worker-Secret': 'wrong-key' }
      });
      assert(isWorkerRequest(req) === false, 'Should return false');
    });

    // Test Case 3: Missing Header
    await test('isWorkerRequest returns false for missing header', () => {
      const req = new NextRequest('http://localhost');
      assert(isWorkerRequest(req) === false, 'Should return false');
    });

    // Test Case 4: Missing Env Var
    delete process.env.WORKER_SECRET;
    await test('isWorkerRequest returns false when WORKER_SECRET is not set', () => {
      const req = new NextRequest('http://localhost', {
        headers: { 'X-Worker-Secret': 'super-secret-key' }
      });
      assert(isWorkerRequest(req) === false, 'Should return false');
    });

  } finally {
    if (originalSecret) {
      process.env.WORKER_SECRET = originalSecret;
    } else {
      delete process.env.WORKER_SECRET;
    }
  }

  console.log('All auth tests passed!');
}

runTests().catch(console.error);
