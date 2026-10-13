/**
 * How discovery makes its per-resource and per-region AWS calls at scale: a bounded
 * number at a time, each with a time limit, and a throttled one retried with backoff.
 *
 * An account can hold hundreds of buckets and instances across several regions. One
 * call per resource, run one after another, is slow; run all at once, it is throttled.
 * And a single call that hangs or keeps being throttled must cost that one resource
 * its answer -- recorded as unknown -- and nothing else: it never aborts the scan.
 *
 * This module only shapes the calls. What a failed call means (unknown, never a
 * default) is decided where the call is made.
 */

export interface AwsCallPolicy {
  /** How many per-resource (or per-region) units of work run at once. */
  concurrency: number;
  /** Time limit for one attempt of one call, in milliseconds. */
  timeoutMs: number;
  /** Attempts per call, the first included. Only a throttled attempt is retried. */
  maxAttempts: number;
  /** Backoff before retry n (1-based) is baseDelayMs * 2^(n-1), plus jitter, capped at maxDelayMs. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Replaceable so a test does not have to wait out real backoff. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const DEFAULT_AWS_CALL_POLICY: AwsCallPolicy = {
  concurrency: 8,
  timeoutMs: 15_000,
  maxAttempts: 4,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/** Raised when one attempt of a call ran past the policy's time limit. Not retried. */
export class AwsCallTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AWS call exceeded ${timeoutMs} ms`);
    this.name = 'AwsCallTimeoutError';
  }
}

const THROTTLING_ERROR_NAMES = new Set([
  'Throttling',
  'ThrottlingException',
  'ThrottledException',
  'RequestThrottled',
  'RequestThrottledException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'SlowDown',
  'EC2ThrottledException',
  'PriorRequestNotComplete',
]);

/** Whether an AWS error says "slow down" (as opposed to "no", "not found" or "broken"). */
export function isThrottlingError(error: any): boolean {
  if (!error) return false;
  if (error.$retryable?.throttling === true) return true;
  if (THROTTLING_ERROR_NAMES.has(error.name) || THROTTLING_ERROR_NAMES.has(error.Code) || THROTTLING_ERROR_NAMES.has(error.code)) return true;
  return error.$metadata?.httpStatusCode === 429;
}

/** The wait before retry `retry` (1-based): exponential, jittered by up to +50%, capped. */
export function backoffDelayMs(retry: number, policy: Pick<AwsCallPolicy, 'baseDelayMs' | 'maxDelayMs' | 'random'>): number {
  const exponential = policy.baseDelayMs * 2 ** (retry - 1);
  return Math.min(policy.maxDelayMs, Math.round(exponential * (1 + policy.random() * 0.5)));
}

/**
 * Runs one AWS call under the policy: each attempt is abandoned (and its request
 * aborted through `signal`) after timeoutMs; a throttled attempt is retried after a
 * backoff, up to maxAttempts. Any other error, a timeout included, is thrown at once
 * -- the caller records that resource as unknown.
 */
export async function callWithPolicy<T>(
  call: (signal: AbortSignal) => Promise<T>,
  policy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        call(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AwsCallTimeoutError(policy.timeoutMs));
          }, policy.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (attempt >= policy.maxAttempts || !isThrottlingError(error)) throw error;
      await policy.sleep(backoffDelayMs(attempt, policy));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * A client whose every `send` goes through callWithPolicy. It is the same client
 * underneath (it inherits from it, so the SDK's paginators and `instanceof` checks
 * still accept it); only `send` is replaced. Each page of a paginated call is its own
 * call, with its own time limit and retries.
 */
export function withCallPolicy<T extends { send: (...args: any[]) => any }>(client: T, policy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY): T {
  if (!client || typeof client.send !== 'function') return client;
  const wrapped = Object.create(client) as T;
  wrapped.send = ((command: unknown, options?: Record<string, unknown>) =>
    callWithPolicy((abortSignal) => client.send(command, { ...(options ?? {}), abortSignal }), policy)) as T['send'];
  return wrapped;
}

/**
 * Runs `work` for every item, at most `concurrency` at a time, and returns the
 * results in the items' order. `work` is expected to settle every failure itself
 * (into an "unknown" result); if one does throw, the rest still run and the first
 * error is rethrown once they have all finished.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  if (errors.length > 0) throw errors[0];
  return results;
}
