/**
 * System Intelligence component evidence states and the composite state built
 * from them. Scores and the 30/40/30 weighting are unchanged by these states
 * -- see system-intelligence.service.formula.test.ts -- so every test here
 * also pins the numeric result next to the state it asserts.
 *
 * Cost and security run their real computers against a mocked pool, a mocked
 * getMonthlySpendWithFallback() and a mocked risk score; observability is
 * stubbed. No AWS, database, or network.
 */
const mockQuery = jest.fn();
const mockClientQuery = jest.fn();

jest.mock('../../config/database', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: async () => ({ query: (...args: unknown[]) => mockClientQuery(...args), release: () => undefined }),
  },
}));

import { SystemIntelligenceService, type ComponentScore, type ObservabilityComponentScore } from '../system-intelligence.service';
import awsCostService from '../aws-cost.service';
import { RiskTrackingService } from '../risk-tracking.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { ANOMALY_DETECTION_ACTIVE } from '../anomaly-detection.service';
import type { ContextDataState, SpendProvenance } from '../ai-context-contract';

const ORG = '7c1e4a2b-9d3f-4b6a-8e5c-2f0d1a3b4c5d';
const ANOMALY = 'Anomaly checks not yet active';
const INSUFFICIENT = 'Insufficient spend data to assess cost efficiency';
const ESTIMATE = 'Spend based on inventory estimate, not AWS Cost Explorer billing';
const ALERT_REASON =
  'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.';
// Wording that would claim a retrieval failure the cost path cannot observe.
const FAILURE_CLAIMS = /Cost data unavailable|Cost Explorer failed|No billing data|AWS cost unavailable/i;

function mockCostInputs(opts: { amount: number; source: SpendProvenance; scanRan?: boolean; savings?: number }) {
  jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue({
    total_recommendations: 0, active_recommendations: 0, total_potential_savings: opts.savings ?? 0,
    potential_savings_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 },
  });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('resource_discovery_jobs')) {
      return opts.scanRan === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    // No active cost anomaly rows -- the only state detection-off can produce.
    if (sql.includes('anomaly_detections')) return { rowCount: 1, rows: [{ count: '0' }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  jest.spyOn(awsCostService, 'getMonthlySpendWithFallback').mockResolvedValue({ amount: opts.amount, source: opts.source });
}

function cost(service: SystemIntelligenceService): Promise<ComponentScore> {
  return (service as any).computeCostScore(ORG);
}

afterEach(() => {
  jest.restoreAllMocks();
  mockQuery.mockReset();
  mockClientQuery.mockReset();
});

describe('Cost component evidence state', () => {
  it('the repository declares anomaly detection inactive (detectors are stubs)', () => {
    expect(ANOMALY_DETECTION_ACTIVE).toBe(false);
  });

  it('anomaly detection disabled: actual non-zero spend is partial with "Anomaly checks not yet active", score unchanged', async () => {
    mockCostInputs({ amount: 1000, source: 'actual' });
    const result = await cost(new SystemIntelligenceService());
    // 1000/(1000+0)*100*0.75 + 100*0.25 = 100 -- the anomaly term still counts.
    expect(result.score).toBe(100);
    expect(result.ready).toBe(true);
    expect(result.costSource).toBe('actual');
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${ANOMALY}.`);
  });

  it('spend <= 0: keeps the Cost=50 placeholder, partial (not unavailable/error), with every limitation and no failure claim', async () => {
    // The only shape getMonthlySpendWithFallback() returns for a non-positive live total.
    mockCostInputs({ amount: 0, source: 'estimated' });
    const result = await cost(new SystemIntelligenceService());
    expect(result.score).toBe(50);
    expect(result.ready).toBe(true);
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${INSUFFICIENT}. ${ESTIMATE}. ${ANOMALY}.`);
    expect(result.reason).not.toMatch(FAILURE_CLAIMS);
  });

  it('a $0 labeled actual is still partial, never unavailable/error, and both limitations survive', async () => {
    mockCostInputs({ amount: 0, source: 'actual' });
    const result = await cost(new SystemIntelligenceService());
    expect(result.score).toBe(50);
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${INSUFFICIENT}. ${ANOMALY}.`);
    expect(result.reason).not.toMatch(FAILURE_CLAIMS);
  });

  it('estimated non-zero spend: score from the estimate is kept, and the estimate limitation is visible', async () => {
    mockCostInputs({ amount: 300, source: 'estimated', savings: 100 });
    const result = await cost(new SystemIntelligenceService());
    // 300/400*100*0.75 + 100*0.25 = 81.25 -> 81
    expect(result.score).toBe(81);
    expect(result.costSource).toBe('estimated');
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${ESTIMATE}. ${ANOMALY}.`);
  });

  it('no cost scan yet: unavailable and not ready (unchanged readiness), not partial', async () => {
    mockCostInputs({ amount: 1000, source: 'actual', scanRan: false });
    const result = await cost(new SystemIntelligenceService());
    expect(result.ready).toBe(false);
    expect(result.state).toBe('unavailable');
  });

  it('a cost computation failure stays an error with score 0 and ready false -- never relabeled partial', async () => {
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await cost(new SystemIntelligenceService());
    expect(result).toMatchObject({ score: 0, ready: false, state: 'error' });
    expect(result.reason).not.toContain(ANOMALY);
  });

  it('the partial state comes from the declaration, not the anomaly row count: with detection active and actual spend, cost is available', async () => {
    let Service!: typeof SystemIntelligenceService;
    let costService!: typeof awsCostService;
    let Repo!: typeof CostRecommendationsRepository;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../anomaly-detection.service', () => ({
        ...jest.requireActual('../anomaly-detection.service'),
        ANOMALY_DETECTION_ACTIVE: true,
      }));
      Service = (await import('../system-intelligence.service')).SystemIntelligenceService;
      costService = (await import('../aws-cost.service')).default;
      Repo = (await import('../../repositories/cost-recommendations.repository')).CostRecommendationsRepository;
    });
    jest.spyOn(Repo.prototype, 'getStats').mockResolvedValue({
      total_recommendations: 0, active_recommendations: 0, total_potential_savings: 0,
      potential_savings_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 },
    });
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('resource_discovery_jobs') ? { rowCount: 1, rows: [{}] } : { rowCount: 1, rows: [{ count: '0' }] });
    jest.spyOn(costService, 'getMonthlySpendWithFallback').mockResolvedValue({ amount: 1000, source: 'actual' });

    const result: ComponentScore = await (new Service() as any).computeCostScore(ORG);
    expect(result.score).toBe(100);
    expect(result.state).toBe('available');
    expect(result.reason).toBeNull();
  });
});

