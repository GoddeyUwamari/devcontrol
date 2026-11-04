/**
 * AWS connect PR B, end to end through the real discovery service: the
 * organization's connection is replaced (same AWS account, role ARN and region,
 * new row) while a scan that started under the old one is mid-run, inside its
 * cost step. The stale scan commits nothing more; it closes only its own job
 * and run rows (only while still running), with the existing approved texts;
 * the new connection's job row is untouched. Same harness as
 * awsResourceDiscovery.cost-run-record.test.ts. Placeholders only.
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource, PLACEHOLDER_ACCOUNT_ROW } from './helpers/scan-source';
import costOptimizationService from '../cost-optimization.service';
import { LeaseLostError } from '../scan-lease';
import { DISCOVERY_INTERRUPTED_MESSAGE } from '../scan-session';
import { DISCOVERY_WARNING_CONNECTION_CHANGED } from '../discovery-warnings';
import { withConnectionChange } from '../aws-connection-fence';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Connection Change Org ${suffix}`, `connection-change-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

/** B becomes active: the org's row replaced by one with the same account, role ARN and region (only the id differs). */
async function replaceConnection(orgId: string): Promise<void> {
  await withConnectionChange(pool, orgId, async (c) => {
    const { rows } = await c.query(`DELETE FROM aws_accounts WHERE org_id = $1 RETURNING account_id, region`, [orgId]);
    await c.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', $4, 'active')`,
      [orgId, PLACEHOLDER_ACCOUNT_ROW.role_arn, rows[0].account_id, rows[0].region]
    );
  });
}

function mockClients() {
  stubScanSource();
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: 'us-east-1', costExplorer: {}, ec2: {}, rds: {}, s3: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {},
    dynamodb: {}, cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: {},
  } as any);
}

const finding = { resource_id: 'i-1234567890abcdef0', resource_name: 'x', resource_type: 'EC2', issue: 'Idle Instance', description: 'x', potential_savings: 1, severity: 'LOW', aws_region: 'us-east-1', metadata: {} } as any;

afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('discovery: the connection changes mid-scan', () => {
  it('the stale scan writes nothing more; its own job and run are closed with the approved texts; the new connection\'s job row is untouched', async () => {
    const orgId = await insertOrg();
    mockClients();
    let newJobId = '';
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockImplementation(async () => {
      // B becomes active while A's scan is in its cost step, and B's first job already exists.
      await replaceConnection(orgId);
      newJobId = (await pool.query(
        `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, resource_types, regions) VALUES ($1, 'completed', NOW(), NOW(), '{}', '{}') RETURNING id`,
        [orgId]
      )).rows[0].id;
      return { observations: [{ issue: 'Idle Instance', success: true, recommendations: [finding] }], riRecommendations: [], riSucceeded: true, homeRegion: 'us-east-1' };
    });
    const newJobBefore = async () => (await pool.query(`SELECT * FROM resource_discovery_jobs WHERE id = $1`, [newJobId])).rows[0];

    await expect(new AWSResourceDiscoveryService(pool).discoverAllResources(orgId)).rejects.toMatchObject({ reason: 'account_changed' });

    // Nothing from the stale scan after the change.
    expect((await pool.query(`SELECT count(*)::int AS n FROM cost_recommendations WHERE organization_id = $1`, [orgId])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM aws_account_regions WHERE organization_id = $1 AND last_scan_status IS NOT NULL`, [orgId])).rows[0].n).toBe(0);
    // Its own job: failed, with the approved interrupted text and the unrendered code.
    const jobs = (await pool.query(`SELECT * FROM resource_discovery_jobs WHERE organization_id = $1 AND id <> $2`, [orgId, newJobId])).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE });
    if ('warnings' in jobs[0]) expect(jobs[0].warnings).toEqual([DISCOVERY_WARNING_CONNECTION_CHANGED]);
    // Its own cost run: interrupted.
    const runs = (await pool.query(`SELECT status FROM cost_analysis_runs WHERE organization_id = $1`, [orgId])).rows;
    expect(runs.map((r) => r.status)).toEqual(['interrupted']);
    // The new connection's job row: exactly as B wrote it.
    expect(await newJobBefore()).toMatchObject({ status: 'completed', error_message: null });
  });

  it('the change lands after the last fenced write: the job\'s final status is fenced too, so it is never marked completed', async () => {
    const orgId = await insertOrg();
    mockClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false, homeRegion: 'us-east-1' });
    // The connection changes right after the home-region status step, the last fenced
    // write before the job's final status update.
    const discovery = new AWSResourceDiscoveryService(pool);
    const realRecord = (discovery as any).recordHomeRegionStatus.bind(discovery);
    jest.spyOn(discovery as any, 'recordHomeRegionStatus').mockImplementation(async (...args: unknown[]) => {
      await realRecord(...args);
      await replaceConnection(orgId);
    });
    await expect(discovery.discoverAllResources(orgId)).rejects.toMatchObject({ reason: 'account_changed' });
    const jobs = (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(jobs).toEqual([{ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE }]);
  });

  it('a newer scan already closed the stale job: the stale worker does not overwrite that row', async () => {
    const orgId = await insertOrg();
    mockClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockImplementation(async () => {
      await replaceConnection(orgId);
      // A newer scan's recovery closed every running job before the stale worker finished.
      await pool.query(`UPDATE resource_discovery_jobs SET status = 'failed', error_message = 'closed by the newer scan' WHERE organization_id = $1 AND status = 'running'`, [orgId]);
      return { observations: [{ issue: 'Idle Instance', success: true, recommendations: [finding] }], riRecommendations: [], riSucceeded: true, homeRegion: 'us-east-1' };
    });
    await expect(new AWSResourceDiscoveryService(pool).discoverAllResources(orgId)).rejects.toBeInstanceOf(LeaseLostError);
    const jobs = (await pool.query(`SELECT error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(jobs).toEqual([{ error_message: 'closed by the newer scan' }]);
  });
});
