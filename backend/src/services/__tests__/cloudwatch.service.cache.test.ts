/**
 * CloudWatch Scalability Phase 2A: coverage for CloudWatchService.getMetrics()'s
 * response cache and in-flight promise deduplication.
 *
 * This spies on CloudWatchService.prototype['computeMetrics'] (the private method
 * getMetrics() was split into during this phase -- the exact pre-Phase-2A getMetrics()
 * body, renamed and otherwise untouched) rather than mocking the full AWS/Postgres
 * chain, matching this codebase's own established convention for testing an
 * orchestration layer independently of the thing it orchestrates (see
 * optimization-rule-configuration.controller.test.ts's use of
 * jest.spyOn(OptimizationRuleConfigService.prototype, ...)). computeMetrics() itself is
 * already covered by cloudwatch.service.eks.test.ts / cloudwatch.service.slo.test.ts and
 * is not re-tested here -- this file proves only the caching wrapper's own behavior:
 * when it calls computeMetrics() versus reuses a stored/in-flight result.
 */
import { CloudWatchService, CloudWatchMetrics } from '../cloudwatch.service';

function metricsFixture(overrides: Partial<CloudWatchMetrics> = {}): CloudWatchMetrics {
  return {
    accountId: 'acct-1',
    nickname: null,
    region: 'us-east-1',
    uptime: 99.9,
    avgResponseTimeMs: null,
    requestsPerMinute: null,
    errorRate: null,
    monthlyCost: null,
    trendPercent: null,
    responseTimeHistory: [],
    coverage: { ec2: true, loadBalancer: false, rds: false, lambda: false, dynamodb: false, ecs: false, eks: false, ebs: false, cloudfront: false },
    resourceCounts: {
      ec2: { shown: 1, total: 1 },
      loadBalancer: { shown: 0, total: 0 },
      rds: { shown: 0, total: 0 },
      lambda: { shown: 0, total: 0 },
      dynamodb: { shown: 0, total: 0 },
      ecs: { shown: 0, total: 0 },
      eks: { shown: 0, total: 0 },
      ebs: { shown: 0, total: 0 },
      cloudfront: { shown: 0, total: 0 },
    },
    // CloudWatch Scalability Phase 2D: complete-fleet aggregate fields, required on
    // every CloudWatchMetrics -- this cache-layer test doesn't exercise their
    // computation (that's covered by cloudwatch.service.fleet-pagination.test.ts), so
    // an all-zero/healthy fixture is sufficient here.
    healthSummary: { total: 0, healthy: 0, degraded: 0, critical: 0, down: 0, monitored: 0 },
    systemStatus: 'healthy',
    services: [],
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CloudWatchService.getMetrics — response cache (Phase 2A)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('(1) first request is a cache miss and executes computeMetrics()', async () => {
    const service = new CloudWatchService();
    const fixture = metricsFixture();
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fixture);

    const result = await service.getMetrics('org-1', '1h');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('org-1', '1h');
    expect(result).toBe(fixture);
  });

  it('(2) an identical request within 45 seconds is a cache hit -- computeMetrics() is not called again', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new CloudWatchService();
    const fixture = metricsFixture();
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fixture);

    const first = await service.getMetrics('org-1', '1h');
    jest.setSystemTime(new Date('2026-01-01T00:00:30.000Z')); // +30s, under the 45s TTL
    const second = await service.getMetrics('org-1', '1h');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('(3) different organization IDs never share a cached result', async () => {
    const service = new CloudWatchService();
    const orgAResult = metricsFixture({ accountId: 'org-a-account' });
    const orgBResult = metricsFixture({ accountId: 'org-b-account' });
    const spy = jest
      .spyOn(CloudWatchService.prototype as any, 'computeMetrics')
      .mockImplementation(async (orgId: any) => (orgId === 'org-a' ? orgAResult : orgBResult));

    const a = await service.getMetrics('org-a', '1h');
    const b = await service.getMetrics('org-b', '1h');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(a).toEqual(orgAResult);
    expect(b).toEqual(orgBResult);
    expect(a).not.toBe(b);
  });

  it('(4) different ranges for the same organization never share a cached result', async () => {
    const service = new CloudWatchService();
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(metricsFixture());

    await service.getMetrics('org-1', '1h');
    await service.getMetrics('org-1', '7d');
    await service.getMetrics('org-1', undefined); // resolves to the default range ('1h') -- must share org-1's '1h' entry, not be a third slot

    // '1h' (explicit) and undefined (defaults to '1h') collapse to the same resolved-range
    // cache key -- 2 distinct computeMetrics() calls total: one for '1h', one for '7d'.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('(5) cache expiry after the 45s TTL causes a fresh evaluation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new CloudWatchService();
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(metricsFixture());

    await service.getMetrics('org-1', '1h');
    jest.setSystemTime(new Date('2026-01-01T00:00:46.000Z')); // +46s, past the 45s TTL
    await service.getMetrics('org-1', '1h');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('(6) concurrent identical requests execute computeMetrics() exactly once (in-flight dedup)', async () => {
    const service = new CloudWatchService();
    let resolveFetch: (value: CloudWatchMetrics) => void;
    const pending = new Promise<CloudWatchMetrics>((resolve) => { resolveFetch = resolve; });
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockReturnValue(pending);

    const call1 = service.getMetrics('org-1', '1h');
    const call2 = service.getMetrics('org-1', '1h');
    const fixture = metricsFixture();
    resolveFetch!(fixture);
    const [result1, result2] = await Promise.all([call1, call2]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result1).toBe(fixture);
    expect(result2).toBe(fixture);
  });

  it('(7) concurrent requests for different organizations remain isolated, each executing its own computation', async () => {
    const service = new CloudWatchService();
    const spy = jest
      .spyOn(CloudWatchService.prototype as any, 'computeMetrics')
      .mockImplementation(async (orgId: any) => metricsFixture({ accountId: orgId }));

    const [a, b] = await Promise.all([
      service.getMetrics('org-a', '1h'),
      service.getMetrics('org-b', '1h'),
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(a?.accountId).toBe('org-a');
    expect(b?.accountId).toBe('org-b');
  });

  it('(8) manual refresh (forceRefresh) bypasses an existing cached response', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new CloudWatchService();
    const first = metricsFixture({ accountId: 'first' });
    const second = metricsFixture({ accountId: 'second' });
    const spy = jest
      .spyOn(CloudWatchService.prototype as any, 'computeMetrics')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const cached = await service.getMetrics('org-1', '1h');
    jest.setSystemTime(new Date('2026-01-01T00:00:05.000Z')); // well within the 45s TTL
    const refreshed = await service.getMetrics('org-1', '1h', true);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(cached?.accountId).toBe('first');
    expect(refreshed?.accountId).toBe('second');

    // The forced refresh's fresh result is itself now cached -- a subsequent
    // non-forced call reuses it rather than triggering a third computation.
    const afterRefresh = await service.getMetrics('org-1', '1h');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(afterRefresh?.accountId).toBe('second');
  });

  it('(9) a rejected underlying computation is not cached', async () => {
    const service = new CloudWatchService();
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.getMetrics('org-1', '1h')).rejects.toThrow('ECONNREFUSED');

    // Nothing was cached for the failed attempt -- confirmed by test (10) below needing
    // a second computeMetrics() call to succeed, not silently returning a cached error.
  });

  it('(10) after a rejected request, a subsequent request executes successfully (in-flight entry was cleared)', async () => {
    const service = new CloudWatchService();
    const fixture = metricsFixture();
    const spy = jest
      .spyOn(CloudWatchService.prototype as any, 'computeMetrics')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(fixture);

    await expect(service.getMetrics('org-1', '1h')).rejects.toThrow('ECONNREFUSED');
    const result = await service.getMetrics('org-1', '1h');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toBe(fixture);
  });

  it('(11) existing response semantics are unchanged -- getMetrics() returns exactly what computeMetrics() resolved, including null for a genuinely unconnected org', async () => {
    const service = new CloudWatchService();
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(null);

    const result = await service.getMetrics('org-1', '1h');

    expect(result).toBeNull();
  });
});
