/**
 * C1b: an idle RDS finding's instance-hour estimate through the real
 * reconcile, the stats every savings surface reads (getStats), the "still
 * detected" record of a decided finding, and the run record's counts.
 *
 *   - An existing ACTIVE v1 row ($0, no basis, Low) is replaced by the v2 row
 *     on the next successful scan: the estimate, its severity and basis. No
 *     migration, no backfill.
 *   - getStats counts the estimate once in the firm total and in
 *     byResourceType.RDS, never in the upper bound; an unpriced idle RDS finding
 *     stays "unestimated", never $0 in a total.
 *   - A DISMISSED v1 row keeps its stored figure; its detection row carries the
 *     new estimate (shown "not counted while resolved").
 *   - The run record stores priced / no_price counts by reason, never IDs.
 *
 * Live database, real reconcile under a real scan lease. Placeholders only.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import { ISSUE_RDS_IDLE_INSTANCE } from '../../config/optimization-rules';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import { fakeClient } from '../../services/__tests__/helpers/low-activity-aws';
import costOptimizationService from '../../services/cost-optimization.service';
import { summarizeDetectors } from '../../services/cost-analysis-outcome';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new CostRecommendationsRepository();
const leases = new TestLeases(pool);
const createdOrgIds: string[] = [];
const HOME = 'us-east-1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const service = costOptimizationService as any;

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`C1b Pricing ${suffix}`, `c1b-pricing-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

/** An idle DB instance as DescribeDBInstances returns it (placeholders). */
const instance = (id: string, overrides: Record<string, unknown> = {}) => ({
  DBInstanceIdentifier: id, DBInstanceStatus: 'available', Engine: 'postgres', LicenseModel: 'postgresql-license',
  DBInstanceClass: 'db.t3.medium', MultiAZ: false, AvailabilityZone: 'us-east-1a', InstanceCreateTime: new Date(Date.now() - 90 * DAY),
  DBSubnetGroup: { DBSubnetGroupName: 'placeholder', Subnets: [{ SubnetIdentifier: 'subnet-placeholder', SubnetOutpost: {} }] },
  ...overrides,
});

/** Every hour of the window: no connections, CPU 1%, IOPS 1 -- idle. */
const idleCloudWatch = () => fakeClient((command: any) => {
  const start = (command.input.StartTime as Date).getTime();
  const end = (command.input.EndTime as Date).getTime();
  const Timestamps: Date[] = [];
  for (let t = start; t < end; t += HOUR) Timestamps.push(new Date(t));
  return { MetricDataResults: (command.input.MetricDataQueries as any[]).map((q) => ({ Id: q.Id, Timestamps, Values: Timestamps.map(() => (q.MetricStat.Metric.MetricName === 'DatabaseConnections' ? 0 : 1)), StatusCode: 'Complete' })) };
});

async function scan(instances: unknown[]): Promise<{ observation: DetectorObservation; result: any }> {
  const result = await service.detectIdleRDSInstances({ rds: fakeClient(() => ({ DBInstances: instances })), cloudWatch: idleCloudWatch() }, HOME);
  const recommendations: CreateRecommendationRequest[] = result.issues.map((issue: any) => ({
    resource_id: issue.resourceId, resource_name: issue.resourceName, resource_type: issue.resourceType, issue: issue.issue,
    description: issue.description, potential_savings: issue.potentialSavings, severity: issue.severity, aws_region: issue.awsRegion, metadata: issue.metadata,
  }));
  return {
    result,
    observation: { issue: ISSUE_RDS_IDLE_INSTANCE, success: result.success, recommendations, unknownResourceIds: result.unknownResourceIds, endActiveForUnknown: result.endActiveForUnknown, rdsIdle: result.rdsIdle },
  };
}

const reconcile = (orgId: string, observations: DetectorObservation[], runId: string | null = null) =>
  repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: HOME }, leases.of(orgId), runId);

