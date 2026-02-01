export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 2,
  delayMs: 2000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with bounded retries.
 * On failure, waits delayMs * (backoffMultiplier ^ attempt) then retries.
 * If isRetryable returns false for the error, no retry is attempted.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  logContext?: string,
  isRetryable?: (error: unknown) => boolean
): Promise<T> {
  const { maxAttempts, delayMs, backoffMultiplier } = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const shouldRetry =
        attempt < maxAttempts - 1 &&
        (isRetryable == null || isRetryable(err));
      if (shouldRetry) {
        const waitMs = delayMs * Math.pow(backoffMultiplier, attempt);
        const msg = logContext
          ? `[Worker] Retry ${attempt + 1}/${maxAttempts} after ${logContext}`
          : `[Worker] Retry ${attempt + 1}/${maxAttempts}`;
        console.log(msg);
        await sleep(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}
