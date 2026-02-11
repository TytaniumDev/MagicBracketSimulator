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

export { pubsub, TOPIC_NAME };
