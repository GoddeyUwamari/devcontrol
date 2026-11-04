/**
 * Unit tests for the post-connect permission check (connect-permission-check.ts):
 * the three states, strict attribution of "denied", timeouts, no AWS call
 * without credentials, and no AWS text in the result.
 */
import { DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import {
  PERMISSION_CHECKS,
  permissionStatusOf,
  runPermissionCheck,
  type ProbeClients,
} from '../connect-permission-check';

const ACTIONS = [
  'ec2:DescribeRegions',
  's3:ListAllMyBuckets',
  'lambda:ListFunctions',
  'cloudwatch:GetMetricData',
  'ce:GetCostAndUsage',
  'resource-explorer-2:Search',
];

function awsError(name: string, status?: number): Error {
  const error = new Error('User: arn:aws:sts::123456789012:assumed-role/DevControlRole/x is not authorized') as Error & Record<string, unknown>;
  error.name = name;
  if (status) error.$metadata = { httpStatusCode: status };
  return error;
}

type Mocks = Record<keyof ProbeClients, jest.Mock>;

/** Probe clients whose send() is a mock; `mocks` exposes those mocks by client name. */
function clients(overrides: Partial<Mocks> = {}): ProbeClients & { mocks: Mocks } {
  const ok = () => jest.fn().mockResolvedValue({});
  // DescribeRegions must list the home region as enabled, as AWS does.
  const regions = () => jest.fn().mockResolvedValue({ Regions: [{ RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required', Endpoint: 'ec2.us-east-1.amazonaws.com' }] });
  const mocks: Mocks = {
    ec2: regions(), s3: ok(), lambda: ok(), cloudWatch: ok(), costExplorer: ok(), resourceExplorer: ok(),
    ...overrides,
  };
  const wrapped = Object.fromEntries(Object.entries(mocks).map(([k, send]) => [k, { send }])) as unknown as ProbeClients;
  return Object.assign(wrapped, { mocks });
}

let warnSpy: jest.SpyInstance;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

const creds = { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret-example', sessionToken: 'token-example' };

describe('permissionStatusOf', () => {
  it.each(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation'])('%s is denied', (name) => {
    expect(permissionStatusOf(awsError(name))).toBe('denied');
  });
  it.each([
    ['a bare 403 with another name', awsError('Forbidden', 403)],
    ['AuthFailure (a credential problem, not a permission)', awsError('AuthFailure')],
    ['throttling', awsError('ThrottlingException')],
    ['a timeout', awsError('TimeoutError')],
    ['no Resource Explorer view', awsError('ResourceNotFoundException')],
    ['a non-error value', undefined],
  ])('%s is not_verified', (_label, error) => {
    expect(permissionStatusOf(error)).toBe('not_verified');
  });
});

describe('runPermissionCheck', () => {
  it('tests exactly the six listed actions, in order', () => {
    expect(PERMISSION_CHECKS.map((c) => c.action)).toEqual(ACTIONS);
  });

  it('every call succeeding is verified for every action', async () => {
    const report = await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: clients() });
    expect(report.checks).toEqual(ACTIONS.map((action) => ({ action, status: 'verified' })));
  });

  it('reports each action in its own state: verified, denied and not_verified together', async () => {
    const c = clients({
      s3: jest.fn().mockRejectedValue(awsError('AccessDenied', 403)),
      ec2: jest.fn().mockRejectedValue(awsError('UnauthorizedOperation', 403)),
      resourceExplorer: jest.fn().mockRejectedValue(awsError('ResourceNotFoundException', 404)),
      costExplorer: jest.fn().mockRejectedValue(awsError('ThrottlingException', 400)),
    });
    const report = await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c });
    const byAction = Object.fromEntries(report.checks.map((e) => [e.action, e.status]));
    expect(byAction).toEqual({
      'ec2:DescribeRegions': 'denied',
      's3:ListAllMyBuckets': 'denied',
      'lambda:ListFunctions': 'verified',
      'cloudwatch:GetMetricData': 'verified',
      'ce:GetCostAndUsage': 'not_verified',
      'resource-explorer-2:Search': 'not_verified',
    });
  });

  it.each([
    ['AccessDenied', 403, 'denied'],
    ['UnauthorizedOperation', 403, 'denied'],
    ['Forbidden', 403, 'not_verified'],
    ['AuthFailure', 401, 'not_verified'],
    ['UnrecognizedClientException', 400, 'not_verified'],
    ['RequestLimitExceeded', 503, 'not_verified'],
  ])('ec2:DescribeRegions follows the same narrow rule: %s (%s) is %s', async (name, status, expected) => {
    const c = clients({ ec2: jest.fn().mockRejectedValue(awsError(name, status)) });
    const report = await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c });
    expect(report.checks.find((e) => e.action === 'ec2:DescribeRegions')!.status).toBe(expected);
  });

  it('ec2:DescribeRegions answered without the home region is not_verified, never denied', async () => {
    const c = clients({ ec2: jest.fn().mockResolvedValue({ Regions: [] }) });
    const report = await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c });
    expect(report.checks.find((e) => e.action === 'ec2:DescribeRegions')!.status).toBe('not_verified');
  });

  it('no credentials: no AWS call at all, and every action is not_verified', async () => {
    const report = await runPermissionCheck({ credentials: null, region: 'us-east-1', context: 'test' });
    expect(report.checks).toEqual(ACTIONS.map((action) => ({ action, status: 'not_verified' })));
  });

  it('a call that hangs is not_verified after the timeout, and the others still report', async () => {
    jest.useFakeTimers();
    try {
      const c = clients({ lambda: jest.fn().mockReturnValue(new Promise(() => {})) });
      const pending = runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c, timeoutMs: 5_000 });
      await jest.advanceTimersByTimeAsync(5_000);
      const report = await pending;
      expect(report.checks.find((e) => e.action === 'lambda:ListFunctions')!.status).toBe('not_verified');
      expect(report.checks.filter((e) => e.status === 'verified')).toHaveLength(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends read-only, minimal requests: DescribeRegions, and a one-day Cost Explorer window', async () => {
    const c = clients();
    await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c, now: () => Date.UTC(2026, 10, 3, 12) });
    expect(c.mocks.ec2.mock.calls[0][0]).toBeInstanceOf(DescribeRegionsCommand);
    expect(c.mocks.lambda.mock.calls[0][0].input).toEqual({ MaxItems: 1 });
    const ce = c.mocks.costExplorer.mock.calls[0][0];
    expect(ce).toBeInstanceOf(GetCostAndUsageCommand);
    expect(ce.input).toEqual({ TimePeriod: { Start: '2026-11-02', End: '2026-11-03' }, Granularity: 'DAILY', Metrics: ['UnblendedCost'] });
    for (const mock of Object.values(c.mocks)) expect(mock).toHaveBeenCalledTimes(1);
  });

  it('the result and logs carry no AWS message or account metadata', async () => {
    const c = clients({ s3: jest.fn().mockRejectedValue(awsError('AccessDenied', 403)) });
    const report = await runPermissionCheck({ credentials: creds, region: 'us-east-1', context: 'test', clients: c });
    const text = JSON.stringify(report) + JSON.stringify(warnSpy.mock.calls);
    expect(text).not.toContain('not authorized');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('secret-example');
  });
});
