/**
 * Live-DB coverage for the weekly email's deployment metrics.
 *
 * Policy under test -- the same definitions as the Deployments and DORA pages:
 *   - Deployment frequency counts successful deployments only.
 *   - Change failure rate is failed / (success + failed); null (never 0) when
 *     nothing finished. Rows that never finished or have an unrecognised
 *     status are in the recorded total and nothing else.
 *   - Lead time for changes and time to restore are not tracked: no
 *     deployment-gap or failed -> next-success time is derived, and nothing
 *     is graded against their bands.
 *   - Every figure is one organization's.
 *
 * Real transaction/RLS behavior, not a mocked pg client.
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
  opts: { serviceId: string; organizationId: string; status: string; deployedAt: Date }
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

describe('WeeklySummaryRepository.getWeeklyDORAMetrics — delivery metrics', () => {
  it('frequency counts successes only; the failure rate is failed / (success + failed)', async () => {
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

      expect(result.deploymentCount).toBe(4);
      expect(result.successfulDeployments).toBe(3);
      expect(result.failedDeployments).toBe(1);
      // 3 successes over the 7-day window -- the failed one is not a delivery.
      expect(result.deploymentFrequency).toBe('0.43 per day');
      expect(result.changeFailureRate).toBe(25);
      expect(result.benchmarks).toEqual({
        deploymentFrequency: { level: 'high', isCustom: false },
        changeFailureRate: { level: 'high', isCustom: false },
      });
    } finally {
      client.release();
    }
  });

  it('unfinished and unrecognised rows are recorded but enter neither the frequency nor the rate', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(9) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'failed', deployedAt: hoursAgo(7) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'deploying', deployedAt: hoursAgo(5) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'running', deployedAt: hoursAgo(3) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.deploymentCount).toBe(4);
      expect(result.successfulDeployments).toBe(1);
      expect(result.failedDeployments).toBe(1);
      expect(result.deploymentFrequency).toBe('0.14 per day');
      // 1 of 2 finished -- not 1 of 4 recorded.
      expect(result.changeFailureRate).toBe(50);
    } finally {
      client.release();
    }
  });

  it('with nothing finished: the rate is null (never 0) and nothing is graded', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'deploying', deployedAt: hoursAgo(2) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.deploymentCount).toBe(1);
      expect(result.successfulDeployments).toBe(0);
      expect(result.changeFailureRate).toBeNull();
      expect(result.benchmarks).toEqual({ deploymentFrequency: null, changeFailureRate: null });
    } finally {
      client.release();
    }
  });

  it('reports a real 0% rate when deployments finished and none failed', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(2) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result.changeFailureRate).toBe(0);
      expect(result.benchmarks.changeFailureRate).toEqual({ level: 'elite', isCustom: false });
    } finally {
      client.release();
    }
  });

  it('derives no lead time, deployment gap or time to restore, however much history exists', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const serviceId = await insertService(client, orgId);
      // A failed -> success pair and several successes: everything the old
      // gap and recovery calculations needed.
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(8) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'failed', deployedAt: hoursAgo(5) });
      await insertDeployment(client, { serviceId, organizationId: orgId, status: 'success', deployedAt: hoursAgo(4.25) });

      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(Object.keys(result).sort()).toEqual([
        'benchmarks', 'changeFailureRate', 'deploymentCount', 'deploymentFrequency',
        'failedDeployments', 'successfulDeployments',
      ]);
      expect(Object.keys(result.benchmarks).sort()).toEqual(['changeFailureRate', 'deploymentFrequency']);
    } finally {
      client.release();
    }
  });

  it('an organization with no deployments gets zero counts, a null rate and no tiers', async () => {
    const orgId = await insertOrg();
    const client = await openOrgClient(orgId);
    try {
      const { startDate, endDate } = weekWindow();
      const result = await repository.getWeeklyDORAMetrics({ organizationId: orgId, startDate, endDate }, client);

      expect(result).toEqual({
        deploymentCount: 0,
        successfulDeployments: 0,
        failedDeployments: 0,
        deploymentFrequency: '0 per day',
        changeFailureRate: null,
        benchmarks: { deploymentFrequency: null, changeFailureRate: null },
      });
    } finally {
      client.release();
    }
  });

  it('isolates the metrics per organization — org A deployments never leak into org B', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const clientA = await openOrgClient(orgA);
    const clientB = await openOrgClient(orgB);
    try {
      const serviceA = await insertService(clientA, orgA);
      await insertDeployment(clientA, { serviceId: serviceA, organizationId: orgA, status: 'success', deployedAt: hoursAgo(6) });
      await insertDeployment(clientA, { serviceId: serviceA, organizationId: orgA, status: 'failed', deployedAt: hoursAgo(2) });

      const { startDate, endDate } = weekWindow();
      const resultA = await repository.getWeeklyDORAMetrics({ organizationId: orgA, startDate, endDate }, clientA);
      const resultB = await repository.getWeeklyDORAMetrics({ organizationId: orgB, startDate, endDate }, clientB);

      expect(resultA.deploymentCount).toBe(2);
      expect(resultA.changeFailureRate).toBe(50);
      expect(resultB.deploymentCount).toBe(0);
      expect(resultB.successfulDeployments).toBe(0);
      expect(resultB.changeFailureRate).toBeNull();
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

      expect(result.successfulDeployments).toBe(2);
      expect(result.deploymentFrequency).toBe('0.29 per day');
    } finally {
      client.release();
    }
  });
});
