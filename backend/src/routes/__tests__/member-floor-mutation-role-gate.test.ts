/**
 * Triage and everyday configuration are open to members, admins and owners,
 * and closed to viewers.
 *
 * Policy under test (viewer refused with 403, everyone else answered exactly
 * as before):
 *   - PATCH /api/cost-recommendations/:id/resolve, /:id/dismiss
 *   - PATCH /api/alerts/:id/acknowledge, /:id/resolve
 *   - PATCH /api/anomalies/:id/acknowledge, /:id/resolve, /:id/false-positive
 *   - POST  /api/security/account-findings/:id/acknowledge, /:id/dismiss
 *   - POST, DELETE /api/dora/benchmarks
 *   - POST, PATCH, DELETE /api/slos
 *   - POST, PUT, DELETE /api/compliance-frameworks, and its rules; POST /:id/scan
 *   - POST /api/onboarding/complete/:step, /dismiss, /re-enable
 *   - POST /api/ai-reports/generate; DELETE /api/ai-reports/bulk, /:id
 *   - POST /api/ai-insights/clear-cache
 *
 * A refused viewer changes nothing: the write each route exists for is never
 * reached. Real routes and real authentication (see role-gate-harness.ts);
 * the data layer behind each route is stubbed, so the suite needs only the
 * identity tables and `generated_reports`.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import alertHistoryRoutes from '../alert-history.routes';
import accountSecurityFindingsRoutes from '../account-security-findings.routes';
import complianceFrameworksRoutes from '../compliance-frameworks.routes';
import onboardingRoutes from '../onboarding.routes';
import aiReportsRoutes from '../ai-reports.routes';
import aiInsightsRoutes from '../ai-insights.routes';
import { createAnomaliesRoutes } from '../anomalies.routes';
import { createSloRoutes } from '../slo.routes';
import { createDoraBenchmarksRoutes } from '../dora-benchmarks.routes';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AlertHistoryRepository } from '../../repositories/alert-history.repository';
import { AnomalyRepository } from '../../repositories/anomaly.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';
import { CustomComplianceService } from '../../services/custom-compliance.service';
import { SloService } from '../../services/slo.service';
import { onboardingService } from '../../services/onboarding.service';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';
import { AIInsightsService } from '../../services/ai-insights.service';
import { pool as appPool } from '../../config/database';
import { createRoleGateHarness, MEMBER_REFUSAL, RoleGateOrg } from './role-gate-harness';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

const harness = createRoleGateHarness('member-floor');
const { pool, sendAs } = harness;

const ID = '00000000-0000-4000-8000-000000000003';
const RULE_BODY = {
  rule_code: 'MF-1',
  title: 'Member floor rule',
  severity: 'low',
  category: 'tagging',
  rule_type: 'tag_required',
  conditions: { tag: 'owner' },
  recommendation: 'Tag it',
};

// The benchmarks router takes its pool as an argument, so its writes are
// observed on this stand-in. Authentication still uses the application pool.
const doraQuery = jest.fn();
const doraPool = { query: doraQuery } as unknown as Pool;

let org: RoleGateOrg;
let spies: Record<string, jest.SpyInstance>;

beforeAll(async () => {
  org = await harness.buildOrg();
  await harness.listen((app) => {
    app.use('/api/cost-recommendations', costRecommendationsRoutes);
    app.use('/api/alerts', alertHistoryRoutes);
    app.use('/api/security/account-findings', accountSecurityFindingsRoutes);
    app.use('/api/compliance-frameworks', complianceFrameworksRoutes);
    app.use('/api/onboarding', onboardingRoutes);
    app.use('/api/ai-reports', aiReportsRoutes);
    app.use('/api/ai-insights', aiInsightsRoutes);
    // The same factories, mounted at the same paths, as server.ts.
    app.use('/api/anomalies', createAnomaliesRoutes(appPool));
    app.use('/api/slos', createSloRoutes(appPool));
    app.use('/api/dora', createDoraBenchmarksRoutes(doraPool));
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  doraQuery.mockReset().mockResolvedValue({ rows: [{ metric_name: 'lead_time' }], rowCount: 1 });

  const row = { id: ID };
  spies = {
    recommendationStatus: jest.spyOn(CostRecommendationsRepository.prototype, 'updateStatus').mockResolvedValue(row as never),
    alertFind: jest.spyOn(AlertHistoryRepository.prototype, 'findById').mockResolvedValue({ id: ID, status: 'firing' } as never),
    alertAcknowledge: jest.spyOn(AlertHistoryRepository.prototype, 'acknowledge').mockResolvedValue(row as never),
    alertResolve: jest.spyOn(AlertHistoryRepository.prototype, 'resolve').mockResolvedValue(row as never),
    anomalyAcknowledge: jest.spyOn(AnomalyRepository.prototype, 'acknowledge').mockResolvedValue(true as never),
    anomalyResolve: jest.spyOn(AnomalyRepository.prototype, 'resolve').mockResolvedValue(true as never),
    anomalyFalsePositive: jest.spyOn(AnomalyRepository.prototype, 'markFalsePositive').mockResolvedValue(true as never),
    findingDisposition: jest
      .spyOn(AccountSecurityFindingsRepository.prototype, 'setDisposition')
      .mockResolvedValue({ outcome: 'updated', finding: row } as never),
    sloCreate: jest.spyOn(SloService.prototype, 'createSlo').mockResolvedValue(row as never),
    sloUpdate: jest.spyOn(SloService.prototype, 'updateSlo').mockResolvedValue(row as never),
    sloDelete: jest.spyOn(SloService.prototype, 'deleteSlo').mockResolvedValue(undefined as never),
    frameworkFind: jest.spyOn(ComplianceFrameworksRepository.prototype, 'findFrameworkById').mockResolvedValue(row as never),
    frameworkCreate: jest.spyOn(ComplianceFrameworksRepository.prototype, 'createFramework').mockResolvedValue(row as never),
    frameworkUpdate: jest.spyOn(ComplianceFrameworksRepository.prototype, 'updateFramework').mockResolvedValue(row as never),
    frameworkDelete: jest.spyOn(ComplianceFrameworksRepository.prototype, 'deleteFramework').mockResolvedValue(true as never),
    ruleCreate: jest.spyOn(ComplianceFrameworksRepository.prototype, 'createRule').mockResolvedValue(row as never),
    ruleUpdate: jest.spyOn(ComplianceFrameworksRepository.prototype, 'updateRule').mockResolvedValue(row as never),
    ruleDelete: jest.spyOn(ComplianceFrameworksRepository.prototype, 'deleteRule').mockResolvedValue(true as never),
    scanStart: jest
      .spyOn(CustomComplianceService.prototype, 'startScan')
      .mockResolvedValue({ status: 'started', scanId: ID } as never),
    onboardingStatus: jest.spyOn(onboardingService, 'getStatus').mockResolvedValue({} as never),
    onboardingComplete: jest.spyOn(onboardingService, 'markStepComplete').mockResolvedValue(undefined),
    onboardingDismiss: jest.spyOn(onboardingService, 'dismiss').mockResolvedValue(undefined),
    onboardingReEnable: jest.spyOn(onboardingService, 'reEnable').mockResolvedValue(undefined),
    reportFetch: jest
      .spyOn(AIReportGeneratorService.prototype, 'fetchReportData')
      .mockResolvedValue({ dateRange: { from: '2026-01-01', to: '2026-01-07' } } as never),
    reportGenerate: jest
      .spyOn(AIReportGeneratorService.prototype, 'generateWeeklyReport')
      .mockResolvedValue({ report: {}, wasFallback: true } as never),
    reportSave: jest.spyOn(AIReportGeneratorService.prototype, 'saveGeneratedReport').mockResolvedValue(ID as never),
    cacheClear: jest.spyOn(AIInsightsService.prototype, 'clearCache').mockReturnValue(0),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM generated_reports WHERE organization_id = ANY($1)', [orgIds]);
  });
});

async function insertReport(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO generated_reports (organization_id, report_type, date_range_from, date_range_to, report_data)
     VALUES ($1, 'weekly_summary', '2026-01-01', '2026-01-07', '{}') RETURNING id`,
    [orgId]
  );
  return rows[0].id as string;
}

const reportDeleted = async (_orgId: string, id: string) =>
  (await pool.query('SELECT 1 FROM generated_reports WHERE id = $1', [id])).rows.length === 0;

const called = (name: string) => async () => spies[name].mock.calls.length > 0;
const none = async () => ID;

interface Mutation {
  name: string;
  method: string;
  route: (id: string) => string;
  body?: unknown;
  /** State the request acts on; returns the id used by the route and by `happened`. */
  prepare: (orgId: string) => Promise<string>;
  /** What a member, admin or owner is answered: unchanged by the role gate. */
  allowed: number;
  /** Whether the write the route exists for was reached. */
  happened: (orgId: string, id: string) => Promise<boolean>;
}

