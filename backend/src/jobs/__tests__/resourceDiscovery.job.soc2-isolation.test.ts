/**
 * Phase 5 -- proves the ACTUAL production trigger path (ResourceDiscoveryJob ->
 * Soc2EvidenceService.computeAndPersistEvidence(), exactly as wired in
 * resourceDiscovery.job.ts) leaves Risk Score, legacy compliance, and customer
 * evidence completely untouched -- not just the bare service in isolation
 * (soc2-evidence.risk-score-isolation.test.ts / soc2-customer-evidence.phase1-isolation
 * .test.ts already prove that for direct calls to the service).
 *
 * Only AWSResourceDiscoveryService is mocked here (no real AWS calls) -- Soc2Evidence
 * Service is the REAL implementation, driven through the REAL job class's REAL
 * runDiscoveryForAllOrganizations()/triggerManualScan() path.
 */
import { Pool } from 'pg';

const mockDiscoverAllResources = jest.fn();

jest.mock('../../services/awsResourceDiscovery', () => ({
  AWSResourceDiscoveryService: jest.fn().mockImplementation(() => ({
    discoverAllResources: mockDiscoverAllResources,
  })),
}));

import { ResourceDiscoveryJob } from '../resourceDiscovery.job';

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
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, is_active)
     VALUES ($1, $2, $3, 'free', 'free', true)
     RETURNING id`,
    [`SOC2 Job Isolation Org ${suffix}`, `soc2-job-isolation-${suffix}`, `SOC2 Job Isolation Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

describe('ResourceDiscoveryJob -> real Soc2EvidenceService — Risk Score / legacy / customer-evidence isolation (live DB, actual trigger path)', () => {
  it('running the real scheduled trigger for an organization with pre-existing Risk Score, legacy compliance, and customer-evidence data leaves all of it byte-identical, and never touches AWS or Security Hub', async () => {
    const orgId = await insertOrg();

    // Only this organization is "active" and in scope for this assertion; other
    // pre-existing active organizations in the shared test DB may also be processed by
    // this run (see resourceDiscovery.job.test.ts's own note) -- irrelevant here since
    // every assertion below is scoped to this orgId specifically.
    mockDiscoverAllResources.mockResolvedValue({
      job_id: `job-${uniqueSuffix()}`,
      resources_discovered: 0,
      resources_updated: 0,
      resources_deleted: 0,
      errors: [],
    });

    const s3Arn = `arn:aws:s3:::job-isolation-${uniqueSuffix()}`;
    const issues = [{ severity: 'high', category: 'encryption', issue: 'S3 bucket does not have default encryption enabled', recommendation: 'x', provenance: 'OBSERVED' }];
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted, compliance_issues)
       VALUES ($1, $2, $2, 's3', 'us-east-1', 'active', false, $3)`,
      [orgId, s3Arn, JSON.stringify(issues)]
    );

    const findingKey = `job-isolation-${uniqueSuffix()}`;
    await pool.query(
      `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier)
       VALUES ($1, $2, 'networking', 'high', 't', 'r', 'arn:aws:ec2:us-east-1:1:security-group/sg-1')`,
      [orgId, findingKey]
    );

    await pool.query(
      `INSERT INTO customer_evidence (organization_id, criterion_id, evidence_type, title)
       VALUES ($1, 'CC6.1', 'policy', 'Pre-existing customer policy')`,
      [orgId]
    );

    const before = {
      resource: (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, s3Arn])).rows[0],
      finding: (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0],
      riskHistoryCount: (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count,
      customerEvidence: (await pool.query(`SELECT * FROM customer_evidence WHERE organization_id = $1 ORDER BY created_at`, [orgId])).rows,
      securityHubCount: (await pool.query(`SELECT COUNT(*) FROM security_hub_findings WHERE organization_id = $1`, [orgId])).rows[0].count,
    };

    const job = new ResourceDiscoveryJob(pool);
    await job.triggerManualScan();

    const after = {
      resource: (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, s3Arn])).rows[0],
      finding: (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0],
      riskHistoryCount: (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count,
      customerEvidence: (await pool.query(`SELECT * FROM customer_evidence WHERE organization_id = $1 ORDER BY created_at`, [orgId])).rows,
      securityHubCount: (await pool.query(`SELECT COUNT(*) FROM security_hub_findings WHERE organization_id = $1`, [orgId])).rows[0].count,
    };

    expect(after.resource.compliance_issues).toEqual(before.resource.compliance_issues);
    expect(after.finding).toEqual(before.finding);
    expect(after.riskHistoryCount).toBe(before.riskHistoryCount);
    expect(after.riskHistoryCount).toBe('0');
    expect(after.customerEvidence).toEqual(before.customerEvidence);
    expect(after.securityHubCount).toBe(before.securityHubCount);
    expect(after.securityHubCount).toBe('0');

    // The real SOC2 computation genuinely ran through the real trigger path (proves
    // this isn't a vacuous pass because computation silently no-op'd) and its own
    // customer_evidence_ids column stayed exactly '{}', per soc2_control_evaluations'
    // own migration comment -- Phase 1/5 never wires real customer_evidence ids in.
    const evaluations = await pool.query(
      `SELECT criterion_id, customer_evidence_ids FROM soc2_control_evaluations WHERE organization_id = $1`,
      [orgId]
    );
    expect(evaluations.rows.length).toBe(6);
    for (const row of evaluations.rows) {
      expect(row.customer_evidence_ids).toEqual([]);
    }

    // No AWS SDK client was ever touched -- discoverAllResources is a mock, and
    // Soc2EvidenceService performs zero AWS calls (see its own docblock/isolation test).
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(orgId);
  });
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
