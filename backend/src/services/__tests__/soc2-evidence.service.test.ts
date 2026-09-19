/**
 * Live-DB coverage for Soc2EvidenceService.computeAndPersistEvidence() -- the property
 * under test is real three-valued-logic SQL semantics (NULL handling), real JSONB
 * matching against compliance_issues, and real completeness gating against
 * resource_discovery_jobs, none of which a mocked pg client could verify with
 * confidence. Same real-Postgres convention as awsResources.repository.truthfulness.test.ts
 * / security-hub-findings-rls.test.ts.
 *
 * This service performs ZERO AWS API calls -- every test here only ever inserts rows
 * directly into aws_resources / account_security_findings / resource_discovery_jobs
 * (simulating what discovery would have already persisted) and then calls the service.
 */
import { Pool } from 'pg';
import { Soc2EvidenceService } from '../soc2-evidence.service';
import { Soc2EvidenceRepository } from '../../repositories/soc2-evidence.repository';

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
const repository = new Soc2EvidenceRepository(pool);
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
    [`SOC2 Service Org ${suffix}`, `soc2-service-org-${suffix}`, `SOC2 Service Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertResource(
  orgId: string,
  overrides: {
    resource_type: string;
    is_encrypted?: boolean | null;
    is_public?: boolean | null;
    has_backup?: boolean | null;
    compliance_issues?: any[];
  }
): Promise<string> {
  const arn = `arn:aws:${overrides.resource_type}:us-east-1:1:resource/${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO aws_resources
      (organization_id, resource_arn, resource_id, resource_type, region, status,
       is_encrypted, is_public, has_backup, compliance_issues)
     VALUES ($1, $2, $3, $4, 'us-east-1', 'active', $5, $6, $7, $8)`,
    [
      orgId,
      arn,
      arn,
      overrides.resource_type,
      overrides.is_encrypted ?? null,
      overrides.is_public ?? null,
      overrides.has_backup ?? null,
      JSON.stringify(overrides.compliance_issues ?? []),
    ]
  );
  return arn;
}

async function insertFinding(
  orgId: string,
  overrides: {
    category: 'networking' | 'iam';
    resource_identifier: string;
    evidence?: any;
    status?: 'active' | 'resolved';
  }
): Promise<string> {
  const findingKey = `test-${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO account_security_findings
      (organization_id, finding_key, category, severity, title, recommendation,
       resource_identifier, status, evidence)
     VALUES ($1, $2, $3, 'high', 'test finding', 'test recommendation', $4, $5, $6)`,
    [
      orgId,
      findingKey,
      overrides.category,
      overrides.resource_identifier,
      overrides.status ?? 'active',
      overrides.evidence ? JSON.stringify(overrides.evidence) : null,
    ]
  );
  return findingKey;
}

async function insertDiscoveryJob(orgId: string, complianceScanCompleted: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, compliance_scan_completed, completed_at)
     VALUES ($1, 'completed', $2, NOW())`,
    [orgId, complianceScanCompleted]
  );
}

async function observationsFor(orgId: string, criterionId: string) {
  return repository.getObservations(orgId, criterionId);
}

describe('Soc2EvidenceService — CC6.1 encryption', () => {
  it('is_encrypted true -> SUPPORTS; false -> CONTRADICTS; null -> UNKNOWN', async () => {
    const orgId = await insertOrg();
    const encrypted = await insertResource(orgId, { resource_type: 's3', is_encrypted: true });
    const unencrypted = await insertResource(orgId, { resource_type: 's3', is_encrypted: false });
    const unknown = await insertResource(orgId, { resource_type: 's3', is_encrypted: null });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.1');

    expect(observations.find((o) => o.resource_arn === encrypted)?.result).toBe('SUPPORTS');
    expect(observations.find((o) => o.resource_arn === unencrypted)?.result).toBe('CONTRADICTS');
    expect(observations.find((o) => o.resource_arn === unknown)?.result).toBe('UNKNOWN');

    for (const o of observations) {
      expect(o.provenance).toBe('OBSERVED');
    }
  });

  it('never converts null to false (negative test)', async () => {
    const orgId = await insertOrg();
    const unknown = await insertResource(orgId, { resource_type: 'rds', is_encrypted: null });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.1');
    const obs = observations.find((o) => o.resource_arn === unknown);

    expect(obs?.result).not.toBe('CONTRADICTS');
    expect(obs?.result).toBe('UNKNOWN');
  });

  it('aurora resources always resolve UNKNOWN, regardless of the stored (untrustworthy, generic-path-stubbed) is_encrypted value', async () => {
    const orgId = await insertOrg();
    // Simulates the generic-inventory path's hardcoded false -- not real evidence.
    const auroraArn = await insertResource(orgId, { resource_type: 'aurora', is_encrypted: false });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.1');
    const obs = observations.find((o) => o.resource_arn === auroraArn);

    expect(obs?.result).toBe('UNKNOWN');
  });
});

describe('Soc2EvidenceService — CC6.6 public exposure (EC2/RDS)', () => {
  it('is_public true -> CONTRADICTS; false -> SUPPORTS; null -> UNKNOWN', async () => {
    const orgId = await insertOrg();
    const publicRes = await insertResource(orgId, { resource_type: 'ec2', is_public: true });
    const privateRes = await insertResource(orgId, { resource_type: 'ec2', is_public: false });
    const unknownRes = await insertResource(orgId, { resource_type: 'rds', is_public: null });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');

    expect(observations.find((o) => o.resource_arn === publicRes)?.result).toBe('CONTRADICTS');
    expect(observations.find((o) => o.resource_arn === privateRes)?.result).toBe('SUPPORTS');
    expect(observations.find((o) => o.resource_arn === unknownRes)?.result).toBe('UNKNOWN');
  });
});

describe('Soc2EvidenceService — CC6.6 public exposure (S3, enhanced-check based, not is_public)', () => {
  it('a checkS3PublicAccessEnhanced finding -> CONTRADICTS', async () => {
    const orgId = await insertOrg();
    const bucket = await insertResource(orgId, {
      resource_type: 's3',
      is_public: false, // deliberately false, to prove this is NOT what CC6.6 reads for S3
      compliance_issues: [{ severity: 'critical', category: 'public_access', issue: 'S3 bucket ACL allows public read access', recommendation: 'x' }],
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');
    const obs = observations.find((o) => o.resource_arn === bucket);

    expect(obs?.result).toBe('CONTRADICTS');
    expect((obs?.source as any).source_type).toBe('compliance_issue');
  });

  it('no enhanced finding + a complete discovery job -> SUPPORTS', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const bucket = await insertResource(orgId, { resource_type: 's3', is_public: false, compliance_issues: [] });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');
    const obs = observations.find((o) => o.resource_arn === bucket);

    expect(obs?.result).toBe('SUPPORTS');
  });

  it('no enhanced finding + an incomplete discovery job -> UNKNOWN, never SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, false);
    const bucket = await insertResource(orgId, { resource_type: 's3', is_public: false, compliance_issues: [] });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');
    const obs = observations.find((o) => o.resource_arn === bucket);

    expect(obs?.result).toBe('UNKNOWN');
    expect(obs?.result).not.toBe('SUPPORTS');
  });

  it('no enhanced finding + no discovery job at all -> UNKNOWN, never SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    const bucket = await insertResource(orgId, { resource_type: 's3', is_public: false, compliance_issues: [] });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');
    const obs = observations.find((o) => o.resource_arn === bucket);

    expect(obs?.result).toBe('UNKNOWN');
  });

  it('bare is_public=false is never used as SOC2 proof for S3 even when it would suggest SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    // is_public: false (would suggest SUPPORTS if wrongly used) but a real enhanced
    // finding exists (policy-based exposure the ACL-only is_public field can't see).
    const bucket = await insertResource(orgId, {
      resource_type: 's3',
      is_public: false,
      compliance_issues: [{ severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access (wildcard principal)', recommendation: 'x' }],
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.6');
    const obs = observations.find((o) => o.resource_arn === bucket);

    expect(obs?.result).toBe('CONTRADICTS');
  });
});

describe('Soc2EvidenceService — CC9.1 AWS Backup', () => {
  it('has_backup true/false/null semantics', async () => {
    const orgId = await insertOrg();
    const backedUp = await insertResource(orgId, { resource_type: 'ec2', has_backup: true });
    const notBackedUp = await insertResource(orgId, { resource_type: 'ec2', has_backup: false });
    const unknown = await insertResource(orgId, { resource_type: 'rds', has_backup: null });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC9.1');

    expect(observations.find((o) => o.resource_arn === backedUp)?.result).toBe('SUPPORTS');
    expect(observations.find((o) => o.resource_arn === notBackedUp)?.result).toBe('CONTRADICTS');
    expect(observations.find((o) => o.resource_arn === unknown)?.result).toBe('UNKNOWN');
  });
});

describe('Soc2EvidenceService — CC6.2 IAM MFA', () => {
  it('an active mfa_not_enabled finding -> per-user CONTRADICTS, provenance OBSERVED', async () => {
    const orgId = await insertOrg();
    const userArn = 'arn:aws:iam::1:user/no-mfa-user';
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_user', finding_type: 'mfa_not_enabled', relevant_aws_attributes: { has_login_profile: true, mfa_device_count: 0 } },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.2');
    const obs = observations.find((o) => o.resource_arn === userArn);

    expect(obs?.result).toBe('CONTRADICTS');
    expect(obs?.provenance).toBe('OBSERVED');
    expect(obs?.resource_type).toBe('iam_user');
  });

  it('an incomplete scan never produces a false org-level SUPPORTS when zero findings exist (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, false);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.2');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('UNKNOWN');
    expect(aggregate?.result).not.toBe('SUPPORTS');
  });

  it('a complete scan with zero findings -> org-level aggregate SUPPORTS', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.2');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('SUPPORTS');
    expect(aggregate?.resource_type).toBe('organization');
  });

  it('no full-roster per-user SUPPORTS is ever fabricated -- only the org-level aggregate can be SUPPORTS', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    // One user has a finding; DevControl has no roster telling it any OTHER specific
    // user was evaluated and clean, so no per-user SUPPORTS observation should exist.
    const userArn = 'arn:aws:iam::1:user/flagged-user';
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_user', finding_type: 'mfa_not_enabled', relevant_aws_attributes: { has_login_profile: true, mfa_device_count: 0 } },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.2');

    expect(observations.filter((o) => o.result === 'SUPPORTS')).toHaveLength(0);
    expect(observations.find((o) => o.resource_arn === userArn)?.result).toBe('CONTRADICTS');
  });

  it('an iam-category finding with a finding_type other than mfa_not_enabled/access_key_stale does not affect CC6.2 (negative test -- category=\'iam\' alone is never sufficient)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const userArn = 'arn:aws:iam::1:user/unrelated-iam-finding';
    // Not a real value FindingEvidence's type system can currently produce (only
    // 'mfa_not_enabled'/'access_key_stale' exist for category='iam' -- see the review
    // report), but account_security_findings.evidence is untyped JSONB at the database
    // level, so the service must not assume the type guarantee holds and must filter
    // defensively on the actual evidence content, not just category.
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_user', finding_type: 'some_other_iam_finding_type', relevant_aws_attributes: {} },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.2');

    expect(observations.find((o) => o.resource_arn === userArn)).toBeUndefined();
    expect(observations.find((o) => o.resource_arn === null)?.result).toBe('SUPPORTS');
  });
});