const mutations: Mutation[] = [
  { name: 'PATCH /api/cost-recommendations/:id/resolve', method: 'PATCH', route: (id) => `/cost-recommendations/${id}/resolve`, prepare: none, allowed: 200, happened: called('recommendationStatus') },
  { name: 'PATCH /api/cost-recommendations/:id/dismiss', method: 'PATCH', route: (id) => `/cost-recommendations/${id}/dismiss`, prepare: none, allowed: 200, happened: called('recommendationStatus') },

  { name: 'PATCH /api/alerts/:id/acknowledge', method: 'PATCH', route: (id) => `/alerts/${id}/acknowledge`, body: {}, prepare: none, allowed: 200, happened: called('alertAcknowledge') },
  { name: 'PATCH /api/alerts/:id/resolve', method: 'PATCH', route: (id) => `/alerts/${id}/resolve`, prepare: none, allowed: 200, happened: called('alertResolve') },

  { name: 'PATCH /api/anomalies/:id/acknowledge', method: 'PATCH', route: (id) => `/anomalies/${id}/acknowledge`, prepare: none, allowed: 200, happened: called('anomalyAcknowledge') },
  { name: 'PATCH /api/anomalies/:id/resolve', method: 'PATCH', route: (id) => `/anomalies/${id}/resolve`, body: {}, prepare: none, allowed: 200, happened: called('anomalyResolve') },
  { name: 'PATCH /api/anomalies/:id/false-positive', method: 'PATCH', route: (id) => `/anomalies/${id}/false-positive`, body: {}, prepare: none, allowed: 200, happened: called('anomalyFalsePositive') },

  { name: 'POST /api/security/account-findings/:id/acknowledge', method: 'POST', route: (id) => `/security/account-findings/${id}/acknowledge`, body: {}, prepare: none, allowed: 200, happened: called('findingDisposition') },
  { name: 'POST /api/security/account-findings/:id/dismiss', method: 'POST', route: (id) => `/security/account-findings/${id}/dismiss`, body: { note: 'not applicable' }, prepare: none, allowed: 200, happened: called('findingDisposition') },

  { name: 'POST /api/dora/benchmarks', method: 'POST', route: () => '/dora/benchmarks', body: { metric_name: 'lead_time', target_value: 4 }, prepare: none, allowed: 200, happened: async () => doraQuery.mock.calls.length > 0 },
  { name: 'DELETE /api/dora/benchmarks/:metric', method: 'DELETE', route: () => '/dora/benchmarks/lead_time', prepare: none, allowed: 200, happened: async () => doraQuery.mock.calls.length > 0 },

  { name: 'POST /api/slos', method: 'POST', route: () => '/slos', body: { name: 'slo' }, prepare: none, allowed: 201, happened: called('sloCreate') },
  { name: 'PATCH /api/slos/:id', method: 'PATCH', route: (id) => `/slos/${id}`, body: { name: 'slo' }, prepare: none, allowed: 200, happened: called('sloUpdate') },
  { name: 'DELETE /api/slos/:id', method: 'DELETE', route: (id) => `/slos/${id}`, prepare: none, allowed: 200, happened: called('sloDelete') },

  { name: 'POST /api/compliance-frameworks', method: 'POST', route: () => '/compliance-frameworks', body: { name: 'Member floor framework' }, prepare: none, allowed: 201, happened: called('frameworkCreate') },
  { name: 'PUT /api/compliance-frameworks/:id', method: 'PUT', route: (id) => `/compliance-frameworks/${id}`, body: { description: 'changed' }, prepare: none, allowed: 200, happened: called('frameworkUpdate') },
  { name: 'DELETE /api/compliance-frameworks/:id', method: 'DELETE', route: (id) => `/compliance-frameworks/${id}`, prepare: none, allowed: 200, happened: called('frameworkDelete') },
  { name: 'POST /api/compliance-frameworks/:id/rules', method: 'POST', route: (id) => `/compliance-frameworks/${id}/rules`, body: RULE_BODY, prepare: none, allowed: 201, happened: called('ruleCreate') },
  { name: 'PUT /api/compliance-frameworks/rules/:ruleId', method: 'PUT', route: (id) => `/compliance-frameworks/rules/${id}`, body: { title: 'changed' }, prepare: none, allowed: 200, happened: called('ruleUpdate') },
  { name: 'DELETE /api/compliance-frameworks/rules/:ruleId', method: 'DELETE', route: (id) => `/compliance-frameworks/rules/${id}`, prepare: none, allowed: 200, happened: called('ruleDelete') },
  { name: 'POST /api/compliance-frameworks/:id/scan', method: 'POST', route: (id) => `/compliance-frameworks/${id}/scan`, body: {}, prepare: none, allowed: 200, happened: called('scanStart') },

  { name: 'POST /api/onboarding/complete/:step', method: 'POST', route: () => '/onboarding/complete/welcome', prepare: none, allowed: 200, happened: called('onboardingComplete') },
  { name: 'POST /api/onboarding/dismiss', method: 'POST', route: () => '/onboarding/dismiss', prepare: none, allowed: 200, happened: called('onboardingDismiss') },
  { name: 'POST /api/onboarding/re-enable', method: 'POST', route: () => '/onboarding/re-enable', prepare: none, allowed: 200, happened: called('onboardingReEnable') },

  { name: 'POST /api/ai-reports/generate', method: 'POST', route: () => '/ai-reports/generate', body: {}, prepare: none, allowed: 200, happened: async () => spies.reportFetch.mock.calls.length + spies.reportGenerate.mock.calls.length + spies.reportSave.mock.calls.length > 0 },
  { name: 'DELETE /api/ai-reports/:id', method: 'DELETE', route: (id) => `/ai-reports/${id}`, prepare: insertReport, allowed: 200, happened: reportDeleted },
  // The id travels in the route slot only so `happened` can look the row up.
  { name: 'DELETE /api/ai-reports/bulk', method: 'DELETE', route: () => '/ai-reports/bulk', prepare: insertReport, allowed: 200, happened: reportDeleted },

  { name: 'POST /api/ai-insights/clear-cache', method: 'POST', route: () => '/ai-insights/clear-cache', prepare: none, allowed: 200, happened: called('cacheClear') },
];

