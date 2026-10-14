import {
  AwsCallPolicy,
  AwsCallTimeoutError,
  DEFAULT_AWS_CALL_POLICY,
  backoffDelayMs,
  callWithPolicy,
  isThrottlingError,
  mapWithConcurrency,
  withCallPolicy,
} from '../awsCallPolicy';

const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name }, extra);

/** The default policy with backoff recorded instead of waited out. */
function testPolicy(overrides: Partial<AwsCallPolicy> = {}) {
  const slept: number[] = [];
  const policy: AwsCallPolicy = { ...DEFAULT_AWS_CALL_POLICY, sleep: async (ms) => { slept.push(ms); }, random: () => 0, ...overrides };
  return { policy, slept };
}

describe('the default policy', () => {
  it('bounds concurrency to between 5 and 10, limits each call, and makes at most 2 attempts (6 requests with the SDK\'s own 3)', () => {
    expect(DEFAULT_AWS_CALL_POLICY.concurrency).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_AWS_CALL_POLICY.concurrency).toBeLessThanOrEqual(10);
    expect(DEFAULT_AWS_CALL_POLICY.timeoutMs).toBe(15_000);
    expect(DEFAULT_AWS_CALL_POLICY.maxAttempts).toBe(2);
    const SDK_DEFAULT_ATTEMPTS = 3;
    expect(DEFAULT_AWS_CALL_POLICY.maxAttempts * SDK_DEFAULT_ATTEMPTS).toBeLessThanOrEqual(6);
  });
});

