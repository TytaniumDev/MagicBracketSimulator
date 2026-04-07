import { Storage } from '@google-cloud/storage';
import { withRetry } from './retry';

// Initialize Cloud Storage client
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const BUCKET_NAME = process.env.GCS_BUCKET || 'magic-bracket-simulator-artifacts';
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Returns true for transient network/server errors that are safe to retry.
 */
function isRetryableGcsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const RETRYABLE_MESSAGES = [
    'socket hang up',
    'econnreset',
    'etimedout',
    'econnrefused',
    'network error',
  ];
  const RETRYABLE_CODES = [429, 500, 502, 503, 504];

  const msg = error.message.toLowerCase();
  if (RETRYABLE_MESSAGES.some(retryableMsg => msg.includes(retryableMsg))) {
    return true;
  }

  const code = (error as { code?: number }).code;
  if (typeof code === 'number' && RETRYABLE_CODES.includes(code)) {
    return true;
  }

  return false;
}

/**
 * Upload a job artifact to GCS
 * @param jobId The job ID
 * @param filename The filename (e.g., 'condensed.json', 'raw/game_001.txt')
 * @param data The data to upload (string or Buffer)
 * @returns The GCS URI of the uploaded file
 */
export async function uploadJobArtifact(
  jobId: string,
  filename: string,
  data: string | Buffer
): Promise<string> {
  const objectPath = `jobs/${jobId}/${filename}`;

  const contentType = filename.endsWith('.json')
    ? 'application/json'
    : filename.endsWith('.txt')
    ? 'text/plain'
    : 'application/octet-stream';

  await withRetry(
    async () => {
      const file = bucket.file(objectPath);
      await file.save(data, {
        contentType,
        metadata: { jobId },
      });
    },
    { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
    `GCS upload ${filename}`,
    isRetryableGcsError
  );

  return `gs://${BUCKET_NAME}/${objectPath}`;
}

/**
 * Get a job artifact from GCS
 * @param jobId The job ID
 * @param filename The filename (e.g., 'condensed.json')
 * @returns The file contents as a string, or null if not found
 */
export async function getJobArtifact(
  jobId: string,
  filename: string
): Promise<string | null> {
  const objectPath = `jobs/${jobId}/${filename}`;
  const file = bucket.file(objectPath);

  try {
    const [exists] = await file.exists();
    if (!exists) return null;

    const [contents] = await file.download();
    return contents.toString('utf-8');
  } catch (error) {
    console.error(`Error downloading ${objectPath}:`, error);
    return null;
  }
}

/**
 * Get a job artifact as JSON
 * @param jobId The job ID
 * @param filename The filename (e.g., 'condensed.json')
 * @returns The parsed JSON, or null if not found
 */
export async function getJobArtifactJson<T>(
  jobId: string,
  filename: string
): Promise<T | null> {
  const contents = await getJobArtifact(jobId, filename);
  if (!contents) return null;

  try {
    return JSON.parse(contents) as T;
  } catch (error) {
    console.error(`Error parsing JSON from ${filename}:`, error);
    return null;
  }
}

/**
 * List all artifacts for a job
 * @param jobId The job ID
 * @returns Array of filenames
 */
export async function listJobArtifacts(jobId: string): Promise<string[]> {
  const prefix = `jobs/${jobId}/`;
  const [files] = await bucket.getFiles({ prefix });
  
  return files.map(file => file.name.replace(prefix, ''));
}

/**
 * Delete all artifacts for a job
 * @param jobId The job ID
 */
export async function deleteJobArtifacts(jobId: string): Promise<void> {
  const prefix = `jobs/${jobId}/`;
  
  try {
    await bucket.deleteFiles({ prefix, force: true });
  } catch (error) {
    console.error(`Error deleting artifacts for job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Upload multiple raw game logs
 * @param jobId The job ID
 * @param logs Array of raw game log contents
 * @returns Array of GCS URIs
 */
export async function uploadRawLogs(
  jobId: string,
  logs: string[]
): Promise<string[]> {
  const uploads = logs.map((log, index) => {
    const filename = `raw/game_${String(index + 1).padStart(3, '0')}.txt`;
    return uploadJobArtifact(jobId, filename, log);
  });

  return Promise.all(uploads);
}

/**
 * Get all raw game logs for a job
 * @param jobId The job ID
 * @returns Array of raw log contents
 */
export async function getRawLogs(jobId: string): Promise<string[]> {
  const artifacts = await listJobArtifacts(jobId);
  const rawLogFiles = artifacts
    .filter(f => f.startsWith('raw/') && f.endsWith('.txt'))
    .sort();

  const logs = await Promise.all(
    rawLogFiles.map(f => getJobArtifact(jobId, f))
  );

  return logs.filter((log): log is string => log !== null);
}

/**
 * Generate a signed URL for downloading an artifact
 * @param jobId The job ID
 * @param filename The filename
 * @param expiresInMinutes URL expiration time in minutes (default: 15)
 * @returns Signed URL
 */
export async function getSignedUrl(
  jobId: string,
  filename: string,
  expiresInMinutes: number = 15
): Promise<string> {
  const objectPath = `jobs/${jobId}/${filename}`;
  const file = bucket.file(objectPath);

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });

  return url;
}

/**
 * Upload the precons list as a public JSON file for direct frontend consumption.
 * Sets Cache-Control for CDN/browser caching and makes the object publicly readable.
 */
export async function uploadPreconsJson(precons: unknown[]): Promise<string> {
  const objectPath = 'precons.json';
  const file = bucket.file(objectPath);

  await withRetry(
    async () => {
      await file.save(JSON.stringify(precons), {
        contentType: 'application/json',
      });
      await file.setMetadata({
        cacheControl: 'public, max-age=3600',
      });
      await file.makePublic();
    },
    { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
    'GCS upload precons.json',
    isRetryableGcsError
  );

  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
}

export { storage, bucket, BUCKET_NAME };