describe.each(mutations)('$name', ({ name, method, route, body, prepare, allowed, happened }) => {
  const bodyFor = (id: string) => (name === 'DELETE /api/ai-reports/bulk' ? { ids: [id] } : body);

  it('refuses a viewer with 403 and changes nothing', async () => {
    const id = await prepare(org.orgId);

    const response = await sendAs(org.orgId, org.viewer, method, route(id), bodyFor(id));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ...MEMBER_REFUSAL, current: 'viewer' });
    expect(await happened(org.orgId, id)).toBe(false);
  });

  it.each(['member', 'admin', 'owner'] as const)('answers a %s as before', async (role) => {
    const id = await prepare(org.orgId);

    // The token claims the lowest role: the membership is what counts.
    const response = await sendAs(org.orgId, org[role], method, route(id), bodyFor(id), 'viewer');

    expect(response.status).toBe(allowed);
    expect(await happened(org.orgId, id)).toBe(true);
  });
});

describe('the role comes from the organization being acted on', () => {
  it('an owner elsewhere who is a viewer here is refused', async () => {
    const home = await harness.buildOrg();
    await harness.addMembership(org.orgId, home.owner, 'viewer');

    const response = await sendAs(org.orgId, home.owner, 'PATCH', `/alerts/${ID}/resolve`);

    expect(response.status).toBe(403);
    expect(spies.alertResolve).not.toHaveBeenCalled();
  });
});