describe('Soc2EvidenceService — CC6.3 stale access keys', () => {
  it('preserves the existing access_key_stale detector semantics via evidence, provenance OBSERVED', async () => {
    const orgId = await insertOrg();
    const userArn = 'arn:aws:iam::1:user/stale-key-user';
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: {
        schema_version: 1, resource_type: 'iam_access_key', finding_type: 'access_key_stale',
        relevant_aws_attributes: { access_key_id: 'AKIASTALE123', age_in_days: 200, key_status: 'Active' },
      },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.3');
    const obs = observations.find((o) => o.resource_arn === `${userArn}#access-key#AKIASTALE123`);

    expect(obs).toBeDefined();
    expect(obs?.result).toBe('CONTRADICTS');
    expect(obs?.provenance).toBe('OBSERVED');
  });

  it('two stale keys on the same user produce two distinct observations, never a collision', async () => {
    const orgId = await insertOrg();
    const userArn = 'arn:aws:iam::1:user/two-stale-keys';
    await insertFinding(orgId, {
      category: 'iam', resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_access_key', finding_type: 'access_key_stale', relevant_aws_attributes: { access_key_id: 'AKIAONE', age_in_days: 100, key_status: 'Active' } },
    });
    await insertFinding(orgId, {
      category: 'iam', resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_access_key', finding_type: 'access_key_stale', relevant_aws_attributes: { access_key_id: 'AKIATWO', age_in_days: 200, key_status: 'Active' } },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.3');
    const perKey = observations.filter((o) => o.resource_arn?.startsWith(userArn));

    expect(perKey).toHaveLength(2);
    expect(perKey.map((o) => o.resource_arn).sort()).toEqual([
      `${userArn}#access-key#AKIAONE`,
      `${userArn}#access-key#AKIATWO`,
    ]);
  });

  it('an incomplete scan never produces a false org-level SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, false);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.3');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('UNKNOWN');
  });

  it('an iam-category finding with a finding_type other than mfa_not_enabled/access_key_stale does not affect CC6.3 (negative test -- category=\'iam\' alone is never sufficient)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const userArn = 'arn:aws:iam::1:user/unrelated-iam-finding-2';
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_user', finding_type: 'some_other_iam_finding_type', relevant_aws_attributes: {} },
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.3');

    expect(observations.find((o) => o.resource_arn?.startsWith(userArn))).toBeUndefined();
    expect(observations.find((o) => o.resource_arn === null)?.result).toBe('SUPPORTS');
  });
});

