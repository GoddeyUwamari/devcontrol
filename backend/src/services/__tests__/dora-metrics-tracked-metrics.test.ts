/**
 * Which DORA metrics GET /api/metrics/dora reports, and from what.
 *
 *   - Deployment frequency counts deployments recorded as 'success' only.
 *   - Change failure rate is failed / (success + failed). Rows that never
 *     finished or whose status is unrecognised are in neither side.
 *   - Lead time for changes and time to restore are "not tracked", with the
 *     reason: the deployment records hold nothing to measure them from, and
 *     they are never estimated from deployment timestamps.
 *   - With nothing finished in the period there is no rate and no tier.
 *
 * The real service and repository against live Postgres.
 */
import { Pool } from 'pg';
import { pool as appPool } from '../../config/database';
import { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';
import {
  DORAMetricsService,
  LEAD_TIME_NOT_TRACKED_REASON,
  TIME_TO_RESTORE_NOT_TRACKED_REASON,
} from '../dora-metrics.service';

const repository = new DORAMetricsRepository(appPool as unknown as Pool);
// No pool for the service: industry-standard benchmarks only.
const service = new DORAMetricsService(repository);

const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildOrg(): Promise<{ orgId: string; serviceId: string }> {
  const suffix = uniqueSuffix();
  const org = await appPool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`DORA Tracked ${suffix}`, `dora-tracked-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const svc = await appPool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'github-actions@webhook', 'active', $2) RETURNING id`,
    [`dora-tracked-svc-${suffix}`, orgId]
  );
  return { orgId, serviceId: svc.rows[0].id as string };
}

const DAY = 24 * 3_600_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

async function insertDeployments(
  org: { orgId: string; serviceId: string },
  status: string,
  count: number,
  deployedAt: Date = daysAgo(1)
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await appPool.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
       VALUES ($1, 'production', 'us-east-1', $2, 'github-actions', $3, $4)`,
      [org.serviceId, status, deployedAt, org.orgId]
    );
  }
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await appPool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1::uuid[])', [createdOrgIds]);
    await appPool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [createdOrgIds]);
  }
  await appPool.end();
});

describe('DORAMetricsService.getComprehensiveMetrics', () => {
  it('reports lead time and time to restore as not tracked, with the reason and no value, however much deployment history exists', async () => {
    const org = await buildOrg();
    // History that the old gap-between-deployments queries turned into numbers.
    await insertDeployments(org, 'success', 3, daysAgo(6));
    await insertDeployments(org, 'failed', 1, daysAgo(5));
    await insertDeployments(org, 'success', 2, daysAgo(4));

    const metrics = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });

    expect(metrics.leadTime).toEqual({ tracked: false, reason: LEAD_TIME_NOT_TRACKED_REASON });
    expect(metrics.mttr).toEqual({ tracked: false, reason: TIME_TO_RESTORE_NOT_TRACKED_REASON });
    expect(metrics.leadTime).not.toHaveProperty('value');
    expect(metrics.mttr).not.toHaveProperty('value');
    expect(metrics.leadTime).not.toHaveProperty('benchmark');
    expect(metrics.mttr).not.toHaveProperty('benchmark');
  });

  it('counts only successful deployments in the frequency and only finished ones in the failure rate', async () => {
    const org = await buildOrg();
    await insertDeployments(org, 'success', 6);
    await insertDeployments(org, 'failed', 2);
    await insertDeployments(org, 'deploying', 5);
    await insertDeployments(org, 'running', 4);
    await insertDeployments(org, 'stopped', 3);

    const metrics = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });

    expect(metrics.deployments).toEqual({ successful: 6, failed: 2, finished: 8 });
    expect(metrics.deploymentFrequency).toMatchObject({
      tracked: true,
      value: 0.2, // 6 / 30
      unit: 'per day',
      benchmark: 'high',
      description: '6 successful deployments in 30 days',
    });
    expect(metrics.changeFailureRate).toMatchObject({
      tracked: true,
      value: 25, // 2 / (6 + 2)
      unit: 'percentage',
      benchmark: 'high',
      description: '2 failed out of 8 finished deployments',
    });
  });

  it('reports a real 0% failure rate when deployments finished and none failed', async () => {
    const org = await buildOrg();
    await insertDeployments(org, 'success', 4);

    const metrics = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });

    expect(metrics.changeFailureRate).toMatchObject({ value: 0, benchmark: 'elite' });
  });

  it('with nothing finished in the period: no failure rate and no tiers, even if unfinished rows exist', async () => {
    const org = await buildOrg();
    await insertDeployments(org, 'deploying', 3);
    await insertDeployments(org, 'running', 2);
    // Finished, but outside the 7-day period.
    await insertDeployments(org, 'failed', 2, daysAgo(20));

    const metrics = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });

    expect(metrics.deployments).toEqual({ successful: 0, failed: 0, finished: 0 });
    expect(metrics.changeFailureRate).toMatchObject({
      tracked: true, value: null, benchmark: null, description: 'No finished deployments in this period',
    });
    expect(metrics.deploymentFrequency).toMatchObject({ tracked: true, value: 0, benchmark: null });
    expect(metrics.period.days).toBe(7);
  });

  it('reports no trend for any metric: none is computed from real data', async () => {
    const org = await buildOrg();
    await insertDeployments(org, 'success', 2);

    const metrics = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });

    for (const metric of [metrics.deploymentFrequency, metrics.leadTime, metrics.changeFailureRate, metrics.mttr]) {
      expect(metric).not.toHaveProperty('trend');
    }
  });

  it("never counts another organization's deployments", async () => {
    const orgA = await buildOrg();
    const orgB = await buildOrg();
    await insertDeployments(orgA, 'success', 3);
    await insertDeployments(orgB, 'success', 30);
    await insertDeployments(orgB, 'failed', 30);

    const metrics = await service.getComprehensiveMetrics({ organizationId: orgA.orgId, dateRange: '30d' });

    expect(metrics.deployments).toEqual({ successful: 3, failed: 0, finished: 3 });
    expect(metrics.changeFailureRate.value).toBe(0);
  });
});
