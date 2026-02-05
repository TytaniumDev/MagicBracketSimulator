import { PubSub, Topic } from '@google-cloud/pubsub';

// Initialize Pub/Sub client
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const TOPIC_NAME = process.env.PUBSUB_TOPIC || 'job-created';
const WORKER_REPORT_IN_TOPIC_NAME = process.env.PUBSUB_WORKER_REPORT_IN_TOPIC || 'worker-report-in';

// Lazy-initialize topic references
let topic: Topic | null = null;
let workerReportInTopic: Topic | null = null;

function getTopic(): Topic {
  if (!topic) {
    topic = pubsub.topic(TOPIC_NAME);
  }
  return topic;
}

function getWorkerReportInTopic(): Topic {
  if (!workerReportInTopic) {
    workerReportInTopic = pubsub.topic(WORKER_REPORT_IN_TOPIC_NAME);
  }
  return workerReportInTopic;
}

/**
 * Message payload for job creation events
 */
export interface JobCreatedMessage {
  jobId: string;
  createdAt: string;
}

/**
 * Publish a job-created event to Pub/Sub
 * This triggers the local worker to pick up and process the job
 * 
 * @param jobId The ID of the created job
 * @returns The message ID
 */
export async function publishJobCreated(jobId: string): Promise<string> {
  const message: JobCreatedMessage = {
    jobId,
    createdAt: new Date().toISOString(),
  };

  const messageId = await getTopic().publishMessage({
    json: message,
  });

  console.log(`Published job-created message for job ${jobId}, messageId: ${messageId}`);
  return messageId;
}

/**
 * Publish a batch of job-created events
 * Useful for retrying multiple jobs
 * 
 * @param jobIds Array of job IDs
 * @returns Array of message IDs
 */
export async function publishJobCreatedBatch(jobIds: string[]): Promise<string[]> {
  const t = getTopic();
  const now = new Date().toISOString();

  const messages = jobIds.map(jobId => ({
    json: {
      jobId,
      createdAt: now,
    } as JobCreatedMessage,
  }));

  // Publish messages in parallel
  const messageIds = await Promise.all(
    messages.map(msg => t.publishMessage(msg))
  );

  console.log(`Published ${messageIds.length} job-created messages`);
  return messageIds;
}

/**
 * Message payload for worker report-in (frontend-triggered status check)
 */
export interface WorkerReportInMessage {
  refreshId: string;
}

/**
 * Publish a worker-report-in event so all subscribed workers send a heartbeat.
 * Called when the frontend requests "Refresh" on the workers list.
 */
export async function publishWorkerReportIn(refreshId: string): Promise<string> {
  const messageId = await getWorkerReportInTopic().publishMessage({
    json: { refreshId } as WorkerReportInMessage,
  });
  console.log(`Published worker-report-in for refreshId ${refreshId}, messageId: ${messageId}`);
  return messageId;
}

export { pubsub, TOPIC_NAME, WORKER_REPORT_IN_TOPIC_NAME };
