/**
 * GET /api/metrics/dora end to end (D4): the real router, authentication,
 * plan middleware, controller, service and repository against Postgres.
 *
 *   - invalid service / team / environment: 400 with a plain message, no
 *     database text, for a caller on a plan with DORA metrics
 *   - existing requests (period / service / team) still answer 200 with every
 *     old field, plus the new ones
 *   - the organization is the caller's, never the query string's
 *   - Enterprise custom targets still grade with the old multipliers
 *   - deployments recorded by the real GitHub webhook handler are counted
 */
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import doraMetricsRoutes from '../dora-metrics.routes';
import { DORA_BANDS } from '../../config/dora-bands';
import { DORA_FILTER_MESSAGES } from '../../services/dora-filters';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

const harness = createRoleGateHarness('dora-d4-route');
const { pool, sendAs } = harness;

let org: RoleGateOrg;
let otherOrg: RoleGateOrg;
let serviceId: string;
let teamId: string;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'custom_dora_benchmarks');
  org = await harness.buildOrg();
  otherOrg = await harness.buildOrg();
  const team = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`dora-d4-route-team-${Date.now()}`, org.orgId]
  );
  teamId = team.rows[0].id;
  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id, team_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2, $3) RETURNING id`,
    [`dora-d4-route-svc-${Date.now()}`, org.orgId, teamId]
  );
  serviceId = service.rows[0].id;
  await harness.listen((app) => {
    app.use('/api/metrics/dora', doraMetricsRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  await pool.query('DELETE FROM custom_dora_benchmarks WHERE organization_id = ANY($1)', [[org.orgId, otherOrg.orgId]]);
  await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [[org.orgId, otherOrg.orgId]]);
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM custom_dora_benchmarks WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [orgIds]);
  });
});

async function insertDeployment(orgId: string, svc: string, status: string, hoursAgo: number, environment = 'production') {
  await pool.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
     VALUES ($1, $2, 'us-east-1', $3, 'github-actions', $4, $5)`,
    [svc, environment, status, new Date(Date.now() - hoursAgo * 3_600_000), orgId]
  );
}

const get = async (route: string) => {
  const response = await sendAs(org.orgId, org.owner, 'GET', route);
  return { status: response.status, body: await response.json() };
};

describe('invalid filters: 400 with a plain message', () => {
  it.each<[string, string]>([
    ['/metrics/dora?service_id=not-a-uuid', DORA_FILTER_MESSAGES.service_id],
    ["/metrics/dora?service_id=1'%20OR%20'1'%3D'1", DORA_FILTER_MESSAGES.service_id],
    ['/metrics/dora?team_id=42', DORA_FILTER_MESSAGES.team_id],
    ['/metrics/dora?environment=prod', DORA_FILTER_MESSAGES.environment],
    ['/metrics/dora?environment=production&environment=staging', DORA_FILTER_MESSAGES.environment],
  ])('%s', async (route, message) => {
    const { status, body } = await get(route);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: message });
    expect(JSON.stringify(body)).not.toMatch(/22P02|invalid input syntax|relation|column/i);
  });
});

describe('existing requests keep working, with the new fields', () => {
  it.each([
    '/metrics/dora',
    '/metrics/dora?date_range=7d',
    '/metrics/dora?date_range=90d',
  ])('%s', async (route) => {
    await insertDeployment(org.orgId, serviceId, 'success', 2);
    const { status, body } = await get(route);
    expect(status).toBe(200);
    const data = body.data;
    for (const key of ['deploymentFrequency', 'leadTime', 'changeFailureRate', 'mttr', 'deployments', 'period',
      'previousPeriod', 'change', 'daily', 'busiestDay', 'filters', 'bands']) {
      expect(data).toHaveProperty(key);
    }
    expect(Object.keys(data.period).sort()).toEqual(['days', 'end', 'endAt', 'start', 'startAt']);
    expect(data.deployments).toEqual({ successful: 1, failed: 0, finished: 1 });
    expect(data.daily).toHaveLength(data.period.days + 1);
    expect(data.bands).toEqual(JSON.parse(JSON.stringify(DORA_BANDS)));
    expect(data.filters).toEqual({ environment: null, serviceId: null, teamId: null });
  });

  it('service, team and environment filters (the page sends service and team)', async () => {
    await insertDeployment(org.orgId, serviceId, 'success', 2);
    await insertDeployment(org.orgId, serviceId, 'failed', 3, 'staging');
    const byService = await get(`/metrics/dora?service_id=${serviceId}`);
    expect(byService.status).toBe(200);
    expect(byService.body.data.deployments).toEqual({ successful: 1, failed: 1, finished: 2 });
    expect(byService.body.data.filters).toEqual({ environment: null, serviceId, teamId: null });
    const byTeam = await get(`/metrics/dora?team_id=${teamId}&environment=production`);
    expect(byTeam.body.data.deployments).toEqual({ successful: 1, failed: 0, finished: 1 });
    expect(byTeam.body.data.filters).toEqual({ environment: 'production', serviceId: null, teamId });
    const allEnv = await get('/metrics/dora?environment=all');
    expect(allEnv.body.data.deployments.finished).toBe(2);
  });

  it("counts the caller's organization only; a query-string organization is ignored", async () => {
    await insertDeployment(org.orgId, serviceId, 'success', 2);
    const { status, body } = await get(`/metrics/dora?organization_id=${otherOrg.orgId}&organizationId=${otherOrg.orgId}`);
    expect(status).toBe(200);
    expect(body.data.deployments.finished).toBe(1);
  });

  it('nothing finished: deploymentFrequency.value is null in the JSON, not 0', async () => {
    const { body } = await get('/metrics/dora?date_range=7d');
    expect(body.data.deploymentFrequency.value).toBeNull();
    expect(body.data.busiestDay).toBeNull();
    expect(body.data.change).toEqual({ finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null });
  });
});

