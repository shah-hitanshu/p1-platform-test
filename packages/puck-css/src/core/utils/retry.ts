/**
 * Retry Utility
 *
 * Provides retry logic with exponential backoff for failed operations.
 */

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds before first retry.
   * @default 1000
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds between retries.
   * @default 10000
   */
  maxDelayMs?: number;

  /**
   * Multiplier for exponential backoff.
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Function to determine if an error should trigger a retry.
   * By default, retries on all errors.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Callback invoked before each retry attempt.
   */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Calculates the delay for a given attempt using exponential backoff.
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  // Add some jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Sleeps for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxAttempts: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    baseDelayMs = DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // On last attempt, don't check shouldRetry - just throw
      if (attempt >= maxAttempts) {
        break;
      }

      // Check if we should retry
      if (!shouldRetry(lastError, attempt)) {
        break;
      }

      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, backoffMultiplier);

      if (onRetry) {
        onRetry(lastError, attempt, delay);
      }

      await sleep(delay);
    }
  }

  // All retries exhausted or shouldRetry returned false
  throw lastError;
}