describe('tenant scope is unchanged', () => {
  it('every write is still addressed to the caller\'s own organization', async () => {
    await sendAs(org.orgId, org.member, 'PATCH', `/cost-recommendations/${ID}/resolve`);
    await sendAs(org.orgId, org.member, 'PATCH', `/alerts/${ID}/resolve`);
    await sendAs(org.orgId, org.member, 'PATCH', `/anomalies/${ID}/resolve`, {});
    await sendAs(org.orgId, org.member, 'POST', `/security/account-findings/${ID}/acknowledge`, {});
    await sendAs(org.orgId, org.member, 'DELETE', `/slos/${ID}`);
    await sendAs(org.orgId, org.member, 'DELETE', `/compliance-frameworks/${ID}`);
    await sendAs(org.orgId, org.member, 'POST', '/dora/benchmarks', { metric_name: 'lead_time', target_value: 4 });

    expect(spies.recommendationStatus).toHaveBeenCalledWith(ID, 'RESOLVED', org.orgId);
    expect(spies.alertResolve).toHaveBeenCalledWith(ID, org.orgId);
    expect(spies.anomalyResolve).toHaveBeenCalledWith(ID, org.orgId, undefined);
    expect(spies.findingDisposition).toHaveBeenCalledWith(org.orgId, ID, 'acknowledged', org.member, null);
    expect(spies.sloDelete).toHaveBeenCalledWith(ID, org.orgId);
    expect(spies.frameworkDelete).toHaveBeenCalledWith(ID, org.orgId);
    expect(doraQuery.mock.calls[0][1][0]).toBe(org.orgId);
  });

  it('a member cannot delete another organization\'s report', async () => {
    const other = await harness.buildOrg();
    const reportId = await insertReport(other.orgId);

    const response = await sendAs(org.orgId, org.member, 'DELETE', `/ai-reports/${reportId}`);

    expect(response.status).toBe(404);
    expect(await reportDeleted(other.orgId, reportId)).toBe(false);
  });
});

