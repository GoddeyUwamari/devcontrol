/**
 * Multi-region PR 1: one region's run (region-run.ts), without a database.
 *   - each failure keeps its own reason code (A2);
 *   - a region's status and code from its listings; a deadline overrides;
 *   - the throttle breaker halves the region's pool, never below the floor, and
 *     never stops anything (A1);
 *   - the deadline aborts the region's calls (through the call policy);
 *   - the region pool: bounded, in order, and no region started once the budget is out;
 *   - the structured log line names the organization's internal id only (A7).
 * Placeholders only.
 */
import { AwsCallTimeoutError, DEFAULT_AWS_CALL_POLICY, mapWithDynamicConcurrency, withCallPolicy } from '../../utils/awsCallPolicy';
import {
  CloudWatchCallCounter,
  NestedRegionStepError,
  RegionDeadlineError,
  RegionRun,
  ScanDeadline,
  ScanDeadlineError,
  StepLimiter,
  isRegionDeadline,
  isScanDeadline,
  SCAN_BUDGET_RESULT,
  classifyRegionFailure,
  notStartedLogLine,
  regionFailed,
  regionScanResult,
  runRegionPool,
} from '../region-run';

const ACCOUNT = '123456789012';
const named = (name: string, message = `placeholder ${name}`) => Object.assign(new Error(message), { name });

describe('classifyRegionFailure: one reason code per cause, none merged', () => {
  it.each([
    ['the region deadline', new RegionDeadlineError('eu-west-1'), 'timed_out', 'region_deadline'],
    ['a call past its 15 s limit', new AwsCallTimeoutError(15_000), 'timed_out', 'call_timeout'],
    ['throttled after its retries', named('ThrottlingException'), 'timed_out', 'throttled'],
    ['EC2 RequestLimitExceeded', named('RequestLimitExceeded'), 'timed_out', 'throttled'],
    ['AuthFailure (enabled, not ready)', named('AuthFailure'), 'failed', 'region_not_ready'],
    ['UnrecognizedClientException', named('UnrecognizedClientException'), 'failed', 'region_not_ready'],
    ['OptInRequired', named('OptInRequired'), 'failed', 'region_not_ready'],
    ['AccessDenied', named('AccessDeniedException', `User: arn:aws:sts::${ACCOUNT}:assumed-role/r/s is not authorized`), 'denied', 'access_denied'],
    ['UnauthorizedOperation', named('UnauthorizedOperation'), 'denied', 'access_denied'],
    ['HTTP 403', Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } }), 'denied', 'access_denied'],
    [
      'AccessDenied by a service control policy',
      named('AccessDeniedException', 'is not authorized to perform: ec2:DescribeInstances with an explicit deny in a service control policy'),
      'denied',
      'access_denied_scp',
    ],
    ['any other error', named('InternalError'), 'failed', 'error'],
    ['not an Error at all', 'boom', 'failed', 'error'],
  ])('%s -> %s %s', (_label, error, status, reason) => {
    expect(classifyRegionFailure(error)).toEqual({ status, reason });
  });
});

describe('regionScanResult', () => {
  const ok = (source: string) => ({ source, status: 'complete' as const });

  it('every listing complete: ok, no code', () => {
    expect(regionScanResult(['ec2', 'ebs', 'rds'].map(ok), false)).toEqual({ status: 'ok', errorCode: null });
  });

  it('the worst failure wins and keeps its own code; a service control policy explains every refusal', () => {
    expect(regionScanResult([ok('ec2'), { source: 'rds', status: 'denied', reason: 'access_denied' }], false)).toEqual({ status: 'denied', errorCode: 'access_denied' });
    expect(
      regionScanResult([{ source: 'ec2', status: 'denied', reason: 'access_denied' }, { source: 'rds', status: 'denied', reason: 'access_denied_scp' }], false)
    ).toEqual({ status: 'denied', errorCode: 'access_denied_scp' });
    expect(regionScanResult([{ source: 'ec2', status: 'failed', reason: 'region_not_ready' }, { source: 'rds', status: 'timed_out', reason: 'throttled' }], false)).toEqual({
      status: 'timed_out',
      errorCode: 'throttled',
    });
  });

  it('a cut-off listing is partial with its truncation code, as the home region\'s', () => {
    expect(regionScanResult([ok('ec2'), { source: 'ebs', status: 'truncated' }], false)).toEqual({ status: 'partial', errorCode: 'discovery_listing_truncated' });
  });

  it('a region past its deadline is timed_out region_deadline, whatever its listings said', () => {
    expect(regionScanResult(['ec2', 'ebs'].map(ok), true)).toEqual({ status: 'timed_out', errorCode: 'region_deadline' });
    expect(regionScanResult([{ source: 'ec2', status: 'denied', reason: 'access_denied' }], true)).toEqual({ status: 'timed_out', errorCode: 'region_deadline' });
  });

  it('sources that do not count (S3, CloudFront, a tier skip) make no status', () => {
    expect(regionScanResult([{ source: 's3', status: 'denied' }, { source: 'ec2', status: 'skipped_tier' }], false)).toBeNull();
  });

  it('the scan budget result, and which results count as not checked', () => {
    expect(SCAN_BUDGET_RESULT).toEqual({ status: 'timed_out', errorCode: 'scan_budget' });
    expect([null, { status: 'ok', errorCode: null }, { status: 'partial', errorCode: 'x' }].map((r) => regionFailed(r as any))).toEqual([false, false, false]);
    expect(['denied', 'timed_out', 'failed'].map((status) => regionFailed({ status: status as any, errorCode: 'x' }))).toEqual([true, true, true]);
  });
});

