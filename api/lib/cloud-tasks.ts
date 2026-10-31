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

function getTaskName(jobId: string): string {
  const queuePath = getQueuePath();
  // Sanitize jobId for Cloud Tasks name (alphanumeric, hyphens, underscores)
  const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${queuePath}/tasks/recover-${sanitized}`;
}

/**
 * Schedule a job's first recovery check, named after the job so
 * cancelRecoveryCheck can delete it when the job ends. A second schedule
 * for the same job is a no-op (ALREADY_EXISTS).
 */
export function scheduleRecoveryCheck(jobId: string, delaySeconds = 600): Promise<void> {
  return createRecoveryTask(jobId, delaySeconds, getTaskName(jobId));
}

/**
 * Schedule another check from inside a running one. Unnamed, because Cloud
 * Tasks refuses to reuse the running task's name for about an hour; if the
 * job ends first, the check finds it terminal and does nothing.
 */
export function scheduleFollowUpRecoveryCheck(jobId: string, delaySeconds: number): Promise<void> {
  return createRecoveryTask(jobId, delaySeconds);
}

async function createRecoveryTask(jobId: string, delaySeconds: number, name?: string): Promise<void> {
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
        ...(name && { name }),
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
    // Task may already exist (duplicate schedule) — that's OK
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 6) {
      // ALREADY_EXISTS — ignore
      return;
    }
    console.warn(`[CloudTasks] Failed to schedule recovery for job ${jobId}:`, err);
    Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId } });
  }
}

/**
 * Delete a job's first recovery check (called when the job reaches a
 * terminal state). Needs roles/cloudtasks.taskDeleter on the API's service
 * account (docs/MODE_SETUP.md).
 */
export async function cancelRecoveryCheck(jobId: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    await client.deleteTask({ name: getTaskName(jobId) });
  } catch (err: unknown) {
    // Task may have already been deleted or executed — that's OK
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 5) {
      // NOT_FOUND — ignore
      return;
    }
    console.warn(`[CloudTasks] Failed to cancel recovery for job ${jobId}:`, err);
    Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId } });
  }
}