function unrestrictedIngressEvidence(overrides: Partial<Record<string, any>> = {}) {
  return {
    schema_version: 1,
    security_group_id: 'sg-open',
    security_group_name: 'sg-open',
    region: 'us-east-1',
    direction: 'ingress',
    protocol: 'tcp',
    from_port: 22,
    to_port: 22,
    ip_version: 'v4',
    cidr: '0.0.0.0/0',
    detected_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Soc2EvidenceService — CC7.1 unrestricted security-group ingress (narrow)', () => {
  it('a specific unrestricted-ingress finding (direction=ingress, cidr=0.0.0.0/0) -> CONTRADICTS', async () => {
    const orgId = await insertOrg();
    const sgArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-open';
    await insertFinding(orgId, { category: 'networking', resource_identifier: sgArn, evidence: unrestrictedIngressEvidence() });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');
    const obs = observations.find((o) => o.resource_arn === sgArn);

    expect(obs?.result).toBe('CONTRADICTS');
    expect(obs?.resource_type).toBe('security_group');
    expect(obs?.provenance).toBe('OBSERVED');
  });

  it('an IPv6 unrestricted-ingress finding (cidr=::/0) -> CONTRADICTS', async () => {
    const orgId = await insertOrg();
    const sgArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-open-v6';
    await insertFinding(orgId, {
      category: 'networking',
      resource_identifier: sgArn,
      evidence: unrestrictedIngressEvidence({ ip_version: 'v6', cidr: '::/0' }),
    });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');

    expect(observations.find((o) => o.resource_arn === sgArn)?.result).toBe('CONTRADICTS');
  });

  it('an unrelated networking-category finding (no evidence at all) does not produce a CC7.1 observation, and does not affect the org-level aggregate (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const sgArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-unrelated-no-evidence';
    // category='networking' but no evidence -- must not be treated as an unrestricted-
    // ingress finding merely because it shares the category label.
    await insertFinding(orgId, { category: 'networking', resource_identifier: sgArn });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');

    expect(observations.find((o) => o.resource_arn === sgArn)).toBeUndefined();
    expect(observations.find((o) => o.resource_arn === null)?.result).toBe('SUPPORTS');
  });

  it('a networking-category finding with egress-direction or non-unrestricted-CIDR evidence does not produce CONTRADICTS or prevent SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const egressArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-egress-only';
    const narrowCidrArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-narrow-cidr';
    await insertFinding(orgId, { category: 'networking', resource_identifier: egressArn, evidence: unrestrictedIngressEvidence({ direction: 'egress' }) });
    await insertFinding(orgId, { category: 'networking', resource_identifier: narrowCidrArn, evidence: unrestrictedIngressEvidence({ cidr: '10.0.0.0/8' }) });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');

    expect(observations.find((o) => o.resource_arn === egressArn)).toBeUndefined();
    expect(observations.find((o) => o.resource_arn === narrowCidrArn)).toBeUndefined();
    expect(observations.find((o) => o.resource_arn === null)?.result).toBe('SUPPORTS');
  });

  it('a complete clean scan + zero relevant findings -> org-level aggregate SUPPORTS', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('SUPPORTS');
  });

  it('an incomplete scan -> UNKNOWN, never SUPPORTS, even with zero relevant findings (negative test)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, false);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('UNKNOWN');
  });

  it('no discovery job at all (completeness genuinely unavailable/ambiguous) -> UNKNOWN, never SUPPORTS (negative test)', async () => {
    const orgId = await insertOrg();
    // Deliberately no insertDiscoveryJob() call -- completeness cannot be established.

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');
    const aggregate = observations.find((o) => o.resource_arn === null);

    expect(aggregate?.result).toBe('UNKNOWN');
  });

  it('a resolved (non-active) unrestricted-ingress finding does not produce a CONTRADICTS observation', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const sgArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-resolved';
    await insertFinding(orgId, { category: 'networking', resource_identifier: sgArn, status: 'resolved', evidence: unrestrictedIngressEvidence() });

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');

    expect(observations.find((o) => o.resource_arn === sgArn)).toBeUndefined();
    // And since the only (resolved) finding doesn't count, the aggregate is clean.
    expect(observations.find((o) => o.resource_arn === null)?.result).toBe('SUPPORTS');
  });
});

