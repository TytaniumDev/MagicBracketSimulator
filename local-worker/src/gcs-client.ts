/**
 * GCS Client - ported from misc-runner/gcs/upload.go
 * Uploads job artifacts to Google Cloud Storage
 */

import { Storage } from '@google-cloud/storage';

export class GCSClient {
  private bucket: ReturnType<Storage['bucket']>;
  private bucketName: string;

  constructor(bucketName: string) {
    const storage = new Storage();
    this.bucket = storage.bucket(bucketName);
    this.bucketName = bucketName;
  }

  /**
   * Upload an artifact for a job
   */
  async uploadJobArtifact(
    jobId: string,
    filename: string,
    data: Buffer | string
  ): Promise<string> {
    const objectPath = `jobs/${jobId}/${filename}`;
    const file = this.bucket.file(objectPath);

    // Determine content type
    let contentType = 'application/octet-stream';
    if (filename.endsWith('.json')) {
      contentType = 'application/json';
    } else if (filename.endsWith('.txt')) {
      contentType = 'text/plain';
    }

    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

    await file.save(buffer, {
      contentType,
      metadata: {
        jobId,
      },
    });

    return `gs://${this.bucketName}/${objectPath}`;
  }

  /**
   * Upload JSON data for a job
   */
  async uploadJSON(
    jobId: string,
    filename: string,
    data: unknown
  ): Promise<string> {
    const jsonString = JSON.stringify(data, null, 2);
    return this.uploadJobArtifact(jobId, filename, jsonString);
  }

  /**
   * Upload raw game logs for a job
   */
  async uploadRawLogs(jobId: string, logs: string[]): Promise<string[]> {
    const uris: string[] = [];
    for (let i = 0; i < logs.length; i++) {
      const filename = `raw/game_${String(i + 1).padStart(3, '0')}.txt`;
      const uri = await this.uploadJobArtifact(jobId, filename, logs[i]);
      uris.push(uri);
    }
    return uris;
  }

  /**
   * Get a job artifact (for testing/debugging)
   */
  async getJobArtifact(
    jobId: string,
    filename: string
  ): Promise<Buffer | null> {
    const objectPath = `jobs/${jobId}/${filename}`;
    const file = this.bucket.file(objectPath);

    try {
      const [exists] = await file.exists();
      if (!exists) {
        return null;
      }

      const [contents] = await file.download();
      return contents;
    } catch (error) {
      console.error(`Failed to get artifact ${objectPath}:`, error);
      return null;
    }
  }
}
