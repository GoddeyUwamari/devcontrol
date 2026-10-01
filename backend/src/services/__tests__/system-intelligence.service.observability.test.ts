/**
 * The Observability component carries its readiness state into System
 * Intelligence: a null readiness score (failure or nothing measured) is never
 * scored as 0, and a partial one (EC2/RDS alert coverage only) keeps the
 * 30/40/30 composite but marks it partial with the reason.
 *
 * Cost and security computers are stubbed; ObservabilityReadinessService.
 * getReadiness is mocked, so the real computeObservabilityScore() and the real
 * aggregation run. No AWS, database, or network.
 */
import { SystemIntelligenceService, type ComponentScore } from '../system-intelligence.service';
import { ObservabilityReadinessService, type ReadinessResult } from '../observability-readiness.service';
import type { ContextDataState } from '../ai-context-contract';

const ORG = '5b3f0c9e-2d4a-4e8b-9f1c-7a6d2e4b8c10';
const PARTIAL_REASON =
  'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.';

function component(score: number, label: string): ComponentScore {
  return { score, label, detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, state: 'available', reason: null };
}

function readiness(state: ContextDataState, score: number | null, reason: string | null): ReadinessResult {
  return {
    connected: true,
    state,
    reason,
    readiness_score: score,
    status: score === null ? null : score >= 85 ? 'Ready' : score >= 65 ? 'Partially Ready' : 'At Risk',
    discovery_run: null,
    scope: { kind: 'resource_inventory', connectedAccountId: '111122223333', discoveryRegion: 'us-east-1' },
    components: {} as ReadinessResult['components'],
    alarms: {} as ReadinessResult['alarms'],
    top_gaps: [],
    computed_at: new Date().toISOString(),
  };
}

async function intelligenceWith(result: ReadinessResult | null) {
  const service = new SystemIntelligenceService();
  jest.spyOn(service as any, 'computeCostScore').mockResolvedValue(component(50, 'Cost Efficiency'));
  jest.spyOn(service as any, 'computeSecurityScore').mockResolvedValue(component(90, 'Security Posture'));
  jest.spyOn(ObservabilityReadinessService.prototype, 'getReadiness').mockResolvedValue(result);
  return service.getSystemIntelligence(ORG);
}

afterEach(() => jest.restoreAllMocks());

describe('SystemIntelligence observability state', () => {
  it('partial observability: system_score still uses 30/40/30, and the composite is marked partial with the reason', async () => {
    const result = await intelligenceWith(readiness('partial', 0, PARTIAL_REASON));
    // 50*0.30 + 90*0.40 + 0*0.30 = 51
    expect(result.system_score).toBe(51);
    expect(result.composite_state).toBe('partial');
    expect(result.composite_reason).toBe(`Alert Coverage: ${PARTIAL_REASON}`);
    expect(result.components.observability).toMatchObject({
      score: 0, state: 'partial', reason: PARTIAL_REASON, ready: true, detail: 'Alert coverage 0% · EC2/RDS only',
    });
  });

  it('a partial observability driver describes alert coverage, not undetected incidents across the system', async () => {
    const result = await intelligenceWith(readiness('partial', 0, PARTIAL_REASON));
    const driver = result.top_drivers.find(d => d.id === 'observability-readiness');
    expect(driver?.consequence).toBe('Incidents on resources without an actionable alarm may go undetected');
    expect(JSON.stringify(result)).not.toMatch(/team will not be notified/);
  });

  it('readiness error: observability score null (never 0), not ready, system_score null', async () => {
    const result = await intelligenceWith(readiness('error', null, 'the connected AWS role could not be assumed'));
    expect(result.components.observability).toMatchObject({
      score: null, ready: false, state: 'error', detail: 'Observability evidence could not be retrieved',
    });
    expect(result.system_score).toBeNull();
    expect(result.composite_state).toBeNull();
    expect(result.status).toBe('Pending');
  });

  it('readiness unavailable (nothing in scope): observability score null, system_score null', async () => {
    const result = await intelligenceWith(readiness('unavailable', null, 'no EC2 or RDS resources are in scope, so alert coverage is not applicable'));
    expect(result.components.observability).toMatchObject({ score: null, ready: false, state: 'unavailable', detail: 'Alert coverage not measurable yet' });
    expect(result.system_score).toBeNull();
  });

  it('no AWS account: unavailable with "No AWS account connected" -- distinct from a credential error', async () => {
    const result = await intelligenceWith(null);
    expect(result.components.observability).toMatchObject({ score: null, state: 'unavailable', detail: 'No AWS account connected' });
    expect(result.system_score).toBeNull();
  });
});
