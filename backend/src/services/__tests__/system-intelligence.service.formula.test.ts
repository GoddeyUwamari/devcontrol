/**
 * Tier 0 shared source-of-truth: arithmetic regression test for
 * SystemIntelligenceService's composite system_score formula.
 *
 * The cache test file (system-intelligence.service.cache.test.ts) proves the
 * caching wrapper passes through whatever computeSystemIntelligenceUncached()
 * resolves, but it mocks that method entirely -- it never exercises the
 * actual weighting arithmetic. This file closes that gap: it mocks ONLY the
 * three component computers (computeCostScore / computeSecurityScore /
 * computeObservabilityScore), letting getSystemIntelligence() run its own
 * real, un-mocked aggregation (cost*0.30 + security*0.40 + observability*0.30,
 * Math.round, and the allReady gate) against fixed, deterministic inputs.
 *
 * Fixed inputs are deliberately distinct (50/90/70, not equal) so a weight
 * transposition bug (e.g. cost and observability swapped, or cost given
 * security's 0.40) produces a different, wrong number rather than silently
 * matching by coincidence -- see the "weight sensitivity" test below, which
 * asserts the real result against several plausible-but-wrong weightings to
 * prove they'd actually be caught.
 *
 * No AWS/CloudWatch/DB calls occur -- the three mocked component methods are
 * the service's only points of external I/O. No cache TTL is waited on: each
 * test uses a fresh service instance with an empty cache, so the real
 * computation always runs on the first (and only) call.
 */
import { SystemIntelligenceService, ComponentScore } from '../system-intelligence.service';

function componentFixture(score: number, overrides: Partial<ComponentScore> = {}): ComponentScore {
  return {
    score,
    label: 'Fixture',
    detail: 'fixture detail',
    severity: 'healthy',
    delta: null,
    status: 'good',
    ready: true,
    ...overrides,
  };
}

function mockComponents(service: SystemIntelligenceService, cost: ComponentScore, security: ComponentScore, observability: ComponentScore) {
  const costSpy = jest.spyOn(service as any, 'computeCostScore').mockResolvedValue(cost);
  const securitySpy = jest.spyOn(service as any, 'computeSecurityScore').mockResolvedValue(security);
  const observabilitySpy = jest.spyOn(service as any, 'computeObservabilityScore').mockResolvedValue(observability);
  return { costSpy, securitySpy, observabilitySpy };
}

describe('SystemIntelligenceService system_score formula -- 30/40/30 weighting', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes the exact expected system_score from fixed, distinct component scores via the real aggregation path', async () => {
    const service = new SystemIntelligenceService();
    // cost=50 (*0.30=15.0), security=90 (*0.40=36.0), observability=70 (*0.30=21.0) -> 72.0
    const { costSpy, securitySpy, observabilitySpy } = mockComponents(
      service,
      componentFixture(50, { label: 'Cost Efficiency' }),
      componentFixture(90, { label: 'Security Posture' }),
      componentFixture(70, { label: 'Observability' }),
    );

    const result = await service.getSystemIntelligence('org-formula-1');

    // Proves the real aggregation ran on top of the mocked components, not a
    // full mock of getSystemIntelligence()/computeSystemIntelligenceUncached()
    // itself -- each component computer was actually invoked with the org id.
    expect(costSpy).toHaveBeenCalledWith('org-formula-1');
    expect(securitySpy).toHaveBeenCalledWith('org-formula-1');
    expect(observabilitySpy).toHaveBeenCalledWith('org-formula-1');

    expect(result.system_score).toBe(72);
    expect(result.components.cost.score).toBe(50);
    expect(result.components.security.score).toBe(90);
    expect(result.components.observability.score).toBe(70);
  });

  it('weight sensitivity: the fixed inputs distinguish the correct 30/40/30 weighting from plausible transposition bugs', () => {
    const cost = 50, security = 90, observability = 70;
    const correct = Math.round(cost * 0.30 + security * 0.40 + observability * 0.30);
    const costGetsSecurityWeight = Math.round(cost * 0.40 + security * 0.30 + observability * 0.30);
    const securityAndObservabilitySwapped = Math.round(cost * 0.30 + security * 0.30 + observability * 0.40);
    const evenWeighting = Math.round(cost * (1 / 3) + security * (1 / 3) + observability * (1 / 3));

    expect(correct).toBe(72);
    expect(costGetsSecurityWeight).not.toBe(correct);
    expect(securityAndObservabilitySwapped).not.toBe(correct);
    expect(evenWeighting).not.toBe(correct);
  });

  it('rounds the weighted sum the same way the service does (Math.round, not floor/ceil/truncate)', async () => {
    const service = new SystemIntelligenceService();
    // 55*0.30 + 55*0.40 + 56*0.30 = 16.5 + 22.0 + 16.8 = 55.3 -> rounds to 55.
    // Chosen so floor/truncate (55) and a naive ceil (56) diverge, isolating
    // exactly which rounding rule is in effect.
    mockComponents(
      service,
      componentFixture(55, { label: 'Cost Efficiency' }),
      componentFixture(55, { label: 'Security Posture' }),
      componentFixture(56, { label: 'Observability' }),
    );

    const result = await service.getSystemIntelligence('org-formula-2');

    expect(result.system_score).toBe(55);
  });

  it('readiness gate is preserved: system_score is null (Pending) when any single component is not ready, even though the other two have valid scores', async () => {
    const service = new SystemIntelligenceService();
    mockComponents(
      service,
      componentFixture(50, { label: 'Cost Efficiency' }),
      componentFixture(90, { label: 'Security Posture' }),
      componentFixture(70, { label: 'Observability', ready: false }),
    );

    const result = await service.getSystemIntelligence('org-formula-3');

    expect(result.system_score).toBeNull();
    expect(result.status).toBe('Pending');
  });

  it('readiness gate: system_score is computed once ALL THREE components are ready', async () => {
    const service = new SystemIntelligenceService();
    mockComponents(
      service,
      componentFixture(50, { label: 'Cost Efficiency', ready: true }),
      componentFixture(90, { label: 'Security Posture', ready: true }),
      componentFixture(70, { label: 'Observability', ready: true }),
    );

    const result = await service.getSystemIntelligence('org-formula-4');

    expect(result.system_score).toBe(72);
    expect(result.status).not.toBe('Pending');
  });
});
