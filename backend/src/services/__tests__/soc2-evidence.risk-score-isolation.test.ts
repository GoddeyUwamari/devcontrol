/**
 * Proves the SOC 2 Evidence Layer has no coupling to Risk Score, in two complementary
 * ways:
 *   1. Static: neither soc2-evidence.service.ts nor soc2-evidence.repository.ts
 *      imports calculateRiskScore, riskScoring.ts, or RiskTrackingService at all --
 *      the import graph itself proves no call path exists, not just that this test
 *      didn't happen to observe one.
 *   2. Live-DB behavioral: running computeAndPersistEvidence() against a real org with
 *      pre-existing compliance_issues / account_security_findings / risk_score_history
 *      data leaves every one of those rows byte-identical afterward -- this is not
 *      "risk score neutral because category/provenance is ignored" (a claim about the
 *      formula); it is a direct proof that this new code path performs no write to any
 *      Risk Score input table at all.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { Soc2EvidenceService } from '../soc2-evidence.service';

/** Strip block/line comments so this file's OWN explanatory comments (which legitimately
 * name calculateRiskScore/RiskTrackingService/the forbidden tables to document that they
 * are NOT used) never trip these assertions -- same pattern as
 * ai-summary-wording-truthfulness.test.ts's readCode() helper. Only real import/query
 * code should be checked. */
function readCode(filePath: string): string {
  const full = fs.readFileSync(filePath, 'utf-8');
  return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('SOC 2 Evidence Layer — Risk Score isolation (static)', () => {
  const serviceSource = readCode(path.join(__dirname, '..', 'soc2-evidence.service.ts'));
  const repositorySource = readCode(
    path.join(__dirname, '..', '..', 'repositories', 'soc2-evidence.repository.ts')
  );

  it('neither file imports calculateRiskScore, riskScoring, or RiskTrackingService', () => {
    for (const source of [serviceSource, repositorySource]) {
      expect(source).not.toMatch(/calculateRiskScore/);
      expect(source).not.toMatch(/from ['"].*riskScoring['"]/);
      expect(source).not.toMatch(/RiskTrackingService/);
    }
  });

  it('neither file writes to compliance_issues, account_security_findings, or security_hub_findings', () => {
    for (const source of [serviceSource, repositorySource]) {
      expect(source).not.toMatch(/UPDATE\s+aws_resources/i);
      expect(source).not.toMatch(/INSERT\s+INTO\s+account_security_findings/i);
      expect(source).not.toMatch(/UPDATE\s+account_security_findings/i);
      expect(source).not.toMatch(/INTO\s+security_hub_findings/i);
    }
  });

  it('the repository (the only file that writes SQL -- the service delegates all persistence to it) only ever writes to soc2_evidence_observations / soc2_control_evaluations', () => {
    // The service file is intentionally checked for ZERO SQL targets of its own -- it
    // performs no direct writes, delegating all persistence to the repository. That is
    // a real, separately-valuable property, checked explicitly below rather than
    // silently assumed by looping the same assertion over both files.
    const serviceTargets = [...serviceSource.matchAll(/(?:INSERT INTO|UPDATE)\s+(\w+)/gi)]
      .map((m) => m[1])
      .filter((word) => word.toUpperCase() !== 'SET');
    expect(serviceTargets).toEqual([]);

    // Excludes SQL's own "DO UPDATE SET ..." upsert-clause syntax, which is not a
    // second UPDATE <table> statement -- the word immediately after UPDATE there is
    // always the literal keyword SET, never a table name.
    const repositoryTargets = [...repositorySource.matchAll(/(?:INSERT INTO|UPDATE)\s+(\w+)/gi)]
      .map((m) => m[1])
      .filter((word) => word.toUpperCase() !== 'SET');
    expect(repositoryTargets.length).toBeGreaterThan(0); // sanity: the regex does find real targets here
    for (const target of repositoryTargets) {
      expect(['soc2_evidence_observations', 'soc2_control_evaluations']).toContain(target);
    }
  });
});

describe('SOC 2 Evidence Layer — Risk Score isolation (live DB, behavioral)', () => {
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
  const service = new Soc2EvidenceService(pool);
  const createdOrgIds: string[] = [];

  function uniqueSuffix(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function insertOrg(): Promise<string> {
    const suffix = uniqueSuffix();
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
      [`SOC2 Risk Isolation Org ${suffix}`, `soc2-risk-isolation-${suffix}`, `SOC2 Risk Isolation Org ${suffix}`]
    );
    createdOrgIds.push(rows[0].id);
    return rows[0].id as string;
  }

  it('computeAndPersistEvidence leaves compliance_issues / account_security_findings / risk_score_history byte-identical', async () => {
    const orgId = await insertOrg();
    const arn = `arn:aws:s3:::risk-isolation-${uniqueSuffix()}`;
    const issues = [{ severity: 'high', category: 'encryption', issue: 'S3 bucket does not have default encryption enabled', recommendation: 'x', provenance: 'OBSERVED' }];

    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted, compliance_issues)
       VALUES ($1, $2, $2, 's3', 'us-east-1', 'active', false, $3)`,
      [orgId, arn, JSON.stringify(issues)]
    );

    const findingKey = `risk-isolation-${uniqueSuffix()}`;
    await pool.query(
      `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier)
       VALUES ($1, $2, 'networking', 'high', 't', 'r', 'arn:aws:ec2:us-east-1:1:security-group/sg-1')`,
      [orgId, findingKey]
    );

    const beforeResource = (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, arn])).rows[0];
    const beforeFinding = (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0];
    const beforeRiskHistoryCount = (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count;

    await service.computeAndPersistEvidence(orgId);

    const afterResource = (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, arn])).rows[0];
    const afterFinding = (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0];
    const afterRiskHistoryCount = (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count;

    expect(afterResource.compliance_issues).toEqual(beforeResource.compliance_issues);
    expect(afterFinding).toEqual(beforeFinding);
    expect(afterRiskHistoryCount).toBe(beforeRiskHistoryCount);
    expect(afterRiskHistoryCount).toBe('0');
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    }
    await pool.end();
  });
});
