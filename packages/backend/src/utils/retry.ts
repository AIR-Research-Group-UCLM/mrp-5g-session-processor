import { logger } from "../config/logger.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_RETRIES = 3;

export interface RetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  operationName: string;
  sessionId?: string;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class MaxRetriesExceededError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = "MaxRetriesExceededError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Execute a function with timeout and retry logic.
 * - Timeout: 10 minutes by default
 * - Retries: 3 attempts by default
 * - If all retries fail, throws MaxRetriesExceededError
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    operationName,
    sessionId,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(
        { sessionId, operationName, attempt, maxRetries },
        `Starting ${operationName} (attempt ${attempt}/${maxRetries})`
      );

      const result = await withTimeout(fn(), timeoutMs, operationName);

      if (attempt > 1) {
        logger.info(
          { sessionId, operationName, attempt },
          `${operationName} succeeded after ${attempt} attempts`
        );
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isTimeout = lastError instanceof TimeoutError;

      logger.warn(
        {
          sessionId,
          operationName,
          attempt,
          maxRetries,
          error: lastError.message,
          isTimeout,
        },
        `${operationName} failed on attempt ${attempt}/${maxRetries}`
      );

      if (attempt < maxRetries) {
        // Wait a bit before retrying (exponential backoff: 1s, 2s, 4s)
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        logger.info(
          { sessionId, operationName, delayMs },
          `Waiting ${delayMs}ms before retry`
        );
        await sleep(delayMs);
      }
    }
  }

  logger.error(
    {
      sessionId,
      operationName,
      attempts: maxRetries,
      lastError: lastError?.message,
    },
    `${operationName} failed after ${maxRetries} attempts`
  );

  throw new MaxRetriesExceededError(
    `${operationName} failed after ${maxRetries} attempts: ${lastError?.message}`,
    maxRetries,
    lastError!
  );
}

/**
 * Wrap a promise with a timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          `${operationName} timed out after ${timeoutMs / 1000 / 60} minutes`
        )
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
