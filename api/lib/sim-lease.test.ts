/**
 * Tests for the pure sim-lease rules (claimability and lease extension).
 *
 * Run with: npx tsx lib/sim-lease.test.ts
 */
import { isSimClaimable, isSimLeaseExpired, resolveLeaseExtension, simLeaseExpiry, SIM_LEASE_MS } from './sim-lease';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const past = new Date(NOW - 1000).toISOString();
const future = new Date(NOW + 1000).toISOString();

check('simLeaseExpiry is SIM_LEASE_MS out', Date.parse(simLeaseExpiry(NOW)) - NOW, SIM_LEASE_MS);

check('RUNNING with past lease is expired', isSimLeaseExpired({ state: 'RUNNING', leaseExpiresAt: past }, NOW), true);
check('RUNNING with future lease is not expired', isSimLeaseExpired({ state: 'RUNNING', leaseExpiresAt: future }, NOW), false);
check('RUNNING without lease is not expired', isSimLeaseExpired({ state: 'RUNNING' }, NOW), false);
check('COMPLETED with past lease is not expired', isSimLeaseExpired({ state: 'COMPLETED', leaseExpiresAt: past }, NOW), false);

check('PENDING is claimable', isSimClaimable({ state: 'PENDING' }, NOW), true);
check('RUNNING with past lease is claimable', isSimClaimable({ state: 'RUNNING', leaseExpiresAt: past }, NOW), true);
check('RUNNING with future lease is not claimable', isSimClaimable({ state: 'RUNNING', leaseExpiresAt: future }, NOW), false);
check('FAILED is not claimable', isSimClaimable({ state: 'FAILED' }, NOW), false);

check('missing sim → lost', resolveLeaseExtension(null, 'w1'), 'lost');
check('owner RUNNING → extended', resolveLeaseExtension({ state: 'RUNNING', workerId: 'w1' }, 'w1'), 'extended');
check('other worker → lost', resolveLeaseExtension({ state: 'RUNNING', workerId: 'w2' }, 'w1'), 'lost');
check('reset to PENDING → lost', resolveLeaseExtension({ state: 'PENDING' }, 'w1'), 'lost');
check('COMPLETED → lost', resolveLeaseExtension({ state: 'COMPLETED', workerId: 'w1' }, 'w1'), 'lost');
check('CANCELLED → cancelled', resolveLeaseExtension({ state: 'CANCELLED', workerId: 'w1' }, 'w1'), 'cancelled');

if (failed > 0) process.exit(1);
