/**
 * Live-DB coverage for the new Security Hub foundation tables' RLS/tenant isolation and
 * upsert-only ingestion semantics. Same real-Postgres convention as
 * account-security-findings-lifecycle.test.ts ("test 26") -- the property under test is
 * real RLS policy enforcement, not something a mocked pg client could verify.
 */
import { Pool } from 'pg';
import { SecurityHubFindingsRepository } from '../security-hub-findings.repository';
import { SecurityHubStateRepository } from '../security-hub-state.repository';
import { SecurityHubFindingEvidence } from '../../types/security-hub-foundation.types';

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
const findingsRepo = new SecurityHubFindingsRepository();
const stateRepo = new SecurityHubStateRepository();
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`SH Findings Org ${suffix}`, `sh-findings-org-${suffix}`, `SH Findings Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function fakeFinding(overrides: Partial<SecurityHubFindingEvidence> = {}): SecurityHubFindingEvidence {
  const now = new Date().toISOString();
  return {
    findingId: `arn:aws:securityhub:us-east-1:123456789012:subscription/cis-aws-foundations-benchmark/v/5.0.0/1.9/finding/${uniqueSuffix()}`,
    productArn: 'arn:aws:securityhub:us-east-1::product/aws/securityhub',
    region: 'us-east-1',
    title: 'MFA should be enabled for all IAM users that have a console password',
    severity: 'high',
    complianceStatus: 'FAILED',
    recordState: 'ACTIVE',
    workflowStatus: 'NEW',
    securityControlId: 'IAM.5',
    associatedStandardIds: ['cis-aws-foundations-benchmark/v/5.0.0'],
    relatedRequirements: [],
    resourceType: 'AwsIamUser',
    resourceId: 'AIDAEXAMPLE',
    securityHubCreatedAt: now,
    securityHubUpdatedAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

async function fetchRow(orgId: string, findingId: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  const { rows } = await pool.query(
    `SELECT * FROM security_hub_findings WHERE organization_id = $1 AND finding_id = $2`,
    [orgId, findingId]
  );
  return rows[0];
}

describe('SecurityHubFindingsRepository — upsert-only ingestion', () => {
  it('upserts by (organization_id, finding_id) — a re-ingested finding updates the same row, not a duplicate', async () => {
    const orgId = await insertOrg();
    const finding = fakeFinding();

    await findingsRepo.upsertFindings(orgId, [finding]);
    const first = await fetchRow(orgId, finding.findingId);
    expect(first.compliance_status).toBe('FAILED');

    await findingsRepo.upsertFindings(orgId, [{ ...finding, complianceStatus: 'PASSED' }]);
    const second = await fetchRow(orgId, finding.findingId);
    expect(second.id).toBe(first.id);
    expect(second.compliance_status).toBe('PASSED');
  });

  it('preserves multiple Compliance.RelatedRequirements strings verbatim, and defaults to [] when AWS provides none', async () => {
    const orgId = await insertOrg();
    const withRequirements = fakeFinding({
      securityControlId: 'IAM.3',
      relatedRequirements: ['PCI DSS v4.0.1/8.3.9', 'PCI DSS v4.0.1/8.6.3', 'NIST.800-53.r5 AC-2(1)'],
    });
    await findingsRepo.upsertFindings(orgId, [withRequirements]);
    const row = await fetchRow(orgId, withRequirements.findingId);
    expect(row.related_requirements).toEqual(['PCI DSS v4.0.1/8.3.9', 'PCI DSS v4.0.1/8.6.3', 'NIST.800-53.r5 AC-2(1)']);

    const withoutRequirements = fakeFinding({ securityControlId: 'IAM.5' });
    await findingsRepo.upsertFindings(orgId, [withoutRequirements]);
    const defaultRow = await fetchRow(orgId, withoutRequirements.findingId);
    expect(defaultRow.related_requirements).toEqual([]);
  });

  it('never deletes or archives a finding on its own — absence from a later upsert batch leaves the row untouched', async () => {
    const orgId = await insertOrg();
    const finding = fakeFinding();
    await findingsRepo.upsertFindings(orgId, [finding]);

    // Simulate a later sync that doesn't mention this finding at all (e.g. it was on a
    // page that failed, or a different control's findings were ingested instead).
    await findingsRepo.upsertFindings(orgId, [fakeFinding({ securityControlId: 'IAM.3' })]);

    const stillThere = await fetchRow(orgId, finding.findingId);
    expect(stillThere).toBeDefined();
    expect(stillThere.record_state).toBe('ACTIVE');
  });

  it('getFreshActiveFindingsForControl excludes findings older than the freshness cutoff', async () => {
    const orgId = await insertOrg();
    const finding = fakeFinding({ securityControlId: 'IAM.5' });
    await findingsRepo.upsertFindings(orgId, [finding]);

    const future = new Date(Date.now() + 60_000);
    const fresh = await findingsRepo.getFreshActiveFindingsForControl(orgId, 'IAM.5', future);
    expect(fresh).toHaveLength(0);

    const past = new Date(Date.now() - 60_000);
    const stale = await findingsRepo.getFreshActiveFindingsForControl(orgId, 'IAM.5', past);
    expect(stale).toHaveLength(1);
  });

  it('getAllFreshActiveFindingsGroupedByControl groups multiple controls in one query, respecting the same freshness cutoff', async () => {
    const orgId = await insertOrg();
    await findingsRepo.upsertFindings(orgId, [
      fakeFinding({ securityControlId: 'IAM.5' }),
      fakeFinding({ securityControlId: 'IAM.3' }),
    ]);

    const past = new Date(Date.now() - 60_000);
    const grouped = await findingsRepo.getAllFreshActiveFindingsGroupedByControl(orgId, past);
    expect(grouped.get('IAM.5')).toHaveLength(1);
    expect(grouped.get('IAM.3')).toHaveLength(1);

    const future = new Date(Date.now() + 60_000);
    const groupedStale = await findingsRepo.getAllFreshActiveFindingsGroupedByControl(orgId, future);
    expect(groupedStale.size).toBe(0);
  });
});

describe('organization isolation — Security Hub findings and state', () => {
  it('a finding ingested for org A is invisible when read as org B', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const finding = fakeFinding({ securityControlId: 'IAM.5' });
    await findingsRepo.upsertFindings(orgA, [finding]);

    const past = new Date(Date.now() - 60_000);
    const asOrgB = await findingsRepo.getFreshActiveFindingsForControl(orgB, 'IAM.5', past);
    expect(asOrgB).toHaveLength(0);

    const asOrgA = await findingsRepo.getFreshActiveFindingsForControl(orgA, 'IAM.5', past);
    expect(asOrgA).toHaveLength(1);
  });

  it('org A cannot read org B Security Hub capability state', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();

    await stateRepo.recordSyncResult(orgB, {
      capability: { status: 'ENABLED', checkedAt: new Date().toISOString(), error: null },
      enabledStandards: [],
      syncStatus: 'COMPLETED',
      syncError: null,
      pagesProcessed: 1,
      findingsCount: 0,
    });

    const stateAsOrgA = await stateRepo.get(orgA);
    expect(stateAsOrgA).toBeNull();

    const stateAsOrgB = await stateRepo.get(orgB);
    expect(stateAsOrgB?.capabilityStatus).toBe('ENABLED');
  });
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