describe('the throttle breaker (A1)', () => {
  it('halves the pool every 5 throttles, 8 -> 4 -> 2, and stays at the floor', () => {
    const run = new RegionRun('eu-west-1', { deadlineMs: 60_000, resourcePool: 8 });
    const pools: number[] = [];
    for (let i = 1; i <= 20; i++) {
      run.onThrottle();
      pools.push(run.concurrency());
    }
    run.stop();
    expect(pools.slice(0, 4)).toEqual([8, 8, 8, 8]);
    expect(pools[4]).toBe(4);
    expect(pools[9]).toBe(2);
    expect(pools[19]).toBe(2);
    expect(run.throttles).toBe(20);
    expect(run.deadlineHit).toBe(false);
  });

  it('a pool of 1 is never raised to the floor', () => {
    const run = new RegionRun('eu-west-1', { deadlineMs: 60_000, resourcePool: 1 });
    for (let i = 0; i < 10; i++) run.onThrottle();
    run.stop();
    expect(run.concurrency()).toBe(1);
  });

  it('throttled calls through the region\'s policy trip it; the work still finishes, at the lower pool', async () => {
    const run = new RegionRun('eu-west-1', { deadlineMs: 60_000, resourcePool: 8 });
    const policy = run.policy({ ...DEFAULT_AWS_CALL_POLICY, sleep: async () => undefined });
    let throttle = 10;
    const client: { send: (command: unknown) => Promise<unknown> } = withCallPolicy(
      {
        send: async (_command: unknown) => {
          if (throttle-- > 0) throw named('ThrottlingException');
          return 'ok';
        },
      },
      policy
    );
    let inFlight = 0;
    let mostAfterBreaker = 0;
    const results = await mapWithDynamicConcurrency(Array.from({ length: 40 }, (_, i) => i), run.concurrency, async () => {
      inFlight++;
      if (run.throttles >= 10) mostAfterBreaker = Math.max(mostAfterBreaker, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const answer = await client.send({}).catch(() => 'unknown');
      inFlight--;
      return answer;
    });
    run.stop();
    expect(results).toHaveLength(40);
    expect(run.throttles).toBe(10);
    expect(run.concurrency()).toBe(2);
    expect(mostAfterBreaker).toBeLessThanOrEqual(8);
  });
});

describe('the region deadline', () => {
  it('aborts a call in flight and refuses new ones, with RegionDeadlineError', async () => {
    const run = new RegionRun('eu-west-1', { deadlineMs: 30, resourcePool: 8 });
    let aborted = false;
    const client: { send: (command: unknown, options?: any) => Promise<unknown> } = withCallPolicy(
      {
        send: (_command: unknown, options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })),
      },
      run.policy(DEFAULT_AWS_CALL_POLICY)
    );
    await expect(client.send({})).rejects.toBeInstanceOf(RegionDeadlineError);
    expect(aborted).toBe(true);
    expect(run.deadlineHit).toBe(true);
    expect(() => run.checkDeadline()).toThrow(RegionDeadlineError);
    let sent = false;
    const later = withCallPolicy({ send: async (_command: unknown) => { sent = true; return 'ok'; } }, run.policy(DEFAULT_AWS_CALL_POLICY));
    await expect(later.send({})).rejects.toBeInstanceOf(RegionDeadlineError);
    expect(sent).toBe(false);
    run.stop();
  });
});