describe('isThrottlingError', () => {
  it.each([
    ['Throttling'], ['ThrottlingException'], ['RequestLimitExceeded'], ['SlowDown'], ['TooManyRequestsException'],
    ['RequestThrottled'], ['EC2ThrottledException'], ['ProvisionedThroughputExceededException'],
  ])('%s is throttling', (name) => {
    expect(isThrottlingError(awsError(name))).toBe(true);
  });

  it('recognises the SDK\'s own marker and HTTP 429', () => {
    expect(isThrottlingError(awsError('Other', { $retryable: { throttling: true } }))).toBe(true);
    expect(isThrottlingError(awsError('Other', { $metadata: { httpStatusCode: 429 } }))).toBe(true);
    expect(isThrottlingError({ Code: 'SlowDown' })).toBe(true);
  });

  it.each([['AccessDenied'], ['UnauthorizedOperation'], ['NoSuchTagSet'], ['NoSuchBucket'], ['InternalError'], ['AwsCallTimeoutError']])('%s is not', (name) => {
    expect(isThrottlingError(awsError(name))).toBe(false);
  });

  it('nothing is not', () => {
    expect(isThrottlingError(undefined)).toBe(false);
    expect(isThrottlingError(new Error('socket hang up'))).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  const policy = { baseDelayMs: 200, maxDelayMs: 5_000 };
  it('doubles per retry and is capped', () => {
    expect([1, 2, 3, 4, 5, 6].map((retry) => backoffDelayMs(retry, { ...policy, random: () => 0 }))).toEqual([200, 400, 800, 1600, 3200, 5000]);
  });
  it('adds up to 50% jitter', () => {
    expect(backoffDelayMs(1, { ...policy, random: () => 1 })).toBe(300);
    expect(backoffDelayMs(2, { ...policy, random: () => 0.5 })).toBe(500);
  });
});

describe('callWithPolicy', () => {
  it('returns the result of a call that succeeds, with no wait', async () => {
    const { policy, slept } = testPolicy();
    expect(await callWithPolicy(async () => 'ok', policy)).toBe('ok');
    expect(slept).toEqual([]);
  });

  it('retries a throttled call with growing backoff, then returns its result', async () => {
    const { policy, slept } = testPolicy({ maxAttempts: 4 });
    const call = jest.fn()
      .mockRejectedValueOnce(awsError('SlowDown'))
      .mockRejectedValueOnce(awsError('SlowDown'))
      .mockResolvedValue('ok');
    expect(await callWithPolicy(call, policy)).toBe('ok');
    expect(call).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([200, 400]);
  });

  it('gives up after maxAttempts and throws the throttling error', async () => {
    const { policy, slept } = testPolicy();
    const call = jest.fn().mockRejectedValue(awsError('RequestLimitExceeded'));
    await expect(callWithPolicy(call, policy)).rejects.toMatchObject({ name: 'RequestLimitExceeded' });
    // The default: one retry, after one backoff.
    expect(call).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([200]);
  });

  it.each([['AccessDenied'], ['NoSuchTagSet'], ['InternalError']])('does not retry %s', async (name) => {
    const { policy, slept } = testPolicy();
    const call = jest.fn().mockRejectedValue(awsError(name));
    await expect(callWithPolicy(call, policy)).rejects.toMatchObject({ name });
    expect(call).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('abandons a call that runs past the time limit, aborts its request, and does not retry it', async () => {
    const { policy } = testPolicy({ timeoutMs: 30 });
    let aborted = false;
    const call = jest.fn((signal: AbortSignal) => new Promise<string>(() => { signal.addEventListener('abort', () => { aborted = true; }); }));
    await expect(callWithPolicy(call, policy)).rejects.toBeInstanceOf(AwsCallTimeoutError);
    expect(aborted).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('a call that finishes in time is not aborted afterwards', async () => {
    const { policy } = testPolicy({ timeoutMs: 30 });
    let signalSeen: AbortSignal | undefined;
    await callWithPolicy(async (signal) => { signalSeen = signal; return 'ok'; }, policy);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signalSeen?.aborted).toBe(false);
  });
});

describe('withCallPolicy', () => {
  class FakeClient {
    calls: Array<{ command: unknown; options: any }> = [];
    answers: Array<() => unknown> = [];
    async send(command: unknown, options?: any) {
      this.calls.push({ command, options });
      const answer = this.answers.shift();
      return answer ? answer() : 'ok';
    }
  }

  it('is still an instance of the client it wraps, so the SDK paginators accept it', () => {
    const client = new FakeClient();
    expect(withCallPolicy(client, testPolicy().policy)).toBeInstanceOf(FakeClient);
  });

  it('sends through the same client, passing an abort signal and keeping the caller\'s options', async () => {
    const client = new FakeClient();
    await withCallPolicy(client, testPolicy().policy).send('command', { requestTimeout: 5 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].command).toBe('command');
    expect(client.calls[0].options.requestTimeout).toBe(5);
    expect(client.calls[0].options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('retries a throttled send', async () => {
    const client = new FakeClient();
    client.answers = [() => { throw awsError('ThrottlingException'); }, () => 'second'];
    expect(await withCallPolicy(client, testPolicy().policy).send('command')).toBe('second');
    expect(client.calls).toHaveLength(2);
  });

  it('leaves something that is not a client alone', () => {
    const notAClient = {} as any;
    expect(withCallPolicy(notAClient)).toBe(notAClient);
    expect(withCallPolicy(undefined as any)).toBeUndefined();
  });
});

describe('mapWithConcurrency', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

  it('returns results in the order of the items', async () => {
    const results = await mapWithConcurrency([30, 5, 20, 1], 2, async (ms) => { await new Promise((r) => setTimeout(r, ms)); return ms * 2; });
    expect(results).toEqual([60, 10, 40, 2]);
  });

  it.each([[1], [5], [8]])('never runs more than %i at once, and does run that many', async (limit) => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), limit, async () => {
      peak = Math.max(peak, ++inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBe(limit);
  });

  it('handles no items, and fewer items than the limit', async () => {
    expect(await mapWithConcurrency([], 8, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 8, async (x) => x + 1)).toEqual([2, 3]);
  });

  it('one item that throws does not stop the others; the error surfaces once they have finished', async () => {
    const done: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { await tick(); if (n === 2) throw new Error('boom'); done.push(n); return n; })
    ).rejects.toThrow('boom');
    expect(done.sort()).toEqual([1, 3, 4, 5]);
  });
});
