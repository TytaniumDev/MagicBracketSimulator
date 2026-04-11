/**
 * Cloud Tasks helpers for scheduling delayed recovery checks.
 *
 * Replaces the background stale-job-scanner (polling every 45s) and
 * per-SSE 30s recovery intervals with event-driven one-shot tasks.
 *
 * In LOCAL mode: no-ops (recovery relies on stream-open check only).
 */

const USE_CLOUD_TASKS = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let tasksClient: InstanceType<typeof import('@google-cloud/tasks').CloudTasksClient> | null = null;

function getClient() {
  if (!USE_CLOUD_TASKS) return null;
  if (tasksClient) return tasksClient;

  try {
    const { CloudTasksClient } = require('@google-cloud/tasks') as typeof import('@google-cloud/tasks');
    tasksClient = new CloudTasksClient();
    return tasksClient;
  } catch (err) {
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
 * Schedule a recovery check for a job after a delay.
 * If the job completes before the task fires, call cancelRecoveryCheck to delete it.
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
        name: getTaskName(jobId),
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
  }
}

/**
 * Cancel a scheduled recovery task (called when a job reaches terminal state).
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
  }
}