describe('Soc2EvidenceService — freshness', () => {
  it('collected_at is persisted and close to now; no historical/continuous claim is made anywhere in explanation text', async () => {
    const orgId = await insertOrg();
    const before = new Date();
    await insertResource(orgId, { resource_type: 's3', is_encrypted: true });

    await service.computeAndPersistEvidence(orgId);
    const observations = await repository.getObservations(orgId);
    const after = new Date();

    for (const o of observations) {
      expect(o.collected_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(o.collected_at.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
      expect(o.explanation.toLowerCase()).not.toMatch(/continuous/);
      expect(o.explanation.toLowerCase()).not.toMatch(/type ii/);
      expect(o.explanation.toLowerCase()).not.toMatch(/operating effectiveness/);
      expect(o.explanation.toLowerCase()).not.toMatch(/\baudit\b/);
      expect(o.explanation.toLowerCase()).not.toMatch(/certif/);
    }
  });
});

describe('Soc2EvidenceService — evaluation rollup', () => {
  it('produces deterministic counts, no score, no certification status, disposition from config', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    await insertResource(orgId, { resource_type: 's3', is_encrypted: true });
    await insertResource(orgId, { resource_type: 's3', is_encrypted: false });
    await insertResource(orgId, { resource_type: 's3', is_encrypted: null });

    await service.computeAndPersistEvidence(orgId);
    const evaluations = await repository.getControlEvaluations(orgId);
    const cc61 = evaluations.find((e) => e.criterion_id === 'CC6.1')!;

    expect(cc61.evidence_summary).toEqual({ supports: 1, contradicts: 1, unknown: 1 });
    expect(cc61.disposition_class).toBe('A_OBSERVABLE');
    expect(cc61.customer_evidence_ids).toEqual([]);
    expect(Object.keys(cc61.evidence_summary).sort()).toEqual(['contradicts', 'supports', 'unknown']);
    // No score/percentage/certification field exists on the type at all -- this is a
    // structural guarantee, not just a runtime assertion.
    expect((cc61 as any).score).toBeUndefined();
    expect((cc61 as any).percentage).toBeUndefined();
    expect((cc61 as any).certification_status).toBeUndefined();
  });

  it('recomputing is idempotent -- re-running produces the same counts, not accumulation', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, { resource_type: 's3', is_encrypted: true });

    await service.computeAndPersistEvidence(orgId);
    await service.computeAndPersistEvidence(orgId);

    const evaluations = await repository.getControlEvaluations(orgId);
    const cc61 = evaluations.find((e) => e.criterion_id === 'CC6.1')!;
    expect(cc61.evidence_summary.supports).toBe(1);
  });

  it('every configured criterion gets an evaluation row, even with zero matching resources', async () => {
    const orgId = await insertOrg();
    await service.computeAndPersistEvidence(orgId);
    const evaluations = await repository.getControlEvaluations(orgId);
    expect(evaluations.map((e) => e.criterion_id).sort()).toEqual(['CC6.1', 'CC6.2', 'CC6.3', 'CC6.6', 'CC7.1', 'CC9.1']);
  });
});