describe('Enterprise custom targets: unchanged multipliers', () => {
  it('t = 1/day frequency and t = 4% failure rate grade with ≥t / ≥0.5t and ≤t / ≤2t / ≤3t', async () => {
    // 30 successes + 2 failures in 30 days: exactly 1.00/day (custom elite ≥ 1; the standard band says high)
    // and 6.25% (custom high, ≤ 2 × 4).
    for (let i = 0; i < 30; i++) await insertDeployment(org.orgId, serviceId, 'success', 2 + i);
    for (let i = 0; i < 2; i++) await insertDeployment(org.orgId, serviceId, 'failed', 40 + i);
    await pool.query(
      `INSERT INTO custom_dora_benchmarks (organization_id, metric_name, target_value, target_unit, performance_label)
       VALUES ($1, 'deployment_frequency', 1, 'per_day', 'Team target'), ($1, 'change_failure_rate', 4, 'percentage', 'Team target')`,
      [org.orgId]
    );
    const { body } = await get('/metrics/dora');
    expect(body.data.deploymentFrequency).toMatchObject({ value: 1, benchmark: 'elite', isCustomBenchmark: true });
    expect(body.data.changeFailureRate).toMatchObject({ value: 6.25, benchmark: 'high', isCustomBenchmark: true });

    await pool.query('DELETE FROM custom_dora_benchmarks WHERE organization_id = $1', [org.orgId]);
    const standard = await get('/metrics/dora');
    expect(standard.body.data.deploymentFrequency).toMatchObject({ value: 1, benchmark: 'high', isCustomBenchmark: false });
    expect(standard.body.data.changeFailureRate).toMatchObject({ value: 6.25, benchmark: 'high', isCustomBenchmark: false });
  });
});

describe('deployments recorded by the GitHub webhook are counted', () => {
  const SECRET = 'dora-d4-test-secret';
  let server: http.Server;
  let base = '';
  const saved = { secret: process.env.GITHUB_WEBHOOK_SECRET, org: process.env.GITHUB_WEBHOOK_ORG_ID };

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    process.env.GITHUB_WEBHOOK_ORG_ID = org.orgId;
    // Imported after the env is set: the route reads the organization when it loads.
    const { githubWebhookHandler } = await import('../github-webhook.routes');
    const app = express();
    app.post('/api/webhooks/github', express.raw({ type: '*/*' }), githubWebhookHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env.GITHUB_WEBHOOK_SECRET = saved.secret;
    process.env.GITHUB_WEBHOOK_ORG_ID = saved.org;
  });

  async function deliver(jobId: number, conclusion: 'success' | 'failure', completedAt: Date) {
    const body = JSON.stringify({
      action: 'completed',
      repository: { name: `dora-d4-webhook-${org.orgId.slice(0, 8)}` },
      sender: { login: 'github-actions' },
      workflow_job: {
        id: jobId, run_id: jobId, name: 'deploy-backend', conclusion,
        completed_at: completedAt.toISOString(), head_sha: 'abc', html_url: 'https://example.com',
      },
    });
    const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const response = await fetch(`${base}/api/webhooks/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-GitHub-Event': 'workflow_job', 'X-Hub-Signature-256': signature },
      body,
    });
    expect(response.status).toBe(201);
  }

  it('in the current period, the previous period and the daily series', async () => {
    const jobId = Date.now() + Math.floor(Math.random() * 1e6);
    await deliver(jobId + 1, 'success', new Date(Date.now() - 2 * 3_600_000));
    await deliver(jobId + 2, 'failure', new Date(Date.now() - 3 * 3_600_000));
    await deliver(jobId + 3, 'success', new Date(Date.now() - 10 * 24 * 3_600_000));

    const { body } = await get('/metrics/dora?date_range=7d');
    expect(body.data.deployments).toEqual({ successful: 1, failed: 1, finished: 2 });
    expect(body.data.previousPeriod.deployments).toEqual({ successful: 1, failed: 0, finished: 1 });
    expect(body.data.daily.reduce((n: number, d: { total: number }) => n + d.total, 0)).toBe(2);
  });
});
