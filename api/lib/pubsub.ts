import { PubSub, Topic } from '@google-cloud/pubsub';

// Initialize Pub/Sub client
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const TOPIC_NAME = process.env.PUBSUB_TOPIC || 'job-created';

// Lazy-initialize topic reference
let topic: Topic | null = null;

function getTopic(): Topic {
  if (!topic) {
    topic = pubsub.topic(TOPIC_NAME);
  }
  return topic;
}

/**
 * Message payload for job creation events (kept for stale job recovery)
 */
export interface JobCreatedMessage {
  jobId: string;
  createdAt: string;
}

/**
 * Message payload for individual simulation tasks.
 * In the per-simulation architecture, 1 Pub/Sub message = 1 simulation.
 */
export interface SimulationTaskMessage {
  type: 'simulation';
  jobId: string;
  simId: string;       // e.g. "sim_007"
  simIndex: number;    // 0-based
  totalSims: number;
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
 * Publish N simulation task messages to Pub/Sub (one per simulation).
 * Each message triggers a worker to run a single simulation container.
 */
export async function publishSimulationTasks(jobId: string, totalSims: number): Promise<void> {
  const topic = getTopic();
  const promises = Array.from({ length: totalSims }, (_, i) => {
    const msg: SimulationTaskMessage = {
      type: 'simulation',
      jobId,
      simId: `sim_${String(i).padStart(3, '0')}`,
      simIndex: i,
      totalSims,
    };
    return topic.publishMessage({ json: msg });
  });
  await Promise.all(promises);
  console.log(`Published ${totalSims} simulation task messages for job ${jobId}`);
}

export { pubsub, TOPIC_NAME };