describe('Soc2EvidenceService — Phase 5 observation reconciliation (stale rows)', () => {
  it('RUN 1: resource A + resource B both present -> RUN 2: resource B deleted -> A remains/updates, B is removed, no stale row left behind', async () => {
    const orgId = await insertOrg();
    const arnA = await insertResource(orgId, { resource_type: 'ec2', is_encrypted: true });
    const arnB = await insertResource(orgId, { resource_type: 'ec2', is_encrypted: true });

    await service.computeAndPersistEvidence(orgId);
    const afterRun1 = await observationsFor(orgId, 'CC6.1');
    expect(afterRun1.find((o) => o.resource_arn === arnA)).toBeDefined();
    expect(afterRun1.find((o) => o.resource_arn === arnB)).toBeDefined();

    // Simulate discovery's own reconcile() marking B genuinely gone (deleted from AWS) --
    // the exact mechanism awsResourceDiscovery.ts uses, which readResources() already
    // filters on (status != 'terminated').
    await pool.query(`UPDATE aws_resources SET status = 'terminated' WHERE resource_arn = $1`, [arnB]);

    await service.computeAndPersistEvidence(orgId);
    const afterRun2 = await observationsFor(orgId, 'CC6.1');

    expect(afterRun2.find((o) => o.resource_arn === arnA)).toBeDefined();
    expect(afterRun2.find((o) => o.resource_arn === arnB)).toBeUndefined();
  });

  it('an organization that goes from having resources of a type to having zero clears every previously-stored per-resource row for that (criterion, resource_type)', async () => {
    const orgId = await insertOrg();
    const arn = await insertResource(orgId, { resource_type: 's3', is_encrypted: true });

    await service.computeAndPersistEvidence(orgId);
    expect((await observationsFor(orgId, 'CC6.1')).find((o) => o.resource_arn === arn)).toBeDefined();

    await pool.query(`UPDATE aws_resources SET status = 'terminated' WHERE resource_arn = $1`, [arn]);

    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC6.1');
    expect(observations.find((o) => o.resource_type === 's3')).toBeUndefined();
  });

  it('a resolved (no-longer-active) finding is reconciled away for CC6.2, and the org-level aggregate is never deleted by per-resource reconciliation', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const userArn = 'arn:aws:iam::1:user/reconcile-mfa-user';
    await insertFinding(orgId, {
      category: 'iam',
      resource_identifier: userArn,
      evidence: { schema_version: 1, resource_type: 'iam_user', finding_type: 'mfa_not_enabled', relevant_aws_attributes: { has_login_profile: true, mfa_device_count: 0 } },
    });

    await service.computeAndPersistEvidence(orgId);
    const afterRun1 = await observationsFor(orgId, 'CC6.2');
    expect(afterRun1.find((o) => o.resource_arn === userArn)?.result).toBe('CONTRADICTS');
    expect(afterRun1.find((o) => o.resource_arn === null)).toBeDefined();

    // The finding is genuinely resolved (discovery's own reconcileScan mechanism) --
    // readActiveFindings() no longer returns it.
    await pool.query(`UPDATE account_security_findings SET status = 'resolved' WHERE resource_identifier = $1`, [userArn]);

    await service.computeAndPersistEvidence(orgId);
    const afterRun2 = await observationsFor(orgId, 'CC6.2');

    expect(afterRun2.find((o) => o.resource_arn === userArn)).toBeUndefined();
    // The org-level aggregate row (resource_arn IS NULL) survives -- it is re-upserted
    // fresh every run, never a reconciliation target -- and correctly flips to SUPPORTS
    // now that zero active findings remain and the scan is complete.
    const aggregate = afterRun2.find((o) => o.resource_arn === null);
    expect(aggregate).toBeDefined();
    expect(aggregate?.result).toBe('SUPPORTS');
  });

  it('partial/incomplete discovery (an unrelated resource type failing) never deletes a legitimate prior observation for a resource that is still present and still active', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, true);
    const sgArn = 'arn:aws:ec2:us-east-1:1:security-group/sg-still-open';
    await insertFinding(orgId, { category: 'networking', resource_identifier: sgArn, evidence: unrestrictedIngressEvidence() });

    await service.computeAndPersistEvidence(orgId);
    expect((await observationsFor(orgId, 'CC7.1')).find((o) => o.resource_arn === sgArn)?.result).toBe('CONTRADICTS');

    // Nothing about this finding changed -- exactly what a run where EC2/S3/etc.
    // discovery failed but left account_security_findings completely untouched looks
    // like from this service's point of view (see buildReconciliationScopes()'s own
    // docblock: a failed scan never touches the source tables, so this run's read is
    // identical to the last one). Recomputing must not treat that as disappearance.
    await service.computeAndPersistEvidence(orgId);
    const observations = await observationsFor(orgId, 'CC7.1');

    expect(observations.find((o) => o.resource_arn === sgArn)?.result).toBe('CONTRADICTS');
  });
});

