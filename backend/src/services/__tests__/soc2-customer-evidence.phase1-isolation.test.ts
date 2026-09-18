/**
 * Proves Phase 3 (customer_evidence) has no coupling to Phase 1/2's technical evidence
 * layer, Risk Score, or legacy compliance systems -- same two-part convention as
 * soc2-evidence.risk-score-isolation.test.ts:
 *   1. Static: the service/repository import graph and SQL targets prove no call path
 *      exists to soc2_evidence_observations/soc2_control_evaluations, Risk Score,
 *      compliance_issues, account_security_findings, security_hub_findings, or legacy
 *      compliance code -- not just that this test didn't happen to observe one.
 *   2. Live-DB behavioral: running a full customer-evidence lifecycle (create, review,
 *      expire, supersede) against a real org with pre-existing compliance_issues/
 *      account_security_findings/risk_score_history/soc2_control_evaluations data
 *      leaves every one of those rows byte-identical afterward, and confirms
 *      soc2_control_evaluations.customer_evidence_ids stays exactly '{}'.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { Soc2CustomerEvidenceRepository } from '../../repositories/soc2-customer-evidence.repository';
import { Soc2CustomerEvidenceService } from '../soc2-customer-evidence.service';

function readCode(filePath: string): string {
  const full = fs.readFileSync(filePath, 'utf-8');
  return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('SOC2 Customer Evidence (Phase 3) — Phase 1/2 & legacy isolation (static)', () => {
  const serviceSource = readCode(path.join(__dirname, '..', 'soc2-customer-evidence.service.ts'));
  const repositorySource = readCode(
    path.join(__dirname, '..', '..', 'repositories', 'soc2-customer-evidence.repository.ts')
  );
  const routeSource = readCode(
    path.join(__dirname, '..', '..', 'routes', 'soc2-customer-evidence.routes.ts')
  );

  it('no file imports Soc2EvidenceService, calculateRiskScore, RiskTrackingService, or legacy compliance code', () => {
    for (const source of [serviceSource, repositorySource, routeSource]) {
      expect(source).not.toMatch(/Soc2EvidenceService/);
      expect(source).not.toMatch(/computeAndPersistEvidence/);
      expect(source).not.toMatch(/calculateRiskScore/);
      expect(source).not.toMatch(/RiskTrackingService/);
      expect(source).not.toMatch(/ComplianceEngineService/);
      expect(source).not.toMatch(/complianceScanner/);
      expect(source).not.toMatch(/from ['"].*securityHub/i);
    }
  });

  it('no file instantiates an AWS SDK client or triggers discovery', () => {
    for (const source of [serviceSource, repositorySource, routeSource]) {
      expect(source).not.toMatch(/aws-sdk|@aws-sdk/);
      expect(source).not.toMatch(/awsResourceDiscovery|discoverResources/);
    }
  });

  it('no file writes to soc2_evidence_observations, soc2_control_evaluations, compliance_issues, account_security_findings, or security_hub_findings', () => {
    for (const source of [serviceSource, repositorySource]) {
      expect(source).not.toMatch(/soc2_evidence_observations|soc2_control_evaluations/);
      expect(source).not.toMatch(/UPDATE\s+aws_resources/i);
      expect(source).not.toMatch(/account_security_findings/i);
      expect(source).not.toMatch(/security_hub_findings/i);
    }
  });

  it('the repository (the only file that writes SQL) only ever targets customer_evidence', () => {
    const targets = [...repositorySource.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/gi)]
      .map((m) => m[1])
      .filter((word) => word.toUpperCase() !== 'SET');
    expect(targets.length).toBeGreaterThan(0); // sanity: the regex does find real targets here
    for (const target of targets) {
      expect(target).toBe('customer_evidence');
    }
    // No DELETE FROM customer_evidence anywhere -- no hard delete in v1.
    expect(repositorySource).not.toMatch(/DELETE\s+FROM\s+customer_evidence/i);
  });

  it('the service performs zero direct SQL of its own -- all persistence is delegated to the repository', () => {
    // Checking for an actual `.query(` call (not a SQL-keyword regex, which false-
    // positives on ordinary English prose in error messages like "...before the update
    // could be applied") -- the service has no `pool`/`client` at all, only a
    // Soc2CustomerEvidenceRepository dependency, so this call shape cannot appear
    // unless the service starts issuing SQL directly.
    expect(serviceSource).not.toMatch(/\.query\(/);
  });
});

describe('SOC2 Customer Evidence (Phase 3) — Phase 1/2 & Risk Score isolation (live DB, behavioral)', () => {
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
  const repository = new Soc2CustomerEvidenceRepository(pool);
  const service = new Soc2CustomerEvidenceService(repository);
  const createdOrgIds: string[] = [];

  function uniqueSuffix(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function insertOrg(): Promise<string> {
    const suffix = uniqueSuffix();
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
      [`Customer Evidence Isolation Org ${suffix}`, `ce-isolation-${suffix}`, `Customer Evidence Isolation Org ${suffix}`]
    );
    createdOrgIds.push(rows[0].id);
    return rows[0].id as string;
  }

  it('a full create/review/expire/supersede lifecycle leaves soc2_evidence_observations, soc2_control_evaluations (including customer_evidence_ids), compliance_issues, account_security_findings, and risk_score_history byte-identical', async () => {
    const orgId = await insertOrg();
    const arn = `arn:aws:s3:::ce-isolation-${uniqueSuffix()}`;
    const issues = [{ severity: 'high', category: 'encryption', issue: 'S3 bucket does not have default encryption enabled', recommendation: 'x', provenance: 'OBSERVED' }];

    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted, compliance_issues)
       VALUES ($1, $2, $2, 's3', 'us-east-1', 'active', false, $3)`,
      [orgId, arn, JSON.stringify(issues)]
    );

    const findingKey = `ce-isolation-${uniqueSuffix()}`;
    await pool.query(
      `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier)
       VALUES ($1, $2, 'networking', 'high', 't', 'r', 'arn:aws:ec2:us-east-1:1:security-group/sg-1')`,
      [orgId, findingKey]
    );

    await pool.query(
      `INSERT INTO soc2_control_evaluations (organization_id, criterion_id, disposition_class, evidence_summary, customer_evidence_ids, computed_at)
       VALUES ($1, 'CC6.1', 'A_OBSERVABLE', '{"supports":0,"contradicts":0,"unknown":0}', '{}', NOW())`,
      [orgId]
    );

    const before = {
      resource: (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, arn])).rows[0],
      finding: (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0],
      riskHistoryCount: (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count,
      evaluation: (await pool.query(`SELECT * FROM soc2_control_evaluations WHERE organization_id = $1 AND criterion_id = 'CC6.1'`, [orgId])).rows[0],
      observationCount: (await pool.query(`SELECT COUNT(*) FROM soc2_evidence_observations WHERE organization_id = $1`, [orgId])).rows[0].count,
    };

    // Full customer-evidence lifecycle.
    const created = await service.createCustomerEvidence(orgId, null, {
      criterionId: 'CC6.1',
      evidenceType: 'policy',
      title: 'Isolation test policy',
    });
    const reviewed = await service.reviewCustomerEvidence(orgId, created.id!, null);
    expect(reviewed.status).toBe('REVIEWED');

    const created2 = await service.createCustomerEvidence(orgId, null, {
      criterionId: 'CC6.1',
      evidenceType: 'procedure',
      title: 'Isolation test procedure',
    });
    const expired = await service.expireCustomerEvidence(orgId, created2.id!, null);
    expect(expired.status).toBe('EXPIRED');

    const created3 = await service.createCustomerEvidence(orgId, null, {
      criterionId: 'CC6.1',
      evidenceType: 'attestation',
      title: 'Original attestation',
    });
    const supersedeResult = await service.supersedeCustomerEvidence(orgId, created3.id!, null, {
      criterionId: 'CC6.1',
      evidenceType: 'attestation',
      title: 'Replacement attestation',
    });
    expect(supersedeResult.superseded.status).toBe('SUPERSEDED');

    const after = {
      resource: (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, arn])).rows[0],
      finding: (await pool.query(`SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, findingKey])).rows[0],
      riskHistoryCount: (await pool.query(`SELECT COUNT(*) FROM risk_score_history WHERE organization_id = $1`, [orgId])).rows[0].count,
      evaluation: (await pool.query(`SELECT * FROM soc2_control_evaluations WHERE organization_id = $1 AND criterion_id = 'CC6.1'`, [orgId])).rows[0],
      observationCount: (await pool.query(`SELECT COUNT(*) FROM soc2_evidence_observations WHERE organization_id = $1`, [orgId])).rows[0].count,
    };

    expect(after.resource.compliance_issues).toEqual(before.resource.compliance_issues);
    expect(after.finding).toEqual(before.finding);
    expect(after.riskHistoryCount).toBe(before.riskHistoryCount);
    expect(after.riskHistoryCount).toBe('0');
    // The Phase 1 evaluation row is completely untouched, byte-for-byte, including the
    // reserved customer_evidence_ids column -- Phase 3 never writes to this table.
    expect(after.evaluation).toEqual(before.evaluation);
    expect(after.evaluation.customer_evidence_ids).toEqual([]);
    expect(after.observationCount).toBe(before.observationCount);
    expect(after.observationCount).toBe('0');
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    }
    await pool.end();
  });
});
