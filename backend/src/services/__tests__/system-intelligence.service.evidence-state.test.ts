/**
 * System Intelligence component evidence states and the composite state built
 * from them. Scores and the 30/40/30 weighting are unchanged by these states
 * -- see system-intelligence.service.formula.test.ts -- so every test here
 * also pins the numeric result next to the state it asserts.
 *
 * Cost and security run their real computers against a mocked pool, a mocked
 * getInventoryMonthlyRunRate() and a mocked risk score; observability is
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
import type { ContextDataState } from '../ai-context-contract';

const ORG = '7c1e4a2b-9d3f-4b6a-8e5c-2f0d1a3b4c5d';
const ANOMALY = 'Anomaly checks not yet active';
const INSUFFICIENT = 'Insufficient spend data to assess cost efficiency';
const BASIS = 'Based on monthly run-rate estimate from resource inventory';
const ALERT_REASON =
  'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.';
// Wording that would claim a retrieval failure the cost path cannot observe.
const FAILURE_CLAIMS = /Cost data unavailable|Cost Explorer failed|No billing data|AWS cost unavailable/i;

/**
 * Cost inputs: the inventory run-rate, the savings estimate, and whether a
 * cost scan ran. anomaly_detections answers `anomalyRows` when read -- and
 * every test with detection off asserts it is never read.
 */
function mockCostInputs(opts: { runRate: number; scanRan?: boolean; savings?: number; anomalyRows?: number }) {
  jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue({
    total_recommendations: 0, active_recommendations: 0, total_potential_savings: opts.savings ?? 0,
    potential_savings_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 },
  });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('resource_discovery_jobs')) {
      return opts.scanRan === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ '?column?': 1 }] };
    }
    if (sql.includes('anomaly_detections')) return { rowCount: 1, rows: [{ count: String(opts.anomalyRows ?? 0) }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const runRate = jest.spyOn(awsCostService, 'getInventoryMonthlyRunRate').mockResolvedValue(opts.runRate);
  const monthToDate = jest.spyOn(awsCostService, 'getMonthlySpendWithFallback').mockResolvedValue({ amount: 0.19, source: 'actual' });
  return { runRate, monthToDate };
}

const anomalyQueries = () => mockQuery.mock.calls.filter(([sql]) => String(sql).includes('anomaly_detections'))

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

  it('spend input is the inventory run-rate, never Cost Explorer month-to-date spend', async () => {
    const { runRate, monthToDate } = mockCostInputs({ runRate: 25, savings: 0.96 });
    const result = await cost(new SystemIntelligenceService());
    expect(runRate).toHaveBeenCalledWith(ORG);
    expect(monthToDate).not.toHaveBeenCalled();
    expect(result.monthlySpend).toBe(25);
    expect(result.costSource).toBe('estimated');
    // 100 x 25 / (25 + 0.96) = 96.3 -> 96
    expect(result.score).toBe(96);
  });

  it('anomaly detection disabled: the score is the efficiency ratio alone -- no 25-point anomaly credit, and anomaly rows are not read', async () => {
    mockCostInputs({ runRate: 300, savings: 100, anomalyRows: 3 });
    const result = await cost(new SystemIntelligenceService());
    // 300/400 x 100 = 75 (the old formula gave 0.75 x 75 + 0.25 x 100 = 81)
    expect(result.score).toBe(75);
    expect(anomalyQueries()).toHaveLength(0);
  });

  it('a run-rate with no savings scores 100 from the ratio alone; partial with both required sentences', async () => {
    mockCostInputs({ runRate: 1000 });
    const result = await cost(new SystemIntelligenceService());
    expect(result.score).toBe(100);
    expect(result.ready).toBe(true);
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${BASIS}. ${ANOMALY}.`);
  });

  it('no run-rate (no resources / sum <= 0): keeps the existing Cost=50 insufficient-data behavior, partial, no failure claim', async () => {
    mockCostInputs({ runRate: 0, savings: 0.96 });
    const result = await cost(new SystemIntelligenceService());
    expect(result.score).toBe(50);
    expect(result.ready).toBe(true);
    expect(result.state).toBe('partial');
    expect(result.reason).toBe(`${INSUFFICIENT}. ${ANOMALY}.`);
    expect(result.detail).toBe('Spend data unavailable — cost efficiency cannot be assessed');
    expect(result.reason).not.toMatch(FAILURE_CLAIMS);
  });

  it('status thresholds are unchanged: 75 good, 74 warning, 55 warning, 54 risk', async () => {
    const statusFor = async (runRate: number, savings: number) => {
      mockCostInputs({ runRate, savings });
      return (await cost(new SystemIntelligenceService())).status;
    };
    expect(await statusFor(75, 25)).toBe('good'); // 75
    expect(await statusFor(74, 26)).toBe('warning'); // 74
    expect(await statusFor(55, 45)).toBe('warning'); // 55
    expect(await statusFor(54, 46)).toBe('risk'); // 54
  });

  it('no cost scan yet: unavailable and not ready (unchanged readiness), not partial', async () => {
    mockCostInputs({ runRate: 1000, scanRan: false });
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

  it('with detection active, the existing 0.75/0.25 formula and anomaly rows apply, and the state is available', async () => {
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
    const scoreWith = async (anomalyRows: number) => {
      jest.spyOn(Repo.prototype, 'getStats').mockResolvedValue({
        total_recommendations: 0, active_recommendations: 0, total_potential_savings: 100,
        potential_savings_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 },
      });
      mockQuery.mockImplementation(async (sql: string) =>
        sql.includes('resource_discovery_jobs') ? { rowCount: 1, rows: [{}] } : { rowCount: 1, rows: [{ count: String(anomalyRows) }] });
      jest.spyOn(costService, 'getInventoryMonthlyRunRate').mockResolvedValue(300);
      return (new Service() as any).computeCostScore(ORG) as Promise<ComponentScore>;
    };

    const clean = await scoreWith(0);
    // 300/400 x 100 x 0.75 + 100 x 0.25 = 81.25 -> 81
    expect(clean.score).toBe(81);
    expect(clean.state).toBe('available');
    expect(clean.reason).toBeNull();
    // 2 active cost anomalies: 0.75 x 75 + 0.25 x 60 = 71.25 -> 71
    expect((await scoreWith(2)).score).toBe(71);
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
  const COST_REASON = `${BASIS}. ${ANOMALY}.`;

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