describe('Soc2EvidenceService — Phase 5 idempotency after resource disappearance', () => {
  it('the final current state converges deterministically regardless of how many times computation is repeated after a resource disappears', async () => {
    const orgId = await insertOrg();
    const arnA = await insertResource(orgId, { resource_type: 'ec2', is_encrypted: true });
    const arnB = await insertResource(orgId, { resource_type: 'ec2', is_encrypted: false });

    await service.computeAndPersistEvidence(orgId);
    await pool.query(`UPDATE aws_resources SET status = 'terminated' WHERE resource_arn = $1`, [arnB]);

    // Repeated scheduled trigger: run several times in a row after the disappearance.
    await service.computeAndPersistEvidence(orgId);
    await service.computeAndPersistEvidence(orgId);
    await service.computeAndPersistEvidence(orgId);

    const observations = await observationsFor(orgId, 'CC6.1');
    expect(observations.filter((o) => o.resource_type === 'ec2')).toHaveLength(1);
    expect(observations.find((o) => o.resource_arn === arnA)).toBeDefined();

    const evaluations = await repository.getControlEvaluations(orgId);
    const cc61 = evaluations.find((e) => e.criterion_id === 'CC6.1')!;
    expect(cc61.evidence_summary.supports).toBe(1);
  });
});

