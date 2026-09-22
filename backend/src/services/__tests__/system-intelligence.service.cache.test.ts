/**
 * Tier 0 shared source-of-truth: coverage for SystemIntelligenceService.
 * getSystemIntelligence()'s new 2-minute response cache and in-flight promise
 * deduplication -- the mechanism that lets the Dashboard and Infrastructure
 * page read the identical canonical score within the same short window,
 * instead of two independently-computed values on different staleness
 * windows (previously: Infrastructure page always fresh, Dashboard bound to
 * ai-summary.service.ts's own 4h cache).
 *
 * Same convention as cloudwatch.service.cache.test.ts: this spies on
 * SystemIntelligenceService.prototype['computeSystemIntelligenceUncached']
 * (the exact pre-cache getSystemIntelligence() body, renamed and otherwise
 * untouched) rather than mocking the full CloudWatch/Postgres/RiskTracking
 * chain -- that computation itself is unchanged by this work and is not
 * re-tested here. This file proves only the caching wrapper's own behavior.
 */
import { SystemIntelligenceService, SystemIntelligenceResult, ComponentScore } from '../system-intelligence.service';

function componentFixture(overrides: Partial<ComponentScore> = {}): ComponentScore {
  return {
    score: 80,
    label: 'Fixture',
    detail: 'fixture detail',
    severity: 'healthy',
    delta: null,
    status: 'good',
    ready: true,
    ...overrides,
  };
}

function intelligenceFixture(overrides: Partial<SystemIntelligenceResult> = {}): SystemIntelligenceResult {
  return {
    system_score: 80,
    status: 'Healthy',
    components: {
      cost: componentFixture({ label: 'Cost Efficiency', monthlySpend: 1000, costSource: 'actual' }),
      security: componentFixture({ label: 'Security Posture' }),
      observability: componentFixture({ label: 'Observability' }),
    },
    top_action: null,
    top_drivers: [],
    computed_at: new Date().toISOString(),
    ...overrides,
  };
}

/** A not-ready/"Pending" result -- e.g. one component's scan hasn't completed yet. */
function pendingFixture(): SystemIntelligenceResult {
  return intelligenceFixture({
    system_score: null,
    status: 'Pending',
    components: {
      cost: componentFixture({ label: 'Cost Efficiency', ready: false }),
      security: componentFixture({ label: 'Security Posture' }),
      observability: componentFixture({ label: 'Observability' }),
    },
  });
}

