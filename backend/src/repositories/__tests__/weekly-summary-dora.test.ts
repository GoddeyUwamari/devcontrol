/**
 * Live-DB coverage for the weekly-email DORA fix: getWeeklyDORAMetrics used to
 * compute Lead Time with `WHERE status = 'running'`, a deployment status this
 * codebase never actually writes (GitHub-webhook rows are only ever
 * 'success'/'failed' — see github-webhook.routes.ts), so it always matched
 * zero rows and always rendered "N/A" no matter how much real deploy history
 * existed. MTTR was a hardcoded 'N/A' string, never computed at all.
 *
 * These tests insert deployment rows shaped exactly like real GitHub-webhook
 * rows (status only ever 'success'/'failed', real deployed_at timestamps) and
 * assert Lead Time and MTTR are now real, org-scoped, and correctly fall back
 * to 'N/A' (never a fabricated 0) when there isn't enough data to measure —
 * the same property-under-test rationale as the other __tests__ files in this
 * directory: real transaction/RLS behavior, not a mocked pg client.
 */
import { Pool, PoolClient } from 'pg';
import { pool as appPool, requestContext } from '../../config/database';
import { WeeklySummaryRepository, WeeklyDataQuery } from '../weekly-summary.repository';

const repository = new WeeklySummaryRepository(appPool as unknown as Pool);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await appPool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`DORA Test Org ${suffix}`, `dora-test-org-${suffix}`, `DORA Test Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await appPool.query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, 'not-a-real-hash', 'Test User')
     RETURNING id`,
    [`dora-test-user-${suffix}@example.test`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

/** Opens a dedicated client and tags it for this org, mirroring exactly how
 * weekly-ai-summary.job.ts's sendSummaryForOrganization() scopes its work. */
async function openOrgClient(organizationId: string): Promise<PoolClient> {
  const client = await appPool.connect();
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
  return client;
}

async function insertService(client: PoolClient, organizationId: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'github-actions@webhook', 'active', $2)
     RETURNING id`,
    [`dora-test-service-${uniqueSuffix()}`, organizationId]
  );
  return rows[0].id as string;
}

/** Inserts a deployment row shaped exactly like the GitHub webhook writes one
 * (github-webhook.routes.ts:131-148): status only ever 'success' or 'failed',
 * real deployed_at, metadata carrying a head_sha — never 'running'. */
async function insertDeployment(
  client: PoolClient,
  opts: { serviceId: string; organizationId: string; status: 'success' | 'failed'; deployedAt: Date }
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id, metadata)
     VALUES ($1, 'production', 'us-east-1', $2, 'github-actions', $3, $4, $5)
     RETURNING id`,
    [
      opts.serviceId,
      opts.status,
      opts.deployedAt,
      opts.organizationId,
      JSON.stringify({ source: 'github_actions', head_sha: `sha-${uniqueSuffix()}` }),
    ]
  );
  return rows[0].id as string;
}

function weekWindow(): Pick<WeeklyDataQuery, 'startDate' | 'endDate'> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  return { startDate, endDate };
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await appPool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await appPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await appPool.end();
});

describe('WeeklySummaryRepository.getWeeklyDORAMetrics — DORA P0 fix', () => {
  it('computes a real Lead Time from consecutive GitHub-webhook-shaped successful deployments (never status=running)', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      // Three successful deploys, 2 hours apart -> average gap = 2.0 hours.
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(6) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(4) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(2) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.leadTime).toBe('2.0 hours');
      expect(result.leadTime).not.toBe('N/A');
      expect(result.benchmarks.leadTime).not.toBeNull();
      expect(['elite', 'high', 'medium', 'low']).toContain(result.benchmarks.leadTime?.level);
    } finally {
      client.release();
    }
  });

  it('reports Lead Time as N/A (never a fabricated 0) with fewer than two successful deployments', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      // Only one successful deploy this week — no gap to measure.
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(1) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.leadTime).toBe('N/A');
      expect(result.benchmarks.leadTime).toBeNull();
    } finally {
      client.release();
    }
  });

  it('computes a real MTTR from a failed -> success recovery pair', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'failed', deployedAt: hoursAgo(5) });
      // Recovered 45 minutes later.
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(4.25) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.mttr).toBe('45 minutes');
      expect(result.mttr).not.toBe('N/A');
      expect(result.benchmarks.mttr).not.toBeNull();
    } finally {
      client.release();
    }
  });

  it('reports MTTR as N/A (never a fabricated value) when there is no failed -> success recovery pair', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      // A failure with nothing after it yet, plus an unrelated success — no recovery pair exists.
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(6) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'failed', deployedAt: hoursAgo(1) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.mttr).toBe('N/A');
      expect(result.benchmarks.mttr).toBeNull();
    } finally {
      client.release();
    }
  });

  it('keeps deployment frequency and change failure rate correct and unaffected by the lead-time/MTTR fix', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(10) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(8) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'failed', deployedAt: hoursAgo(6) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(4) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      // 4 deployments over a 7-day window -> 4/7 per day.
      expect(result.deploymentFrequency).toBe(`${(4 / 7).toFixed(1)} per day`);
      expect(result.changeFailureRate).toBe(25);
      expect(result.benchmarks.deploymentFrequency).not.toBeNull();
      expect(result.benchmarks.changeFailureRate).not.toBeNull();
    } finally {
      client.release();
    }
  });

  it('returns N/A and null benchmarks for all four metrics when the org has no deployments at all', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.deploymentFrequency).toBe('0.0 per day');
      expect(result.leadTime).toBe('N/A');
      expect(result.mttr).toBe('N/A');
      expect(result.changeFailureRate).toBe(0);
      expect(result.benchmarks).toEqual({
        deploymentFrequency: null,
        leadTime: null,
        changeFailureRate: null,
        mttr: null,
      });
    } finally {
      client.release();
    }
  });

  it('isolates DORA metrics per organization — org A deployments never leak into org B metrics', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const clientA = await openOrgClient(orgA);
    const clientB = await openOrgClient(orgB);
    try {
      const serviceA = await insertService(clientA, orgA);
      // Org A gets a full, real DORA signal.
      await insertDeployment(clientA, { serviceId: serviceA, organizationId: orgA, status: 'success', deployedAt: hoursAgo(6) });
      await insertDeployment(clientA, { serviceId: serviceA, organizationId: orgA, status: 'success', deployedAt: hoursAgo(2) });

      const { startDate, endDate } = weekWindow();
      const resultA = await repository.getWeeklyDORAMetrics({ organizationId: orgA, startDate, endDate }, clientA);
      const resultB = await repository.getWeeklyDORAMetrics({ organizationId: orgB, startDate, endDate }, clientB);

      expect(resultA.leadTime).not.toBe('N/A');
      expect(resultB.deploymentFrequency).toBe('0.0 per day');
      expect(resultB.leadTime).toBe('N/A');
      expect(resultB.mttr).toBe('N/A');
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('also works when called with no explicit client, inside requestContext.run (the preview-weekly-summary HTTP route shape)', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(5) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(1) });

      const { startDate, endDate } = weekWindow();
      // Mirrors auth.middleware.ts's runWithOrgClient: the whole call runs
      // inside requestContext.run() instead of threading `client` explicitly,
      // matching how ai-insights.routes.ts's authenticated preview route
      // reaches this same function.
      const result = await requestContext.run(client, () =>
        repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate })
      );

      expect(result.leadTime).toBe('4.0 hours');
    } finally {
      client.release();
    }
  });
});