describe('Soc2EvidenceService — Phase 5 concurrency guard', () => {
  it('two overlapping computeAndPersistEvidence() calls for the SAME organization both complete and leave a single, internally-consistent result (never a partial/duplicated set)', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, { resource_type: 's3', is_encrypted: true });

    await Promise.all([
      service.computeAndPersistEvidence(orgId),
      service.computeAndPersistEvidence(orgId),
    ]);

    const observations = await observationsFor(orgId, 'CC6.1');
    // Exactly one row for the one real resource -- no duplication from the two
    // overlapping runs racing each other.
    expect(observations.filter((o) => o.resource_type === 's3')).toHaveLength(1);

    const evaluations = await repository.getControlEvaluations(orgId);
    expect(evaluations.map((e) => e.criterion_id).sort()).toEqual(['CC6.1', 'CC6.2', 'CC6.3', 'CC6.6', 'CC7.1', 'CC9.1']);
  });

  it('two overlapping computations for DIFFERENT organizations do not block each other', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await insertResource(orgA, { resource_type: 's3', is_encrypted: true });
    await insertResource(orgB, { resource_type: 's3', is_encrypted: false });

    await expect(
      Promise.all([
        service.computeAndPersistEvidence(orgA),
        service.computeAndPersistEvidence(orgB),
      ])
    ).resolves.toBeDefined();

    const evalsA = await repository.getControlEvaluations(orgA);
    const evalsB = await repository.getControlEvaluations(orgB);
    expect(evalsA.find((e) => e.criterion_id === 'CC6.1')?.evidence_summary.supports).toBe(1);
    expect(evalsB.find((e) => e.criterion_id === 'CC6.1')?.evidence_summary.contradicts).toBe(1);
  });
});

