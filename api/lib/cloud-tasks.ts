/**
 * Cloud Tasks helpers for scheduling delayed recovery checks.
 *
 * Replaces the background stale-job-scanner (polling every 45s) and
 * per-SSE 30s recovery intervals with event-driven one-shot tasks.
 *
 * In LOCAL mode: no-ops (recovery relies on stream-open check only).
 */

import { USE_FIRESTORE as USE_CLOUD_TASKS } from './env';
import * as Sentry from '@sentry/nextjs';

let tasksClient: InstanceType<typeof import('@google-cloud/tasks').CloudTasksClient> | null = null;

function getClient() {
  if (!USE_CLOUD_TASKS) return null;
  if (tasksClient) return tasksClient;

  try {
    const { CloudTasksClient } = require('@google-cloud/tasks') as typeof import('@google-cloud/tasks');
    tasksClient = new CloudTasksClient();
    return tasksClient;
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'cloud-tasks' } });
    console.warn('[CloudTasks] Failed to initialize client:', err);
    return null;
  }
}

function getQueuePath(): string | null {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.CLOUD_TASKS_LOCATION || 'us-central1';
  const queue = process.env.CLOUD_TASKS_QUEUE || 'job-recovery';
  if (!project) return null;
  return `projects/${project}/locations/${location}/queues/${queue}`;
}

function getApiBaseUrl(): string {
  return process.env.API_BASE_URL || `https://api-${process.env.GOOGLE_CLOUD_PROJECT}.web.app`;
}

/**
 * Schedule a recovery check for a job after a delay.
 *
 * Tasks are never deleted: a check that fires after the job finished is a
 * no-op (see POST /api/jobs/:id/recover), and the API's service account
 * may only create tasks. Tasks are unnamed so the recover route can
 * schedule a follow-up while its own task is still running (Cloud Tasks
 * refuses to reuse a task name for about an hour).
 */
export async function scheduleRecoveryCheck(jobId: string, delaySeconds = 600): Promise<void> {
  const client = getClient();
  if (!client) return;

  const queuePath = getQueuePath();
  if (!queuePath) return;

  const apiUrl = getApiBaseUrl();
  const workerSecret = process.env.WORKER_SECRET;

  try {
    const scheduleTime = new Date(Date.now() + delaySeconds * 1000);

    await client.createTask({
      parent: queuePath,
      task: {
        scheduleTime: {
          seconds: Math.floor(scheduleTime.getTime() / 1000),
          nanos: 0,
        },
        httpRequest: {
          httpMethod: 'POST',
          url: `${apiUrl}/api/jobs/${jobId}/recover`,
          headers: {
            'Content-Type': 'application/json',
            ...(workerSecret ? { 'X-Worker-Secret': workerSecret } : {}),
          },
          body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
        },
      },
    });
  } catch (err: unknown) {
    console.warn(`[CloudTasks] Failed to schedule recovery for job ${jobId}:`, err);
    Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId } });
  }
}
