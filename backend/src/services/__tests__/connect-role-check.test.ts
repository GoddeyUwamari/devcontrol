/**
 * Unit tests for the connect flow's role check (connect-role-check.ts): which
 * AssumeRole failures are retried, the bounded backoff, the per-attempt timeout,
 * cancellation, and that logs never carry the ExternalId or AWS's message.
 */
import {
  checkConnectRole,
  classifyAssumeRoleError,
  roleCheckBackoffMs,
  type RoleCheckPolicy,
} from '../connect-role-check';
import { PlatformAwsCredentialsUnavailableError } from '../platform-sts';

const EXTERNAL_ID = 'Test_External_Id-0123456789abcdef';
const ROLE_ARN = 'arn:aws:iam::123456789012:role/DevControlRole';
const AWS_MESSAGE = 'User: arn:aws:sts::111122223333:assumed-role/platform/i-1234567890abcdef0 is not authorized to perform: sts:AssumeRole';

function awsError(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(AWS_MESSAGE) as Error & Record<string, unknown>;
  error.name = name;
  Object.assign(error, extra);
  return error;
}

/** A fake clock: sleep advances it, so elapsed-time limits are exact and instant. */
function fakePolicy(overrides: Partial<RoleCheckPolicy> = {}): RoleCheckPolicy & { sleeps: number[] } {
  let clock = 0;
  const sleeps: number[] = [];
  return {
    maxElapsedMs: 20_000,
    attemptTimeoutMs: 5_000,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    random: () => 0.999999, // the top of the jitter range: delays are ~the full value
    now: () => clock,
    sleep: async (ms: number) => { sleeps.push(ms); clock += ms; },
    sleeps,
    ...overrides,
  };
}

const okOutput = {
  Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example', Expiration: new Date() },
  $metadata: {},
};