/** A row as C1 (rule v1) stored it: $0, no basis, Low. */
async function insertV1Row(orgId: string, resourceId: string, status: 'ACTIVE' | 'DISMISSED') {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, status, aws_region, metadata)
     VALUES ($1, $2, $2, 'RDS', $3, 'placeholder', 0, 'LOW', $4, $5, $6::jsonb)`,
    [orgId, resourceId, ISSUE_RDS_IDLE_INSTANCE, status, HOME, JSON.stringify({ rule_version: 1, savings_note: 'no_price_source', severity_basis: 'fixed_low_unknown_price' })]
  );
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('C1b: an existing idle RDS finding, before and after', () => {
  it('an ACTIVE v1 row ($0 / Low / no basis) becomes the v2 estimate on the next successful scan ($52.56 / Medium / estimated:)', async () => {
    const org = await insertOrg();
    await insertV1Row(org, 'placeholder-db-1', 'ACTIVE');
    const before = await repository.getStats(org);
    expect(before).toMatchObject({ total_potential_savings: 0, estimated_findings: 0, unestimated_findings: 1, by_severity: { high: 0, medium: 0, low: 1 } });

    const { observation } = await scan([instance('placeholder-db-1')]);
    await reconcile(org, [observation]);

    const { rows } = await pool.query(
      `SELECT potential_savings, severity, status, metadata FROM cost_recommendations WHERE organization_id = $1 AND resource_id = 'placeholder-db-1'`, [org]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ potential_savings: '52.56', severity: 'MEDIUM', status: 'ACTIVE' });
    expect(rows[0].metadata).toMatchObject({ rule_version: 2, price_per_hour: 0.072, price_region: HOME, price_deployment: 'Single-AZ', price_engine_label: 'PostgreSQL' });
    expect(rows[0].metadata.savings_basis).toMatch(/^estimated: the us-east-1 on-demand list price for db\.t3\.medium PostgreSQL Single-AZ instance hours/);
    expect(rows[0].metadata.savings_note).toBeUndefined();

    const after = await repository.getStats(org);
    expect(after).toMatchObject({
      total_potential_savings: 52.56, potential_savings_by_resource_type: { RDS: 52.56 },
      potential_savings_ceiling: 0, potential_savings_ceiling_by_resource_type: {},
      estimated_findings: 1, unestimated_findings: 0, by_severity: { high: 0, medium: 1, low: 0 },
    });
  });

  it('with no exact price (unknown licence model), the row stays $0 / Low / no basis and adds nothing to any total', async () => {
    const org = await insertOrg();
    const { observation } = await scan([instance('placeholder-db-2', { LicenseModel: undefined })]);
    await reconcile(org, [observation]);
    const { rows } = await pool.query(`SELECT potential_savings, severity, metadata FROM cost_recommendations WHERE organization_id = $1`, [org]);
    expect(rows[0]).toMatchObject({ potential_savings: '0.00', severity: 'LOW' });
    expect(rows[0].metadata).toMatchObject({ rule_version: 2, savings_note: 'missing_license_model', severity_basis: 'fixed_low_unknown_price' });
    expect(rows[0].metadata.savings_basis).toBeUndefined();
    expect(await repository.getStats(org)).toMatchObject({ total_potential_savings: 0, potential_savings_ceiling: 0, estimated_findings: 0, unestimated_findings: 1 });
  });

  it('priced and unpriced together: the total is the priced estimates once each', async () => {
    const org = await insertOrg();
    const { observation } = await scan([
      instance('placeholder-db-3'),
      instance('placeholder-db-4', { DBInstanceClass: 'db.m5.large' }),
      instance('placeholder-db-5', { Engine: 'oracle-ee-cdb', LicenseModel: 'bring-your-own-license' }),
    ]);
    await reconcile(org, [observation]);
    await reconcile(org, [observation]); // a second scan: still counted once
    expect(await repository.getStats(org)).toMatchObject({
      total_potential_savings: 182.5, potential_savings_by_resource_type: { RDS: 182.5 },
      estimated_findings: 2, unestimated_findings: 1, by_severity: { high: 1, medium: 1, low: 1 },
    });
  });

  it('a DISMISSED v1 row keeps its stored $0; its still-detected record carries the new estimate', async () => {
    const org = await insertOrg();
    await insertV1Row(org, 'placeholder-db-6', 'DISMISSED');
    const { observation } = await scan([instance('placeholder-db-6')]);
    await reconcile(org, [observation]);
    const { rows: decided } = await pool.query(`SELECT potential_savings, status FROM cost_recommendations WHERE organization_id = $1`, [org]);
    expect(decided).toEqual([{ potential_savings: '0.00', status: 'DISMISSED' }]);
    const { rows: detection } = await pool.query(`SELECT outcome, potential_savings, severity, metadata FROM cost_finding_detections WHERE organization_id = $1`, [org]);
    expect(detection[0]).toMatchObject({ outcome: 'detected', potential_savings: '52.56', severity: 'MEDIUM' });
    expect(detection[0].metadata.savings_basis).toMatch(/^estimated:/);
    expect(await repository.getStats(org)).toMatchObject({ total_potential_savings: 0, active_recommendations: 0 });
  });
});

describe('C1b: priced / no_price counts on the run record', () => {
  it('stores priced and no_price by reason with the other counts; no instance IDs', async () => {
    const org = await insertOrg();
    const { observation } = await scan([
      instance('placeholder-db-7'),
      instance('placeholder-db-8', { AvailabilityZone: 'us-east-1-bos-1a' }),
      instance('placeholder-db-9', { Engine: 'db2-se', LicenseModel: 'marketplace-license' }),
    ]);
    const { rows: inserted } = await pool.query(
      `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
       VALUES ($1, 'completed', 'discovery', $2::jsonb, NOW(), NOW(), NOW()) RETURNING id`,
      [org, JSON.stringify(summarizeDetectors([observation], true, []).checks)]
    );
    await reconcile(org, [observation], inserted[0].id);
    const { rows: stored } = await pool.query('SELECT checks FROM cost_analysis_runs WHERE id = $1', [inserted[0].id]);
    const check = stored[0].checks.find((c: any) => c.issue === ISSUE_RDS_IDLE_INSTANCE);
    expect(check).toMatchObject({ rule_id: 'rds_idle', outcome: 'complete', detected: 3 });
    expect(check.rds_idle).toMatchObject({
      evaluated: 3, flagged: 3, priced: 1,
      no_price: {
        missing_engine_or_class: 0, missing_license_model: 0, missing_deployment: 0, unknown_placement: 0, outposts: 0,
        local_zone: 1, unsupported_engine_or_license: 1, no_price_for_region: 0, no_price_for_configuration: 0,
      },
    });
    expect(JSON.stringify(stored[0].checks)).not.toMatch(/placeholder-db|subnet-/);
  });
});
