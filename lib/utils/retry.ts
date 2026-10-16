/**
 * Advanced retry utilities with exponential backoff
 * Provides intelligent retry mechanisms for API calls
 */

import { ErrorType, createAppError } from '@/lib/errors/error-types';
import { describeError } from '@/lib/safe-log';

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier?: number;
  /** Function to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback called before each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /** Callback called on final failure */
  onFinalFailure?: (error: unknown, totalAttempts: number) => void;
  /** Jitter to add randomness to delay (0-1) */
  jitter?: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onFinalFailure'>> & { onFinalFailure?: RetryOptions['onFinalFailure'] } = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: 0.1,
  shouldRetry: () => true,
  onRetry: () => {},
  onFinalFailure: undefined,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number,
  jitter: number
): number {
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt - 1);
  const clampedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter to prevent thundering herd
  if (jitter > 0) {
    const jitterAmount = clampedDelay * jitter * (Math.random() * 2 - 1);
    return Math.max(0, clampedDelay + jitterAmount);
  }

  return clampedDelay;
}

/**
 * Executes a function with automatic retry and exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if it's the last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Check if we should retry this error
      if (!opts.shouldRetry(error, attempt)) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = calculateDelay(
        attempt,
        opts.initialDelay,
        opts.maxDelay,
        opts.backoffMultiplier,
        opts.jitter
      );

      // Call retry callback
      opts.onRetry(error, attempt, delay);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Call final failure callback if provided
  if (opts.onFinalFailure) {
    opts.onFinalFailure(lastError, opts.maxAttempts);
  }

  throw lastError;
}

/**
 * Determines if an error should be retried based on its characteristics
 */
export function shouldRetryError(error: unknown): boolean {
  // Don't retry if offline (handled separately)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }

  const appError = createAppError(error);

  // Don't retry auth, permission, validation, or not found errors
  const nonRetryableTypes = [
    ErrorType.AUTH_ERROR,
    ErrorType.PERMISSION_ERROR,
    ErrorType.VALIDATION_ERROR,
    ErrorType.NOT_FOUND_ERROR,
  ];

  if (nonRetryableTypes.includes(appError.type)) {
    return false;
  }

  // For rate limit errors, we might want to retry after the specified time
  if (appError.type === ErrorType.RATE_LIMIT_ERROR && appError.retryAfter) {
    // Only retry if we can wait a reasonable amount of time
    return appError.retryAfter <= 120; // 2 minutes max wait
  }

  return appError.retryable;
}

/**
 * Retry function specifically for API calls with sensible defaults
 */
export async function retryApiCall<T>(
  fn: () => Promise<T>,
  context: string = 'API call',
  customOptions?: Partial<RetryOptions>
): Promise<T> {
  return retryWithBackoff(fn, {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: 0.15,
    shouldRetry: (error, attempt) => {
      if (!shouldRetryError(error)) {
        return false;
      }
      return attempt < 3;
    },
    onRetry: (error, attempt, delay) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(
          describeError(`[Retry] ${context} - Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms`, error)
        );
      }
    },
    ...customOptions,
  });
}

/**
 * Creates a retry wrapper that can be used with React Query or other data fetching libraries
 */
export function createRetryableQueryFn<T>(
  queryFn: () => Promise<T>,
  context: string
): () => Promise<T> {
  return async () => {
    return retryApiCall(queryFn, context);
  };
}

/**
 * Hook-friendly retry state management
 */
export interface RetryState {
  attempt: number;
  maxAttempts: number;
  isRetrying: boolean;
  nextRetryIn: number | null;
  canRetry: boolean;
}

/**
 * Creates initial retry state
 */
export function createInitialRetryState(maxAttempts: number = 3): RetryState {
  return {
    attempt: 0,
    maxAttempts,
    isRetrying: false,
    nextRetryIn: null,
    canRetry: true,
  };
}

// Legacy exports for backwards compatibility
export const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Unable to connect. Please check your internet connection.',
  AUTH_ERROR: 'Session expired. Please log in again.',
  RATE_LIMIT: 'Too many requests. Please wait a moment.',
  TIMEOUT: 'Request timed out. Please try again.',
  SERVER_ERROR: 'Our servers are experiencing issues. Please try again shortly.',
  NOT_FOUND: 'Resource not found.',
  FORBIDDEN: "You don't have permission to access this resource.",
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    for (const [key, message] of Object.entries(ERROR_MESSAGES)) {
      if (error.message.toLowerCase().includes(key.toLowerCase().replace('_', ' '))) {
        return message;
      }
    }
    return error.message;
  }
  return 'An unexpected error occurred.';
}