describe('SystemIntelligenceService.getSystemIntelligence — response cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('(1) first request is a cache miss and executes the uncached computation', async () => {
    const service = new SystemIntelligenceService();
    const fixture = intelligenceFixture();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValue(fixture);

    const result = await service.getSystemIntelligence('org-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('org-1');
    expect(result).toBe(fixture);
  });

  it('(2) an identical request within 2 minutes is a cache hit -- the uncached computation is not called again', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new SystemIntelligenceService();
    const fixture = intelligenceFixture();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValue(fixture);

    const first = await service.getSystemIntelligence('org-1');
    jest.setSystemTime(new Date('2026-01-01T00:01:30.000Z')); // +90s, under the 2min TTL
    const second = await service.getSystemIntelligence('org-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('(3) different organization IDs never share a cached result', async () => {
    const service = new SystemIntelligenceService();
    const orgAResult = intelligenceFixture({ system_score: 90 });
    const orgBResult = intelligenceFixture({ system_score: 40 });
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockImplementation(async (orgId: any) => (orgId === 'org-a' ? orgAResult : orgBResult));

    const a = await service.getSystemIntelligence('org-a');
    const b = await service.getSystemIntelligence('org-b');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(a.system_score).toBe(90);
    expect(b.system_score).toBe(40);
    expect(a).not.toBe(b);
  });

  it('(4) cache expiry after the 2-minute TTL causes a fresh evaluation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new SystemIntelligenceService();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValue(intelligenceFixture());

    await service.getSystemIntelligence('org-1');
    jest.setSystemTime(new Date('2026-01-01T00:02:01.000Z')); // +121s, past the 2min TTL
    await service.getSystemIntelligence('org-1');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('(5) concurrent identical requests execute the computation exactly once (in-flight dedup)', async () => {
    const service = new SystemIntelligenceService();
    let resolveCompute: (value: SystemIntelligenceResult) => void;
    const pending = new Promise<SystemIntelligenceResult>((resolve) => { resolveCompute = resolve; });
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockReturnValue(pending);

    const call1 = service.getSystemIntelligence('org-1');
    const call2 = service.getSystemIntelligence('org-1');
    const fixture = intelligenceFixture();
    resolveCompute!(fixture);
    const [result1, result2] = await Promise.all([call1, call2]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result1).toBe(fixture);
    expect(result2).toBe(fixture);
  });

  it('(6) concurrent requests for different organizations remain isolated, each executing its own computation', async () => {
    const service = new SystemIntelligenceService();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockImplementation(async (orgId: any) => intelligenceFixture({ system_score: orgId === 'org-a' ? 90 : 40 }));

    const [a, b] = await Promise.all([
      service.getSystemIntelligence('org-a'),
      service.getSystemIntelligence('org-b'),
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(a.system_score).toBe(90);
    expect(b.system_score).toBe(40);
  });

  it('(7) a rejected underlying computation is not cached and propagates to the caller', async () => {
    const service = new SystemIntelligenceService();
    jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockRejectedValueOnce(new Error('DB_UNAVAILABLE'));

    await expect(service.getSystemIntelligence('org-1')).rejects.toThrow('DB_UNAVAILABLE');
  });

  it('(8) after a rejected request, a subsequent request executes successfully (in-flight entry was cleared, not left permanently poisoned)', async () => {
    const service = new SystemIntelligenceService();
    const fixture = intelligenceFixture();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockRejectedValueOnce(new Error('DB_UNAVAILABLE'))
      .mockResolvedValueOnce(fixture);

    await expect(service.getSystemIntelligence('org-1')).rejects.toThrow('DB_UNAVAILABLE');
    const result = await service.getSystemIntelligence('org-1');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toBe(fixture);
  });

  it('(9) a not-ready/null (Pending) result is NOT persisted as a normal positive cache entry -- the next call recomputes immediately, even within the TTL window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new SystemIntelligenceService();
    const pending = pendingFixture();
    const ready = intelligenceFixture();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(ready);

    const first = await service.getSystemIntelligence('org-1');
    jest.setSystemTime(new Date('2026-01-01T00:00:05.000Z')); // well within the 2min TTL
    const second = await service.getSystemIntelligence('org-1');

    expect(first.system_score).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2); // NOT 1 -- the Pending result was never cached
    expect(second).toBe(ready);
  });

  it('(10) once a ready result IS cached, it is served as a normal positive entry until TTL expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new SystemIntelligenceService();
    const ready = intelligenceFixture();
    const spy = jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValue(ready);

    await service.getSystemIntelligence('org-1');
    jest.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    const second = await service.getSystemIntelligence('org-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toBe(ready);
  });

  it('(11) preserves existing readiness/weighting semantics unchanged -- the cache wrapper returns exactly what the uncached computation resolved', async () => {
    const service = new SystemIntelligenceService();
    const fixture = intelligenceFixture({
      system_score: 72,
      components: {
        cost: componentFixture({ score: 60 }),
        security: componentFixture({ score: 80 }),
        observability: componentFixture({ score: 70 }),
      },
    });
    jest
      .spyOn(SystemIntelligenceService.prototype as any, 'computeSystemIntelligenceUncached')
      .mockResolvedValue(fixture);

    const result = await service.getSystemIntelligence('org-1');

    // 60*0.30 + 80*0.40 + 70*0.30 = 71 -- this test doesn't recompute the formula
    // (that's the uncached method's own responsibility, untouched by this change);
    // it only proves the cache wrapper doesn't alter the resolved value.
    expect(result).toBe(fixture);
    expect(result.components.cost.score).toBe(60);
    expect(result.components.security.score).toBe(80);
    expect(result.components.observability.score).toBe(70);
  });
});
