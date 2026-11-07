/**
 * Org isolation of every database-backed evidence provider (AI truth PR 2,
 * step1 §4): organization A's collection never contains organization B's
 * data, and B's never contains A's.
 *
 * Run twice:
 *   - as a NOSUPERUSER NOBYPASSRLS role inside a request tagged for the org
 *     (RLS and the explicit predicates together, as in production);
 *   - as the table owner, whom RLS does not restrict, so only each
 *     provider's explicit organization predicate isolates the tenants.
 *
 * Covered here: inventory, account findings and Top Risk, cost (findings and
 * the estimate fallback), compliance (configuration checks and custom
 * framework scans), alarms and telemetry, DORA and deployments, regions and
 * the connected account. Cost Explorer and CloudWatch are faked; nothing
 * calls AWS.
 */
import type { Pool } from 'pg';

const mockPools: { app?: Pool } = {};
jest.mock('../../../../config/database', () => {
  const actual = jest.requireActual('../../../../config/database');
  return {
    ...actual,
    get pool() {
      return mockPools.app;
    },
  };
});
jest.mock('../../../aws-cost.service', () => ({
  __esModule: true,
  default: {
    fetchMonthlyCosts: jest.fn(async () => { throw new Error('AWS_NOT_CONNECTED: fixture'); }),
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(),
  },
}));

import { EvidenceDb, type OrgSeed } from './db-fixture';
import { collectEvidence, sectionOf } from '../registry';
import { createDefaultEvidenceRegistry } from '../providers';
import { operationsSources } from '../providers/operations';
import systemIntelligenceService from '../../../system-intelligence.service';
import type { EvidenceBundle } from '../types';

const db = new EvidenceDb();
let orgA: OrgSeed;
let orgB: OrgSeed;
const registry = createDefaultEvidenceRegistry();

const ALL = registry.list().map((p) => p.id);

beforeAll(async () => {
  await db.setUp();
  orgA = await db.seedOrg('alpha', 1, '1');
  orgB = await db.seedOrg('bravo', 3, '4');
});
afterAll(async () => { await db.tearDown(); });

/** The fakes every collection runs with (installed before each collection, which happens in beforeAll). */
function installFakes() {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(systemIntelligenceService, 'getSystemIntelligence').mockResolvedValue({ system_score: null } as never);
  // CloudWatch, faked per organization: each org's own alarm and CPU reading.
  jest.spyOn(operationsSources, 'alarms').mockImplementation(async (organizationId: string) => ({
    status: 'ok', reason: null, checked_at: new Date().toISOString(), region: 'us-east-1',
    in_alarm: [{ name: `fixture-alarm-${organizationId}`, type: 'metric', namespace: 'AWS/EC2', metric: 'CPUUtilization', comparison: 'GreaterThanThreshold', threshold: 80, state_since: null, resource: null }],
    in_alarm_complete: true, configured_count: 1, configured_count_complete: true, truncated: false,
  }));
  jest.spyOn(operationsSources, 'peekEvaluation').mockReturnValue(null);
}

function collect(org: OrgSeed): Promise<EvidenceBundle> {
  return collectEvidence(registry, { organizationId: org.id, consumer: 'test', select: { providerIds: ALL }, budgetTokens: 1_000_000 });
}