describe('runRegionPool', () => {
  it('starts regions in order, never more than the pool at once', async () => {
    const started: string[] = [];
    let inFlight = 0;
    let most = 0;
    await runRegionPool(
      ['us-east-1', 'ap-south-1', 'eu-west-1', 'me-central-1', 'us-west-2'],
      2,
      async (region) => {
        started.push(region);
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
      () => false,
      () => { throw new Error('nothing is out of budget'); }
    );
    expect(started).toEqual(['us-east-1', 'ap-south-1', 'eu-west-1', 'me-central-1', 'us-west-2']);
    expect(most).toBe(2);
  });

  it('once the budget is out, no region starts; every one not yet started is passed on', async () => {
    const started: string[] = [];
    const notStarted: string[] = [];
    let expired = false;
    await runRegionPool(
      ['us-east-1', 'ap-south-1', 'eu-west-1'],
      1,
      async (region) => {
        started.push(region);
        expired = true;
      },
      () => expired,
      (region) => notStarted.push(region)
    );
    expect(started).toEqual(['us-east-1']);
    expect(notStarted).toEqual(['ap-south-1', 'eu-west-1']);
  });

  it('a region that throws (a lost lease) stops further starts and is rethrown once the running ones end', async () => {
    const started: string[] = [];
    const error = new Error('lease lost');
    await expect(
      runRegionPool(
        ['us-east-1', 'ap-south-1', 'eu-west-1'],
        1,
        async (region) => {
          started.push(region);
          if (region === 'us-east-1') throw error;
        },
        () => false,
        () => undefined
      )
    ).rejects.toBe(error);
    expect(started).toEqual(['us-east-1']);
  });
});

describe('the structured log line (A7)', () => {
  it('names the organization\'s internal id, the region and counts only', () => {
    const run = new RegionRun('eu-west-1', { deadlineMs: 60_000, resourcePool: 8, now: () => 1_000 });
    run.onCall({ constructor: { name: 'GetMetricDataCommand' }, input: { MetricDataQueries: [{}, {}, {}] } } as unknown);
    run.onCall(new (class GetMetricStatisticsCommand {})());
    run.stop();
    const line = JSON.parse(
      run.logLine('00000000-0000-4000-8000-0000000000c1', { status: 'denied', errorCode: 'access_denied', diagnostic: 'resource-explorer:Search:AccessDeniedException' })
    );
    expect(line).toEqual({
      event: 'discovery_region_scan',
      organization_id: '00000000-0000-4000-8000-0000000000c1',
      region: 'eu-west-1',
      duration_ms: 0,
      listings: 0,
      calls: 2,
      throttles: 0,
      resource_pool: 8,
      outcome: 'denied',
      reason: 'access_denied',
      // Region-access PR 1: the failing call by source, operation and AWS error name only.
      diagnostic: 'resource-explorer:Search:AccessDeniedException',
      get_metric_data_metrics: 3,
      get_metric_statistics_requests: 1,
      // PR 1b item 7: another region than the home one: the cost pass makes no call there.
      cost_pass_get_metric_data_metrics: 0,
      cost_pass_get_metric_statistics_requests: 0,
    });
    expect(JSON.parse(notStartedLogLine('00000000-0000-4000-8000-0000000000c1', 'us-west-2'))).toMatchObject({ outcome: 'timed_out', reason: 'scan_budget', diagnostic: null, calls: 0 });
  });

  it('PR 1b item 7: the home line carries the cost pass\'s counts, or null when it did not run', () => {
    const run = new RegionRun('us-east-1', { deadlineMs: 60_000, resourcePool: 8, now: () => 1_000 });
    run.stop();
    const counter = new CloudWatchCallCounter();
    counter.onCall({ constructor: { name: 'GetMetricDataCommand' }, input: { MetricDataQueries: [{}, {}] } } as unknown);
    counter.onCall(new (class GetMetricStatisticsCommand {})());
    counter.onCall(new (class DescribeInstancesCommand {})());
    expect(JSON.parse(run.logLine('00000000-0000-4000-8000-0000000000c1', null, counter))).toMatchObject({
      cost_pass_get_metric_data_metrics: 2,
      cost_pass_get_metric_statistics_requests: 1,
    });
    expect(JSON.parse(run.logLine('00000000-0000-4000-8000-0000000000c1', null, null))).toMatchObject({
      cost_pass_get_metric_data_metrics: null,
      cost_pass_get_metric_statistics_requests: null,
    });
    expect(counter.calls).toBe(3);
  });

  it('counts GetMetricData metrics per request', () => {
    class GetMetricDataCommand {
      constructor(readonly input: unknown) {}
    }
    const run = new RegionRun('eu-west-1', { deadlineMs: 60_000, resourcePool: 8 });
    run.onCall(new GetMetricDataCommand({ MetricDataQueries: [{}, {}, {}] }));
    run.onCall(new GetMetricDataCommand({ MetricDataQueries: [{}] }));
    run.stop();
    expect(run.getMetricDataMetrics).toBe(4);
    expect(run.calls).toBe(2);
  });
});

describe('StepLimiter (PR 1b, M-1): a scan\'s region database steps', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('runs at most `size` steps at once, in the order they asked, and hands the slot on when a step throws', async () => {
    const limiter = new StepLimiter(1);
    const order: string[] = [];
    let active = 0;
    let most = 0;
    const step = (name: string, fail = false) =>
      limiter.run(async () => {
        active++;
        most = Math.max(most, active);
        order.push(name);
        await tick();
        active--;
        if (fail) throw new Error(`${name} failed`);
        return name;
      });
    const results = await Promise.allSettled([step('a'), step('b', true), step('c'), step('d')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(most).toBe(1);
  });

  it('refuses a step started from inside a step (it would wait for its own slot) instead of deadlocking', async () => {
    const limiter = new StepLimiter(1);
    const nested = limiter.run(() => limiter.run(async () => 'inner'));
    await expect(nested).rejects.toBeInstanceOf(NestedRegionStepError);
    // The slot was handed back: the next step runs.
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });

  it('a step asked for after another step ended (same async chain) is not nested', async () => {
    const limiter = new StepLimiter(1);
    await limiter.run(async () => undefined);
    await expect(limiter.run(async () => 'second')).resolves.toBe('second');
  });
});

describe('ScanDeadline (PR 1b, M-2): the whole scan\'s deadline', () => {
  it('by the clock: a step may start before it and not after; one that ran across it is stopped; each recorded once, in order', () => {
    let now = 0;
    const deadline = new ScanDeadline(50 * 60_000, 0, () => now);
    expect(deadline.mayStart('compliance')).toBe(true);
    now = 49 * 60_000;
    expect(deadline.stoppedDuring('compliance')).toBe(false);
    expect(deadline.remainingMs()).toBe(60_000);
    expect(deadline.mayStart('iam')).toBe(true);
    now = 50 * 60_000;
    expect(deadline.stoppedDuring('iam')).toBe(true);
    expect(deadline.mayStart('cost')).toBe(false);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.timeouts).toEqual([{ step: 'iam', phase: 'not_finished' }, { step: 'cost', phase: 'not_started' }]);
    // Passing by the clock aborts the signal too: calls made under policy() stop.
    expect(deadline.signal.aborted).toBe(true);
    deadline.stop();
  });

  it('by the timer: the signal is aborted with ScanDeadlineError, and a call under its policy stops', async () => {
    const deadline = new ScanDeadline(30, Date.now());
    const client = withCallPolicy({ send: (_command: unknown) => new Promise(() => undefined) }, deadline.policy({ ...DEFAULT_AWS_CALL_POLICY, timeoutMs: 10_000 }));
    const error = await client.send({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanDeadlineError);
    expect(deadline.expired()).toBe(true);
    deadline.stop();
  });

  it('is its own outcome: never a region deadline, a region failure code or a lost lease', () => {
    const error = new ScanDeadlineError('cost');
    expect(isScanDeadline(error)).toBe(true);
    expect(isRegionDeadline(error)).toBe(false);
    expect(isScanDeadline(new RegionDeadlineError('eu-west-1'))).toBe(false);
    expect(error.name).toBe('ScanDeadlineError');
  });
});

describe('region-log-context (PR 1b, L-3)', () => {
  it('inside a region run (across awaits) the safe text; outside, the original text unchanged', async () => {
    const { inRegionLogContext, regionSafe, errorNameOf, inRegionRun } = await import('../region-log-context');
    const error = Object.assign(new Error('User: arn:aws:sts::123456789012:assumed-role/x is not authorized'), { name: 'AccessDeniedException' });
    expect(regionSafe(error.message, errorNameOf(error))).toBe(error.message);
    expect(inRegionRun()).toBe(false);
    const inside = await inRegionLogContext('eu-west-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return regionSafe(error.message, errorNameOf(error));
    });
    expect(inside).toBe('AccessDeniedException');
    expect(errorNameOf('a string')).toBe('Error');
    expect(inRegionRun()).toBe(false);
  });
});