describe('Security component evidence state', () => {
  function mockRisk(isPreliminary: boolean) {
    mockClientQuery.mockResolvedValue({ rowCount: 1, rows: [{ count: '0' }] });
    jest.spyOn(RiskTrackingService.prototype, 'calculateCurrentRiskScore').mockResolvedValue({ score: 72, isPreliminary } as any);
  }

  it('a non-preliminary risk score is available, score unchanged', async () => {
    mockRisk(false);
    const result: ComponentScore = await (new SystemIntelligenceService() as any).computeSecurityScore(ORG);
    expect(result).toMatchObject({ score: 72, ready: true, state: 'available', reason: null });
  });

  it('a preliminary risk score is not called available', async () => {
    mockRisk(true);
    const result: ComponentScore = await (new SystemIntelligenceService() as any).computeSecurityScore(ORG);
    expect(result).toMatchObject({ score: 72, ready: false, state: 'unavailable' });
  });
});

describe('Composite evidence state', () => {
  function component(score: number, state: ContextDataState = 'available', reason: string | null = null, ready = true): ComponentScore {
    return { score, label: '', detail: '', severity: 'healthy', delta: null, status: 'good', ready, state, reason };
  }
  function observability(score: number | null, state: ContextDataState, reason: string | null): ObservabilityComponentScore {
    return { ...component(0), score, ready: score !== null, state, reason };
  }
  async function composite(c: ComponentScore, s: ComponentScore, o: ObservabilityComponentScore) {
    const service = new SystemIntelligenceService();
    jest.spyOn(service as any, 'computeCostScore').mockResolvedValue(c);
    jest.spyOn(service as any, 'computeSecurityScore').mockResolvedValue(s);
    jest.spyOn(service as any, 'computeObservabilityScore').mockResolvedValue(o);
    return service.getSystemIntelligence(ORG);
  }
  const COST_REASON = `${INSUFFICIENT}. ${ESTIMATE}. ${ANOMALY}.`;

  it('all components available => available, no reason', async () => {
    const result = await composite(component(50), component(90), observability(70, 'available', null));
    // 50*0.30 + 90*0.40 + 70*0.30 = 72
    expect(result.system_score).toBe(72);
    expect(result.composite_state).toBe('available');
    expect(result.composite_reason).toBeNull();
  });

  it('only cost partial => partial, reason attributed to Cost only, score unchanged', async () => {
    const result = await composite(component(50, 'partial', `${ANOMALY}.`), component(90), observability(70, 'available', null));
    expect(result.system_score).toBe(72);
    expect(result.composite_state).toBe('partial');
    expect(result.composite_reason).toBe(`Cost: ${ANOMALY}.`);
  });

  it('only alert coverage partial => partial, reason attributed to Alert Coverage only', async () => {
    const result = await composite(component(50), component(90), observability(70, 'partial', ALERT_REASON));
    expect(result.composite_state).toBe('partial');
    expect(result.composite_reason).toBe(`Alert Coverage: ${ALERT_REASON}`);
  });

  it('cost and alert coverage partial => partial with BOTH reasons, cost first, score unchanged', async () => {
    const result = await composite(component(50, 'partial', COST_REASON), component(90), observability(0, 'partial', ALERT_REASON));
    // 50*0.30 + 90*0.40 + 0*0.30 = 51
    expect(result.system_score).toBe(51);
    expect(result.composite_state).toBe('partial');
    expect(result.composite_reason).toBe(`Cost: ${COST_REASON} Alert Coverage: ${ALERT_REASON}`);
  });

  it('a component not ready (cost scan pending) => system_score null, composite_state null, Pending', async () => {
    const result = await composite(component(50, 'unavailable', 'No cost scan has completed yet.', false), component(90), observability(70, 'partial', ALERT_REASON));
    expect(result.system_score).toBeNull();
    expect(result.composite_state).toBeNull();
    expect(result.composite_reason).toBeNull();
    expect(result.status).toBe('Pending');
  });

  it('a component error (security) never yields a composite', async () => {
    const result = await composite(component(50, 'partial', `${ANOMALY}.`), component(0, 'error', 'The security score could not be computed.', false), observability(70, 'partial', ALERT_REASON));
    expect(result.system_score).toBeNull();
    expect(result.composite_state).toBeNull();
    expect(result.status).toBe('Pending');
  });

  it('an alert coverage error never yields a composite', async () => {
    const result = await composite(component(50), component(90), observability(null, 'error', 'the connected AWS role could not be assumed'));
    expect(result.system_score).toBeNull();
    expect(result.composite_state).toBeNull();
  });
});