describe.each([
  ['a NOSUPERUSER NOBYPASSRLS role, inside a tagged request', 'role'],
  ['the table owner (RLS does not apply: explicit predicates only)', 'owner'],
] as const)('as %s', (_label, mode) => {
  let bundleA: EvidenceBundle;
  let bundleB: EvidenceBundle;

  beforeAll(async () => {
    const pool = mode === 'role' ? db.rolePool : db.ownerPool;
    mockPools.app = mode === 'role' ? db.roleApp : db.ownerApp;
    installFakes();
    try {
      bundleA = await db.asRequest(pool, orgA.id, () => collect(orgA));
      bundleB = await db.asRequest(pool, orgB.id, () => collect(orgB));
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("A's evidence carries none of B's markers, and B's none of A's", () => {
    const a = JSON.stringify(bundleA);
    const b = JSON.stringify(bundleB);
    for (const marker of [...orgB.markers, orgB.id, orgB.accountId]) expect(a).not.toContain(marker);
    for (const marker of [...orgA.markers, orgA.id, orgA.accountId]) expect(b).not.toContain(marker);
  });

  it('no provider failed (the isolation is real data, not errors)', () => {
    const errors = (bundle: EvidenceBundle) => bundle.results.filter((r) => r.section.state === 'error').map((r) => r.id);
    expect(errors(bundleA)).toEqual([]);
    expect(errors(bundleB)).toEqual([]);
  });

  it('inventory counts its own resources only', () => {
    expect(sectionOf<{ total: number }>(bundleA, 'inventory.resource_counts').data?.total).toBe(1);
    expect(sectionOf<{ total: number }>(bundleB, 'inventory.resource_counts').data?.total).toBe(3);
    expect(sectionOf<{ ec2: { count: number } }>(bundleA, 'inventory.compute_detail').data?.ec2.count).toBe(1);
    expect(sectionOf<{ ec2: { count: number } }>(bundleB, 'inventory.compute_detail').data?.ec2.count).toBe(3);
  });

  it('account findings and Top Risk are its own', () => {
    expect(sectionOf<{ total: number }>(bundleA, 'security.account_findings').data?.total).toBe(1);
    expect(sectionOf<{ total: number }>(bundleB, 'security.account_findings').data?.total).toBe(3);
    expect(sectionOf<{ count: number }>(bundleA, 'security.top_risk').data?.count).toBe(1);
    expect(sectionOf<{ count: number }>(bundleB, 'security.top_risk').data?.count).toBe(3);
  });

  it('cost findings and the inventory estimate are its own', () => {
    expect(sectionOf<{ lifecycle: { active: number }; totalEstimatedMonthlySavings: number }>(bundleA, 'cost.findings').data)
      .toMatchObject({ lifecycle: { active: 1 }, totalEstimatedMonthlySavings: 12.5 });
    expect(sectionOf<{ totalEstimatedMonthlySavings: number }>(bundleB, 'cost.findings').data?.totalEstimatedMonthlySavings).toBe(37.5);
    expect(sectionOf<{ amount: number }>(bundleA, 'cost.spend').data?.amount).toBe(10);
    expect(sectionOf<{ amount: number }>(bundleB, 'cost.spend').data?.amount).toBe(60);
  });

  it('compliance: configuration checks and custom framework scans are its own', () => {
    expect(sectionOf<{ resourcesWithFindings: number; resourcesEvaluated: number }>(bundleA, 'security.config_checks').data)
      .toMatchObject({ resourcesWithFindings: 1, resourcesEvaluated: 1 });
    expect(sectionOf<{ resourcesEvaluated: number }>(bundleB, 'security.config_checks').data?.resourcesEvaluated).toBe(3);
    expect(sectionOf<{ items: Array<{ resourcesScanned: number }> }>(bundleA, 'compliance.custom_scans').data?.items.map((i) => i.resourcesScanned)).toEqual([1]);
    expect(sectionOf<{ items: Array<{ resourcesScanned: number }> }>(bundleB, 'compliance.custom_scans').data?.items.map((i) => i.resourcesScanned)).toEqual([3]);
  });

  it('alarms and telemetry are its own', () => {
    const alarmsA = sectionOf(bundleA, 'ops.cloudwatch_alarms');
    expect(alarmsA.untrusted?.map((u) => u.text)).toEqual([`fixture-alarm-${orgA.id}`]);
    expect(sectionOf<{ collection: { resourcesTracked: number } }>(bundleA, 'telemetry.cpu').data?.collection?.resourcesTracked).toBe(1);
    expect(sectionOf<{ collection: { resourcesTracked: number } }>(bundleB, 'telemetry.cpu').data?.collection?.resourcesTracked).toBe(3);
  });

  it('deployments and DORA count its own records', () => {
    expect(sectionOf<{ total: number }>(bundleA, 'delivery.deployments').data?.total).toBe(1);
    expect(sectionOf<{ total: number }>(bundleB, 'delivery.deployments').data?.total).toBe(3);
    expect(sectionOf<{ changeFailureRate: string }>(bundleA, 'delivery.dora').data?.changeFailureRate).toMatch(/^100% /);
    expect(sectionOf<{ changeFailureRate: string }>(bundleB, 'delivery.dora').data?.changeFailureRate).toMatch(/^33\.3/);
  });

  it('Security Hub, framework evaluations and the risk-score history are its own', () => {
    const hub = (b: EvidenceBundle) => sectionOf<{ activeFindings: number }>(b, 'security.security_hub');
    expect([hub(bundleA).state, hub(bundleA).data?.activeFindings]).toEqual(['available', 1]);
    expect([hub(bundleB).state, hub(bundleB).data?.activeFindings]).toEqual(['available', 3]);
    const frameworks = (b: EvidenceBundle) => sectionOf<{ items: Array<{ framework: string; checksByState: Record<string, number> }> }>(b, 'compliance.framework_evaluations').data?.items;
    expect(frameworks(bundleA)).toEqual([expect.objectContaining({ framework: 'fixture-alpha', checksByState: { failed: 1 } })]);
    expect(frameworks(bundleB)).toEqual([expect.objectContaining({ framework: 'fixture-bravo', checksByState: { failed: 3 } })]);
    const history = (b: EvidenceBundle) => sectionOf<{ trendPoints: number }>(b, 'security.risk_score').data?.trendPoints;
    expect(history(bundleA)).toBe(2);
    expect(history(bundleB)).toBe(4);
  });

  it('regions and the connected account are its own', () => {
    expect(sectionOf<{ connectedAccountId: string }>(bundleA, 'connection.scope').data?.connectedAccountId).toBe(orgA.accountId);
    expect(sectionOf<{ items: Array<{ region: string }> }>(bundleB, 'coverage.regions').data?.items.map((r) => r.region).sort()).toEqual(['eu-west-1', 'us-east-1']);
  });
});