describe('Soc2EvidenceService — Phase 5 evaluation atomicity', () => {
  it('a failure during evaluation persistence leaves no half-written six-criterion set, and a retry succeeds cleanly', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, { resource_type: 's3', is_encrypted: true });

    // Establish a real, valid prior evaluation state to prove it survives a failed
    // recompute untouched.
    await service.computeAndPersistEvidence(orgId);
    const before = await repository.getControlEvaluations(orgId);
    expect(before).toHaveLength(6);

    // Force a failure inside the same transaction persistComputation() uses, on the
    // evaluation-upsert side specifically -- an evaluation whose organization_id does
    // not match the scoped organizationId trips persistComputation()'s own guard clause
    // (the same defensive check upsertControlEvaluation() already had), after some
    // observations/evaluations from this call may already have been written to the
    // transaction buffer but before COMMIT.
    const freshObservations = await repository.getObservations(orgId);
    const validEvaluation = before[0];
    const brokenEvaluations = [
      { ...validEvaluation, computed_at: new Date() },
      { ...before[1], organization_id: 'not-a-real-org-id', computed_at: new Date() },
      ...before.slice(2),
    ];

    await expect(
      repository.persistComputation(orgId, freshObservations, [], brokenEvaluations)
    ).rejects.toThrow();

    const afterFailedAttempt = await repository.getControlEvaluations(orgId);
    // Every evaluation is byte-for-byte the pre-attempt state -- not "the first one
    // updated, the rest untouched".
    expect(afterFailedAttempt).toEqual(before);

    // Retry with the real (valid) computation succeeds and produces a full, correct set.
    await service.computeAndPersistEvidence(orgId);
    const afterRetry = await repository.getControlEvaluations(orgId);
    expect(afterRetry).toHaveLength(6);
  });
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
