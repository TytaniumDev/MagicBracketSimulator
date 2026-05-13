/**
 * One-time bootstrap: enqueue the first lease-sweep Cloud Task. Subsequent
 * sweeps self-reschedule. Each invocation enqueues an independent scheduling
 * chain, so re-running creates duplicate concurrent sweeps — benign because
 * the sweep is idempotent, but prefer running only once after deploy.
 *
 * Run: npx tsx scripts/bootstrap-lease-sweep.ts
 *
 * Pre-reqs: GOOGLE_CLOUD_PROJECT, GCP creds, CLOUD_TASKS_LOCATION, CLOUD_TASKS_QUEUE
 * (the same env the API server uses).
 */
import { scheduleLeaseSweep } from '../lib/cloud-tasks';

async function main() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error('GOOGLE_CLOUD_PROJECT not set; nothing to enqueue (LOCAL mode).');
    process.exit(0);
  }
  console.log('Enqueuing first lease-sweep task (12s delay)...');
  await scheduleLeaseSweep();
  console.log('Done. Subsequent sweeps will self-reschedule.');
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