function run(assume: jest.Mock, policy = fakePolicy(), signal?: AbortSignal) {
  return checkConnectRole({ region: 'us-east-1', roleArn: ROLE_ARN, externalId: EXTERNAL_ID, context: 'Connect AWS org test', assume, policy, signal });
}

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('classifyAssumeRoleError', () => {
  it.each([
    ['AccessDenied', 'trust_denied'],
    ['AccessDeniedException', 'trust_denied'],
    ['NoSuchEntity', 'not_found'],
    ['Throttling', 'transient'],
    ['ThrottlingException', 'transient'],
    ['TimeoutError', 'transient'],
    ['AbortError', 'transient'],
    ['NetworkingError', 'transient'],
    ['ValidationError', 'permanent'],
    ['RegionDisabledException', 'permanent'],
    ['MalformedPolicyDocument', 'permanent'],
    ['InvalidParameterValue', 'permanent'],
  ])('%s is %s', (name, kind) => {
    expect(classifyAssumeRoleError(awsError(name))).toBe(kind);
  });

  it('an AWS 5xx is transient; a 4xx with an unknown name is permanent', () => {
    expect(classifyAssumeRoleError(awsError('InternalFailure', { $metadata: { httpStatusCode: 500 } }))).toBe('transient');
    expect(classifyAssumeRoleError(awsError('SomethingElse', { $metadata: { httpStatusCode: 400 } }))).toBe('permanent');
  });

  it('socket error codes are transient', () => {
    expect(classifyAssumeRoleError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('transient');
  });

  it("the platform's own identity failure is platform, never trust_denied", () => {
    expect(classifyAssumeRoleError(new PlatformAwsCredentialsUnavailableError(awsError('AccessDenied')))).toBe('platform');
  });
});

describe('roleCheckBackoffMs', () => {
  it('doubles, caps at maxDelayMs, and jitters to 50-100 % of the value', () => {
    const p = { baseDelayMs: 1_000, maxDelayMs: 8_000 };
    expect(roleCheckBackoffMs(1, { ...p, random: () => 0 })).toBe(500);
    expect(roleCheckBackoffMs(1, { ...p, random: () => 0.999999 })).toBe(1_000);
    expect(roleCheckBackoffMs(3, { ...p, random: () => 0.999999 })).toBe(4_000);
    expect(roleCheckBackoffMs(10, { ...p, random: () => 0.999999 })).toBe(8_000);
    expect(roleCheckBackoffMs(10, { ...p, random: () => 0 })).toBe(4_000);
  });
});

describe('checkConnectRole', () => {
  it('succeeds on the first attempt and returns the temporary credentials', async () => {
    const assume = jest.fn().mockResolvedValue(okOutput);
    const result = await run(assume);
    expect(result).toEqual({
      ok: true,
      attempts: 1,
      credentials: { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret-example', sessionToken: 'token-example' },
      roleUniqueId: null, // okOutput has no AssumedRoleUser (AWS connect PR D1a reads the role ID from it)
    });
    expect(assume).toHaveBeenCalledWith(
      { RoleArn: ROLE_ARN, RoleSessionName: 'devcontrol-validation', ExternalId: EXTERNAL_ID, DurationSeconds: 900 },
      expect.any(AbortSignal)
    );
  });

  it('a success without Credentials (a mocked STS) is ok with credentials null', async () => {
    const result = await run(jest.fn().mockResolvedValue({}));
    expect(result).toEqual({ ok: true, attempts: 1, credentials: null, roleUniqueId: null });
  });

  it('IAM propagation: AccessDenied twice, then success, is ok after backoff', async () => {
    const policy = fakePolicy();
    const assume = jest.fn()
      .mockRejectedValueOnce(awsError('AccessDenied'))
      .mockRejectedValueOnce(awsError('AccessDenied'))
      .mockResolvedValueOnce(okOutput);
    const result = await run(assume, policy);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(policy.sleeps).toEqual([1_000, 2_000]);
  });

  it('AccessDenied on every attempt stops within maxElapsedMs and is role_not_assumable', async () => {
    const policy = fakePolicy();
    const assume = jest.fn().mockRejectedValue(awsError('AccessDenied'));
    const result = await run(assume, policy);
    expect(result).toEqual({ ok: false, failure: 'role_not_assumable', attempts: 5 });
    // 1 + 2 + 4 + 8 = 15 s of waiting; the next 8 s wait would pass 20 s.
    expect(policy.sleeps).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(policy.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(policy.maxElapsedMs);
  });

  it('throttling on every attempt is aws_unavailable after the same bounded window', async () => {
    const policy = fakePolicy();
    const result = await run(jest.fn().mockRejectedValue(awsError('Throttling')), policy);
    expect(result).toEqual({ ok: false, failure: 'aws_unavailable', attempts: 5 });
  });

  it.each([
    ['NoSuchEntity', 'role_not_found'],
    ['ValidationError', 'role_check_failed'],
    ['RegionDisabledException', 'role_check_failed'],
  ])('%s is never retried (%s)', async (name, failure) => {
    const policy = fakePolicy();
    const assume = jest.fn().mockRejectedValue(awsError(name));
    const result = await run(assume, policy);
    expect(result).toEqual({ ok: false, failure, attempts: 1 });
    expect(assume).toHaveBeenCalledTimes(1);
    expect(policy.sleeps).toEqual([]);
  });

  it("the platform's own identity failure is never retried", async () => {
    const policy = fakePolicy();
    const assume = jest.fn().mockRejectedValue(new PlatformAwsCredentialsUnavailableError(new Error('x')));
    const result = await run(assume, policy);
    expect(result).toEqual({ ok: false, failure: 'platform_unavailable', attempts: 1 });
    expect(assume).toHaveBeenCalledTimes(1);
  });

  it('an attempt that hangs is aborted after attemptTimeoutMs and retried as transient', async () => {
    jest.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const assume = jest.fn()
        .mockImplementationOnce((_input: unknown, signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}); })
        .mockResolvedValueOnce(okOutput);
      const policy = fakePolicy({ attemptTimeoutMs: 5_000 });
      const pending = run(assume, policy);
      await jest.advanceTimersByTimeAsync(5_000);
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(2);
      expect(signals[0].aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancellation stops retrying: no further attempt after the signal aborts', async () => {
    const controller = new AbortController();
    const policy = fakePolicy({
      sleep: async () => { controller.abort(); },
    });
    const assume = jest.fn().mockRejectedValue(awsError('AccessDenied'));
    const result = await run(assume, policy, controller.signal);
    expect(result).toEqual({ ok: false, failure: 'cancelled', attempts: 1 });
    expect(assume).toHaveBeenCalledTimes(1);
  });

  it('an already-aborted signal makes no AWS call', async () => {
    const controller = new AbortController();
    controller.abort();
    const assume = jest.fn();
    const result = await run(assume, fakePolicy(), controller.signal);
    expect(result).toEqual({ ok: false, failure: 'cancelled', attempts: 0 });
    expect(assume).not.toHaveBeenCalled();
  });

  it('logs never carry the ExternalId; only the final attempt carries the AWS message (server log only)', async () => {
    await run(jest.fn().mockRejectedValue(awsError('AccessDenied', { $metadata: { httpStatusCode: 403, requestId: 'req-1' } })));
    const calls = errorSpy.mock.calls;
    expect(calls).toHaveLength(5);
    expect(JSON.stringify(calls)).not.toContain(EXTERNAL_ID);
    for (const call of calls.slice(0, 4)) expect(JSON.stringify(call)).not.toContain('not authorized');
    expect(calls[4][0]).toBe('[Connect AWS] STS validation failed:');
    expect(calls[4][1]).toMatchObject({ name: 'AccessDenied', requestId: 'req-1', message: AWS_MESSAGE, attempts: 5 });
  });
});
