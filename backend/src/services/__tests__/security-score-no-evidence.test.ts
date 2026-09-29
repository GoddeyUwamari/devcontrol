/**
 * A security score is only recorded, and only appears in the activity feed,
 * when there was something to score. calculateRiskScore() returns 100 for an
 * organization with no resources and no findings; that default must never be
 * stored or shown as "Security score updated · 100/100".
 *
 * Live Postgres, real RiskTrackingService / ActivityFeedService. Historical
 * rows are inserted directly to cover snapshots written before this change;
 * none of them are modified.
 */
import { Pool, PoolClient } from 'pg';
import { RiskTrackingService } from '../risk-tracking.service';
import { ActivityFeedService } from '../activity-feed.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const riskTracking = new RiskTrackingService(pool);
const activityFeed = new ActivityFeedService();
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Score Evidence Org ${suffix}`, `score-evidence-${suffix}`, `Score Evidence Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertResource(orgId: string): Promise<void> {
  const arn = `arn:aws:s3:::score-evidence-${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted, compliance_issues)
     VALUES ($1, $2, $2, 's3', 'us-east-1', 'active', true, '[]')`,
    [orgId, arn]
  );
}

async function insertAccountFinding(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier)
     VALUES ($1, $2, 'networking', 'high', 't', 'r', 'arn:aws:ec2:us-east-1:1:security-group/sg-1')`,
    [orgId, `score-evidence-${uniqueSuffix()}`]
  );
}

/** Same org-scoped connection the nightly job uses. */
async function withOrgClient<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

async function snapshotCount(orgId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM risk_score_history WHERE organization_id = $1', [orgId]);
  return rows[0].n;
}

async function insertHistory(
  orgId: string,
  daysAgo: number,
  overallScore: number,
  totalResources: number,
  issues = { critical: 0, high: 0, medium: 0, low: 0 }
): Promise<void> {
  await pool.query(
    `INSERT INTO risk_score_history (
       organization_id, snapshot_date, overall_score, grade,
       encryption_score, public_access_score, backup_score, compliance_score, resource_management_score,
       total_resources, unencrypted_count, public_count, missing_backup_count, compliance_issues, orphaned_count,
       created_at)
     VALUES ($1, CURRENT_DATE - $2::int, $3, 'A', 100, 100, 100, 100, 100, $4, 0, 0, 0, $5, 0,
             NOW() - make_interval(days => $2::int))`,
    [orgId, daysAgo, overallScore, totalResources, JSON.stringify(issues)]
  );
}

async function scoreMessages(orgId: string): Promise<string[]> {
  const events = await activityFeed.getActivityFeed(orgId);
  return events.filter((e) => e.type === 'score').map((e) => e.message);
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM risk_score_history WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM account_security_findings WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('daily security score snapshot', () => {
  it('stores nothing for an organization with no resources and no findings', async () => {
    const orgId = await insertOrg();

    const stored = await withOrgClient(orgId, (client) => riskTracking.storeDailySnapshot(orgId, client));

    expect(stored).toBe(false);
    expect(await snapshotCount(orgId)).toBe(0);
  });

  it('stores a snapshot once resources have been discovered', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId);

    const stored = await withOrgClient(orgId, (client) => riskTracking.storeDailySnapshot(orgId, client));

    expect(stored).toBe(true);
    const { rows } = await pool.query('SELECT total_resources FROM risk_score_history WHERE organization_id = $1', [orgId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_resources).toBe(1);
  });

  it('stores a snapshot when there are account findings but no resources', async () => {
    const orgId = await insertOrg();
    await insertAccountFinding(orgId);

    const stored = await withOrgClient(orgId, (client) => riskTracking.storeDailySnapshot(orgId, client));

    expect(stored).toBe(true);
    const { rows } = await pool.query('SELECT overall_score FROM risk_score_history WHERE organization_id = $1', [orgId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].overall_score).toBeLessThan(100);
  });
});

describe('activity feed security score events', () => {
  it('hides historical snapshots that had nothing to score, without modifying them', async () => {
    const orgId = await insertOrg();
    await insertHistory(orgId, 1, 100, 0);
    await insertHistory(orgId, 2, 100, 0);

    expect(await scoreMessages(orgId)).toEqual([]);
    expect(await snapshotCount(orgId)).toBe(2);
  });

  it('still shows a snapshot backed by resources, including a genuine 100', async () => {
    const orgId = await insertOrg();
    await insertHistory(orgId, 1, 100, 4);

    expect(await scoreMessages(orgId)).toEqual(['Security score updated · 100/100']);
  });

  it('counts only evidence-backed snapshots when the feed collapses repeated scores', async () => {
    const orgId = await insertOrg();
    await insertHistory(orgId, 1, 88, 4);
    await insertHistory(orgId, 2, 100, 0);
    await insertHistory(orgId, 3, 83, 4);
    await insertHistory(orgId, 4, 100, 0);

    expect(await scoreMessages(orgId)).toEqual(['Security score updated · 88/100 (2 times in the last 2 days)']);
  });

  it('still shows snapshots backed by findings even with no resources', async () => {
    const orgId = await insertOrg();
    await insertHistory(orgId, 1, 95, 0, { critical: 0, high: 1, medium: 0, low: 0 });

    expect(await scoreMessages(orgId)).toEqual(['Security score updated · 95/100']);
  });

  it('shows only the evidence-backed entries when both kinds exist', async () => {
    const orgId = await insertOrg();
    await insertHistory(orgId, 1, 100, 0);
    await insertHistory(orgId, 2, 91, 7);
    await insertHistory(orgId, 3, 100, 0);

    expect(await scoreMessages(orgId)).toEqual(['Security score updated · 91/100']);
  });
});
