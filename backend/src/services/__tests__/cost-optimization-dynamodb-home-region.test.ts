/**
 * Multi-region PR 1, review H-1 (founder decision FD-1: cost stays home-only for every
 * organization, flag on or off): both DynamoDB detectors read the HOME region's
 * dynamodb rows only, and their recommendations are reconciled in the home region only.
 *
 *   - a dynamodb row of another region: no DynamoDB, Application Auto Scaling or
 *     CloudWatch client is built for that region (so no DescribeTable, no
 *     DescribeScalableTargets, no billed GetMetricData), and the table appears in no
 *     recommendation and in no "unknown" list;
 *   - the home row is evaluated as before (its DescribeTable is sent in the home region);
 *   - a successful home observation ends or deletes nothing of another region (the
 *     DynamoDB issues are home-scoped in the reconcile, as every home-listed issue).
 *
 * Real Postgres for the rows the detectors read and the recommendations reconciled;
 * AWS clients are fakes that record their region and refuse every call. Placeholders only.
 */
import { Pool } from 'pg';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { ISSUE_DYNAMODB_CAPACITY, ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED } from '../../config/optimization-rules';
import { TestLeases } from './helpers/scan-source';

const dbConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(dbConfig());
const leases = new TestLeases(pool);
const createdOrgIds: string[] = [];
const HOME = 'us-east-1';
const OTHER = 'eu-west-1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A provisioned table every cheap gate of both detectors lets through. */
const eligible = () => ({
  billing_mode: 'PROVISIONED',
  autoscaling_state: 'AUTOSCALING_DISABLED',
  table_status: 'ACTIVE',
  creation_date_time: new Date(Date.now() - 400 * DAY_MS).toISOString(),
  provisioned_read_capacity: 500,
  provisioned_write_capacity: 200,
  table_class: 'STANDARD',
});

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $3, 'pro', 'active') RETURNING id`,
    [`DDB Home Org ${suffix}`, `ddb-home-org-${suffix}`, `DDB Home Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

async function insertTable(orgId: string, name: string, region: string) {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, $3, 'dynamodb', $4, 'active', '{}'::jsonb, $5::jsonb)`,
    [orgId, `arn:aws:dynamodb:${region}:123456789012:table/${name}`, name, region, JSON.stringify(eligible())]
  );
}

/** Regional factories that record the region asked for; every call they make is refused. */
function recordingClients() {
  const regions: Record<string, string[]> = { dynamodb: [], autoscaling: [], cloudwatch: [] };
  const sent: Array<{ client: string; region: string; command: string }> = [];
  const refusing = (client: string, region: string) => ({
    send: jest.fn(async (command: { constructor: { name: string } }) => {
      sent.push({ client, region, command: command.constructor.name });
      throw Object.assign(new Error('placeholder refusal'), { name: 'AccessDeniedException' });
    }),
  });
  return {
    regions,
    sent,
    clients: {
      getDynamoDBClientForRegion: (region: string) => (regions.dynamodb.push(region), refusing('dynamodb', region)),
      getApplicationAutoScalingClientForRegion: (region: string) => (regions.autoscaling.push(region), refusing('autoscaling', region)),
      getCloudWatchClientForRegion: (region: string) => (regions.cloudwatch.push(region), refusing('cloudwatch', region)),
    },
  };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of ['cost_finding_detections', 'cost_recommendations', 'aws_resources', 'aws_scan_leases']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
    }
    await leases.cleanup();
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe.each([
  ['dynamodb_capacity', 'detectDynamoDBCapacityOptimization'],
  ['dynamodb_on_demand_vs_provisioned', 'detectDynamoDBOnDemandVsProvisionedOptimization'],
])('%s reads the home region\'s tables only', (_issue, detector) => {
  it('a table of another region: no client for that region, no call, no recommendation, not unknown; the home table is evaluated', async () => {
    const orgId = await insertOrg();
    await insertTable(orgId, 'placeholder-home-table', HOME);
    await insertTable(orgId, 'placeholder-other-table', OTHER);
    const { regions, sent, clients } = recordingClients();

    const result = await (costOptimizationService as any)[detector](orgId, clients, HOME);

    for (const asked of Object.values(regions)) expect(asked).not.toContain(OTHER);
    expect(sent.filter((call) => call.region === OTHER)).toEqual([]);
    expect(sent.filter((call) => call.command === 'GetMetricDataCommand' && call.region !== HOME)).toEqual([]);
    // The home table was evaluated as before: its live DescribeTable was sent in the home region.
    expect(sent).toContainEqual({ client: 'dynamodb', region: HOME, command: 'DescribeTableCommand' });
    const named = JSON.stringify(result);
    expect(named).not.toContain('placeholder-other-table');
    expect(result.issues).toEqual([]);
  });
});

describe('the DynamoDB issues are reconciled in the home region only', () => {
  it.each([ISSUE_DYNAMODB_CAPACITY, ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED])(
    '%s: a successful observation that found nothing ends the home row and leaves another region\'s row ACTIVE',
    async (issue) => {
      const orgId = await insertOrg();
      for (const [name, region] of [['placeholder-home-table', HOME], ['placeholder-other-table', OTHER]]) {
        await pool.query(
          `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata)
           VALUES ($1, $2, $2, 'DynamoDB', $3, 'placeholder', 10, 'LOW', $4, '{}')`,
          [orgId, name, issue, region]
        );
      }
      await new CostRecommendationsRepository().reconcileActiveRecommendations(
        orgId,
        [{ issue, success: true, recommendations: [] }],
        { homeRegion: HOME },
        leases.of(orgId)
      );
      await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      const { rows } = await pool.query(
        `SELECT resource_id, status FROM cost_recommendations WHERE organization_id = $1 AND issue = $2 ORDER BY resource_id`,
        [orgId, issue]
      );
      expect(rows).toEqual([{ resource_id: 'placeholder-other-table', status: 'ACTIVE' }]);
    }
  );
});