describe('routes this change leaves alone', () => {
  it('a viewer can still read what they could read before', async () => {
    jest.spyOn(AnomalyRepository.prototype, 'getActiveAnomalies').mockResolvedValue([] as never);
    jest.spyOn(AnomalyRepository.prototype, 'getStats').mockResolvedValue({} as never);
    jest.spyOn(SloService.prototype, 'listSlos').mockResolvedValue([] as never);
    jest.spyOn(ComplianceFrameworksRepository.prototype, 'findAllFrameworks').mockResolvedValue([] as never);

    for (const route of ['/anomalies', '/slos', '/compliance-frameworks', '/onboarding/status', '/dora/benchmarks', '/ai-insights/cache-stats']) {
      expect([route, (await sendAs(org.orgId, org.viewer, 'GET', route)).status]).toEqual([route, 200]);
    }
  });

  it('a viewer can still ask the AI to analyze a cost change', async () => {
    const analyze = jest.spyOn(AIInsightsService.prototype, 'analyzeCostIncrease').mockResolvedValue({} as never);

    const response = await sendAs(org.orgId, org.viewer, 'POST', '/ai-insights/analyze-cost', {});

    // Answered by the handler (its own validation or result), not by a role gate.
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
    analyze.mockRestore();
  });

  it('starting an anomaly scan is still owner and admin only', async () => {
    const response = await sendAs(org.orgId, org.member, 'POST', '/anomalies/scan');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ required: ['owner', 'admin'] });
  });
});

describe('the routers under test are the ones the application serves', () => {
  // server.ts starts the server when loaded, so it is read, not imported.
  const source = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf-8');

  it('server.ts mounts the factory routers once each, at the paths used here', () => {
    const server = source('server.ts');
    expect(server.match(/app\.use\('\/api\/anomalies', createAnomaliesRoutes\(pool\)\)/g)).toHaveLength(1);
    expect(server.match(/app\.use\('\/api\/slos', createSloRoutes\(pool\)\)/g)).toHaveLength(1);
    expect(server.match(/app\.use\('\/api\/dora', createDoraBenchmarksRoutes\(pool\)\)/g)).toHaveLength(1);
    // The other anomaly router in the tree has ungated triage routes; it must stay unmounted.
    expect(server).not.toMatch(/anomaly\.routes/);
  });

  it('routes/index.ts mounts each remaining router exactly once', () => {
    const index = source('routes/index.ts');
    for (const mount of [
      "router.use('/cost-recommendations', costRecommendationsRoutes)",
      "router.use('/alerts', alertHistoryRoutes)",
      "router.use('/security/account-findings', accountSecurityFindingsRoutes)",
      "router.use('/compliance-frameworks', complianceFrameworksRoutes)",
      "router.use('/onboarding', onboardingRoutes)",
      "router.use('/ai-reports', aiReportsRoutes)",
      "router.use('/ai-insights', aiInsightsRoutes)",
    ]) {
      expect([mount, index.split(mount).length - 1]).toEqual([mount, 1]);
    }
  });
});
