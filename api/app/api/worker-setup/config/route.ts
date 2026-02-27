import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

const WORKER_SECRET = process.env.WORKER_SECRET;
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Validate a stateless HMAC setup token.
 * Returns true if the token is valid and not expired.
 */
function validateToken(token: string): boolean {
  if (!WORKER_SECRET) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64').toString('utf-8');
  } catch {
    return false;
  }

  const dotIndex = decoded.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = decoded.slice(0, dotIndex);
  const providedHmac = decoded.slice(dotIndex + 1);

  // Check expiry
  const tokenAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(tokenAge) || tokenAge < 0 || tokenAge > TOKEN_TTL_SECONDS) return false;

  // Timing-safe HMAC comparison
  const expectedHmac = crypto.createHmac('sha256', WORKER_SECRET)
    .update(timestamp).digest('hex').slice(0, 32);

  const providedBuf = Buffer.from(providedHmac, 'utf-8');
  const expectedBuf = Buffer.from(expectedHmac, 'utf-8');

  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * AES-256-GCM encrypt a plaintext string with the given hex key.
 */
function aesEncrypt(plaintext: string, hexKey: string): { iv: string; ciphertext: string; tag: string } {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Read the worker-host-config from the best available source:
 * 1. WORKER_HOST_CONFIG env var (injected by Cloud Run from Secret Manager)
 * 2. GCP Secret Manager API (direct access)
 */
async function readWorkerConfig(): Promise<string> {
  if (process.env.WORKER_HOST_CONFIG) {
    return process.env.WORKER_HOST_CONFIG;
  }

  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/worker-host-config/versions/latest`,
  });
  const payload = version.payload?.data;
  if (!payload) throw new Error('Empty secret payload');
  return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf-8');
}

/**
 * POST /api/worker-setup/config
 * Returns AES-256-GCM encrypted worker configuration.
 * Auth: validates X-Setup-Token header (HMAC check + 24h expiry).
 * The encryption key is provided by the caller in X-Encryption-Key header.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('X-Setup-Token');
  if (!token) {
    return errorResponse('Missing X-Setup-Token header', 401);
  }

  if (!WORKER_SECRET) {
    return errorResponse('Worker setup not configured', 500);
  }

  if (!validateToken(token)) {
    return errorResponse('Token expired or invalid. Generate a new one from the Worker Setup page.', 401);
  }

  const encryptionKey = req.headers.get('X-Encryption-Key');
  if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    return badRequestResponse('Missing or invalid X-Encryption-Key header (expected 64-char hex string)');
  }

  try {
    const secretJson = await readWorkerConfig();
    const config = JSON.parse(secretJson);
    config.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;

    const encrypted = aesEncrypt(JSON.stringify(config), encryptionKey);
    return NextResponse.json(encrypted);
  } catch (err) {
    console.error('Failed to read worker config:', err);
    return errorResponse('Failed to read worker configuration', 500);
  }
}
