/**
 * Real Postgres: tag_pattern rules saved before the save-time check existed
 * (inserted directly here, as a legacy row would be) are evaluated through
 * the same check by a real scan. A refused pattern is stored as an 'error'
 * finding, the resource as couldn't-evaluate in the scan's results, and the
 * score is left empty rather than 100.
 */
import { Pool } from 'pg';
import { CustomComplianceService } from '../custom-compliance.service';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';

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
const repository = new ComplianceFrameworksRepository(pool);
const service = new CustomComplianceService(pool);
const createdOrgIds: string[] = [];

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
    [`Tag Pattern Org ${suffix}`, `tag-pattern-org-${suffix}`, `Tag Pattern Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertFramework(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, `Framework ${uniqueSuffix()}`]
  );
  return rows[0].id as string;
}

/** Straight into the table, bypassing the API's check, as a legacy row would have been saved. */
async function insertTagPatternRule(frameworkId: string, orgId: string, pattern: unknown): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_framework_rules
       (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
     VALUES ($1, $2, $3, 'Owner tag pattern', 'low', 'tagging', 'tag_pattern', $4, 'Fix the tag')
     RETURNING id`,
    [frameworkId, orgId, `RULE-${uniqueSuffix()}`, JSON.stringify({ tag_key: 'Owner', pattern })]
  );
  return rows[0].id as string;
}

async function insertTaggedResource(orgId: string, owner: string): Promise<void> {
  const suffix = uniqueSuffix();
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', $4, '{"tags_state":"observed"}')`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`, JSON.stringify({ Owner: owner })]
  );
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('legacy tag_pattern rows in a real scan', () => {
  it.each([['(team)-\\1'], ['^(?=team)'], [42]])('%j: error findings, no pass, resource couldn\'t be evaluated, no score', async (pattern) => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertTagPatternRule(frameworkId, orgId, pattern);
    await insertTaggedResource(orgId, 'team-team');
    await insertTaggedResource(orgId, 'team-a');

    const scan = await service.executeScan(frameworkId, orgId);

    expect(scan).toMatchObject({
      status: 'completed',
      resources_scanned: 2,
      compliant_resources: 0,
      non_compliant_resources: 0,
      compliance_score: null,
      results: { couldnt_evaluate_resources: 2 },
    });
    const findings = await repository.findFindingsByScan(scan.id);
    expect(findings.map((f) => f.status)).toEqual(['error', 'error']);
    for (const f of findings) expect(f.issue).toMatch(/^Couldn't evaluate: Pattern /);

    // The stored rule is untouched.
    const { rows } = await pool.query(
      `SELECT conditions->'pattern' AS pattern FROM compliance_framework_rules WHERE framework_id = $1`,
      [frameworkId]
    );
    expect(rows[0].pattern).toEqual(pattern);
  });

  it('a supported legacy pattern keeps its results', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertTagPatternRule(frameworkId, orgId, '^team-[a-z]+$');
    await insertTaggedResource(orgId, 'team-a');
    await insertTaggedResource(orgId, 'Team-A');

    const scan = await service.executeScan(frameworkId, orgId);

    expect(scan).toMatchObject({ compliant_resources: 1, non_compliant_resources: 1, results: { couldnt_evaluate_resources: 0 } });
    expect(Number(scan.compliance_score)).toBe(50);
    const findings = await repository.findFindingsByScan(scan.id);
    expect(findings.map((f) => f.status).sort()).toEqual(['fail', 'pass']);
  });
});
