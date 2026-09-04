/**
 * Live-DB coverage for Security PR2's AccountSecurityFindingsRepository additions:
 * disposition lifecycle, category-scoped reconciliation (complete vs incomplete
 * scans), and the recurrence/preservation rules that keep a scan/disposition
 * race from ever turning a verified resolution back into a user-dispositioned
 * active state.
 *
 * Runs against the actual local dev Postgres instance (not mocked pg clients) —
 * same rationale as cost-recommendations-occurrence-lifecycle.test.ts: the
 * property under test is real transaction/ON CONFLICT/row-lock behavior.
 */
import { Pool } from 'pg';
import {
  AccountSecurityFindingsRepository,
  NewAccountFinding,
  deriveFindingStatus,
} from '../account-security-findings.repository';
import { SecurityGroupEvidence, IamAccessKeyEvidence } from '../../types/aws-resources.types';
import { computeIamFindingKey } from '../../utils/iamFindingKey';

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
const repository = new AccountSecurityFindingsRepository();
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`SG Findings Org ${suffix}`, `sg-findings-org-${suffix}`, `SG Findings Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, 'not-a-real-hash', 'Test User')
     RETURNING id`,
    [`sg-findings-user-${suffix}@example.test`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchRow(orgId: string, findingKey: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  const { rows } = await pool.query(
    `SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`,
    [orgId, findingKey]
  );
  return rows[0];
}

function fakeEvidence(overrides: Partial<SecurityGroupEvidence> = {}): SecurityGroupEvidence {
  return {
    schema_version: 1,
    security_group_id: 'sg-test',
    security_group_name: 'test-sg',
    vpc_id: 'vpc-test',
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

function fakeFinding(overrides: Partial<NewAccountFinding> = {}): NewAccountFinding {
  return {
    findingKey: 'test-finding-key-1',
    category: 'networking',
    severity: 'critical',
    title: 'Security group "test-sg" (sg-test) allows SSH (port 22) from anywhere (0.0.0.0/0)',
    recommendation: 'Restrict SSH access.',
    resourceIdentifier: 'arn:aws:ec2:us-east-1:123456789012:security-group/sg-test',
    region: 'us-east-1',
    evidence: fakeEvidence(),
    ...overrides,
  };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

describe('deriveFindingStatus', () => {
  it('resolved always wins over any disposition', () => {
    expect(deriveFindingStatus('resolved', 'acknowledged')).toBe('resolved');
    expect(deriveFindingStatus('resolved', null)).toBe('resolved');
  });

  it('maps each disposition when status is active', () => {
    expect(deriveFindingStatus('active', 'acknowledged')).toBe('acknowledged');
    expect(deriveFindingStatus('active', 'dismissed')).toBe('dismissed');
    expect(deriveFindingStatus('active', 'accepted_risk')).toBe('accepted_risk');
  });

  it('is active when there is no disposition', () => {
    expect(deriveFindingStatus('active', null)).toBe('active');
  });
});

describe('reconcileScan — basic insert/no-duplicate (tests 10-11)', () => {
  it('inserts a fresh active finding', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;

    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);

    const row = await fetchRow(orgId, key);
    expect(row.status).toBe('active');
    expect(row.disposition).toBeNull();
    expect(row.evidence).toMatchObject({ security_group_id: 'sg-test' });
  });

  it('a repeated scan produces no duplicate row', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;

    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);

    await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    const { rows } = await pool.query(
      `SELECT * FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`,
      [orgId, key]
    );
    expect(rows).toHaveLength(1);
  });
});

describe('category-scoped completeness (tests 12-15)', () => {
  it('a complete scan that still detects the finding keeps it active', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;
    const t0 = new Date();
    await repository.reconcileScan(orgId, t0, [fakeFinding({ findingKey: key })], ['networking']);

    const t1 = new Date();
    await repository.reconcileScan(orgId, t1, [fakeFinding({ findingKey: key })], ['networking']);

    const row = await fetchRow(orgId, key);
    expect(row.status).toBe('active');
  });

  it('a complete scan without the finding resolves it', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);

    const later = new Date();
    await repository.reconcileScan(orgId, later, [], ['networking']);

    const row = await fetchRow(orgId, key);
    expect(row.status).toBe('resolved');
    expect(row.resolved_at).not.toBeNull();
  });

  it('an incomplete scan does not resolve an absent finding', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);

    const later = new Date();
    // networking NOT in completeCategories -> absence must not resolve it
    await repository.reconcileScan(orgId, later, [], []);

    const row = await fetchRow(orgId, key);
    expect(row.status).toBe('active');
  });

  it('an AWS-failure-driven incomplete scan (findings still upserted, category not marked complete) does not resolve unrelated stale findings', async () => {
    const orgId = await insertOrg();
    const staleKey = `key-${uniqueSuffix()}`;
    const stillDetectedKey = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(
      orgId,
      new Date(),
      [fakeFinding({ findingKey: staleKey }), fakeFinding({ findingKey: stillDetectedKey })],
      ['networking']
    );

    const later = new Date();
    // Simulates a partial/failed scan: only stillDetectedKey observed, category
    // marked incomplete because the scan didn't finish.
    await repository.reconcileScan(orgId, later, [fakeFinding({ findingKey: stillDetectedKey })], []);

    expect((await fetchRow(orgId, staleKey)).status).toBe('active');
    expect((await fetchRow(orgId, stillDetectedKey)).status).toBe('active');
  });

  it('categories are independent: an incomplete networking scan does not block a complete iam resolution', async () => {
    const orgId = await insertOrg();
    const networkingKey = `key-${uniqueSuffix()}`;
    const iamKey = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(
      orgId,
      new Date(),
      [
        fakeFinding({ findingKey: networkingKey, category: 'networking' }),
        fakeFinding({ findingKey: iamKey, category: 'iam', region: undefined }),
      ],
      ['networking', 'iam']
    );

    const later = new Date();
    // networking incomplete this time, iam complete and finds nothing
    await repository.reconcileScan(orgId, later, [], ['iam']);

    expect((await fetchRow(orgId, networkingKey)).status).toBe('active');
    expect((await fetchRow(orgId, iamKey)).status).toBe('resolved');
  });
});

describe('disposition mutations (tests 16-19)', () => {
  it('acknowledge does not require a note', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);
    const row = await fetchRow(orgId, key);

    const result = await repository.setDisposition(orgId, row.id, 'acknowledged', userId, null);

    expect(result.outcome).toBe('applied');
    if (result.outcome === 'applied') {
      expect(result.finding.disposition).toBe('acknowledged');
      expect(result.finding.disposition_actor_id).toBe(userId);
      expect(result.finding.disposition_at).not.toBeNull();
      expect(result.finding.derived_status).toBe('acknowledged');
    }
  });

  it('dismiss persists its note', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);
    const row = await fetchRow(orgId, key);

    const result = await repository.setDisposition(orgId, row.id, 'dismissed', userId, 'False positive — internal-only IP range');

    expect(result.outcome).toBe('applied');
    if (result.outcome === 'applied') {
      expect(result.finding.disposition).toBe('dismissed');
      expect(result.finding.disposition_note).toBe('False positive — internal-only IP range');
      expect(result.finding.derived_status).toBe('dismissed');
    }
  });

  it('accept-risk applies and derives correctly', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);
    const row = await fetchRow(orgId, key);

    const result = await repository.setDisposition(orgId, row.id, 'accepted_risk', userId, 'Approved by security team, ticket SEC-123');

    expect(result.outcome).toBe('applied');
    if (result.outcome === 'applied') {
      expect(result.finding.derived_status).toBe('accepted_risk');
    }
  });

  it('a disposition mutation never changes status or AWS-observation fields', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })]);
    const before = await fetchRow(orgId, key);

    await repository.setDisposition(orgId, before.id, 'acknowledged', userId, null);

    const after = await fetchRow(orgId, key);
    expect(after.status).toBe('active');
    expect(after.last_seen_at).toEqual(before.last_seen_at);
    expect(after.resolved_at).toBeNull();
  });
});

describe('recurrence and race-ordering invariants (tests 20-25)', () => {
  it('an active disposition survives an active rescan', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);
    const row = await fetchRow(orgId, key);
    await repository.setDisposition(orgId, row.id, 'accepted_risk', userId, 'Known, accepted');

    // Rescan still detects the same finding
    const later = new Date();
    await repository.reconcileScan(orgId, later, [fakeFinding({ findingKey: key })], ['networking']);

    const after = await fetchRow(orgId, key);
    expect(after.status).toBe('active');
    expect(after.disposition).toBe('accepted_risk');
    expect(after.disposition_note).toBe('Known, accepted');
  });

  it('recurrence after verified resolution resets disposition to NULL', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    const t0 = new Date();
    await repository.reconcileScan(orgId, t0, [fakeFinding({ findingKey: key })], ['networking']);
    const row = await fetchRow(orgId, key);
    await repository.setDisposition(orgId, row.id, 'dismissed', userId, 'Thought it was fine');

    // Complete scan without the finding -> verified resolved
    const t1 = new Date();
    await repository.reconcileScan(orgId, t1, [], ['networking']);
    expect((await fetchRow(orgId, key)).status).toBe('resolved');

    // Same canonical finding recurs later
    const t2 = new Date();
    await repository.reconcileScan(orgId, t2, [fakeFinding({ findingKey: key })], ['networking']);

    const recurred = await fetchRow(orgId, key);
    expect(recurred.status).toBe('active');
    expect(recurred.disposition).toBeNull();
    expect(recurred.disposition_note).toBeNull();
    expect(recurred.disposition_actor_id).toBeNull();
  });

  it('resolved findings reject disposition with a distinguishable outcome', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);
    const row = await fetchRow(orgId, key);

    const later = new Date();
    await repository.reconcileScan(orgId, later, [], ['networking']);
    expect((await fetchRow(orgId, key)).status).toBe('resolved');

    const result = await repository.setDisposition(orgId, row.id, 'acknowledged', userId, null);
    expect(result.outcome).toBe('resolved');
  });

  it('setDisposition on a nonexistent id returns not_found', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();

    const result = await repository.setDisposition(orgId, '00000000-0000-0000-0000-000000000000', 'acknowledged', userId, null);
    expect(result.outcome).toBe('not_found');
  });

  it('race ordering A: scan resolves the finding, then a disposition attempt against the same id is rejected', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);
    const row = await fetchRow(orgId, key);

    // Scan runs first and resolves it
    await repository.reconcileScan(orgId, new Date(), [], ['networking']);

    // A disposition request that was in flight before the scan committed arrives after
    const result = await repository.setDisposition(orgId, row.id, 'dismissed', userId, 'stale request');
    expect(result.outcome).toBe('resolved');
    expect((await fetchRow(orgId, key)).disposition).toBeNull();
  });

  it('race ordering B: disposition applied first, then an active rescan preserves it (verified absence never applies here since the scan still detects it)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);
    const row = await fetchRow(orgId, key);

    await repository.setDisposition(orgId, row.id, 'acknowledged', userId, null);

    // Scan runs after and still detects the same finding
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key })], ['networking']);

    const after = await fetchRow(orgId, key);
    expect(after.status).toBe('active');
    expect(after.disposition).toBe('acknowledged');
  });
});

describe('organization isolation (test 26)', () => {
  it('a finding in one org is invisible to another org via getActive and setDisposition', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const userB = await insertUser();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgA, new Date(), [fakeFinding({ findingKey: key })]);
    const row = await fetchRow(orgA, key);

    const activeInB = await repository.getActive(orgB);
    expect(activeInB.find((f) => f.id === row.id)).toBeUndefined();

    const result = await repository.setDisposition(orgB, row.id, 'acknowledged', userB, null);
    expect(result.outcome).toBe('not_found');
  });
});

describe('getActive projection (derived_status, evidence, framework_mapping)', () => {
  it('exposes derived_status, evidence, and the CIS framework mapping for an SSH finding', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [fakeFinding({ findingKey: key, evidence: fakeEvidence({ from_port: 22, to_port: 22 }) })]);

    const [finding] = await repository.getActive(orgId, { limit: 1 });
    expect(finding.derived_status).toBe('active');
    expect((finding.evidence as SecurityGroupEvidence | null)?.security_group_id).toBe('sg-test');
    expect(finding.framework_mapping).toMatchObject({ framework: 'CIS AWS Foundations Benchmark', control: '5.3' });
  });

  it('does not attach a framework mapping for a non-admin-port finding', async () => {
    const orgId = await insertOrg();
    const key = `key-${uniqueSuffix()}`;
    await repository.reconcileScan(orgId, new Date(), [
      fakeFinding({ findingKey: key, evidence: fakeEvidence({ from_port: 8080, to_port: 8080 }) }),
    ]);

    const [finding] = await repository.getActive(orgId, { limit: 1 });
    expect(finding.framework_mapping).toBeNull();
  });
});

/**
 * Regression coverage for the IAM Security Phase 2 bug fix: an earlier
 * version of checkIAMSecurity never set a stable findingKey for access-key
 * issues, so they fell through to this repository's generic fallback hash of
 * the mutable issue text (which embeds the key's age in days) — meaning the
 * same stale key got a brand-new finding_key every single day, silently
 * "resolving" and recreating itself and losing any user disposition in the
 * process. This uses the actual production computeIamFindingKey (not a
 * synthetic key), across two reconcileScan calls shaped like the same real
 * access key observed at two different ages, to prove disposition
 * continuity end-to-end through the exact code path production uses.
 */
describe('IAM access-key finding identity — bug-fix regression coverage', () => {
  function fakeIamAccessKeyEvidence(ageInDays: number, overrides: Partial<IamAccessKeyEvidence['relevant_aws_attributes']> = {}): IamAccessKeyEvidence {
    return {
      schema_version: 1,
      resource_type: 'iam_access_key',
      resource_identifier: 'arn:aws:iam::123456789012:user/stale-key-user',
      resource_name: 'stale-key-user',
      finding_type: 'access_key_stale',
      relevant_aws_attributes: {
        access_key_id: 'AKIAREGRESSIONTEST1',
        age_in_days: ageInDays,
        key_status: 'Active',
        ...overrides,
      },
      detected_at: new Date().toISOString(),
    };
  }

  function fakeIamAccessKeyFinding(ageInDays: number, severity: 'medium' | 'high'): NewAccountFinding {
    const userArn = 'arn:aws:iam::123456789012:user/stale-key-user';
    const accessKeyId = 'AKIAREGRESSIONTEST1';
    return {
      findingKey: computeIamFindingKey({ findingType: 'access_key_stale', userArn, accessKeyId }),
      category: 'iam',
      severity,
      title: `IAM user "stale-key-user" has an access key (${accessKeyId}) that is ${ageInDays} days old`,
      recommendation: 'Rotate this access key.',
      resourceIdentifier: userArn,
      evidence: fakeIamAccessKeyEvidence(ageInDays),
    };
  }

  it('a disposition on a stale access key survives the same key aging from medium (91d) to high (181d) severity across rescans', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();

    // Day 91: key first crosses the 90-day threshold.
    await repository.reconcileScan(orgId, new Date(), [fakeIamAccessKeyFinding(91, 'medium')], ['iam']);
    const firstRow = await fetchRow(orgId, computeIamFindingKey({
      findingType: 'access_key_stale',
      userArn: 'arn:aws:iam::123456789012:user/stale-key-user',
      accessKeyId: 'AKIAREGRESSIONTEST1',
    }));
    expect(firstRow.severity).toBe('medium');

    await repository.setDisposition(orgId, firstRow.id, 'accepted_risk', userId, 'Rotation scheduled next maintenance window');

    // 90 days later: the SAME key, now 181 days old — a later scan reports it
    // with the same finding_key (per computeIamFindingKey) but escalated severity.
    const later = new Date();
    await repository.reconcileScan(orgId, later, [fakeIamAccessKeyFinding(181, 'high')], ['iam']);

    const secondRow = await fetchRow(orgId, computeIamFindingKey({
      findingType: 'access_key_stale',
      userArn: 'arn:aws:iam::123456789012:user/stale-key-user',
      accessKeyId: 'AKIAREGRESSIONTEST1',
    }));

    // Same row (same id) — not resolved-and-recreated.
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.status).toBe('active');
    // Severity reflects the new age...
    expect(secondRow.severity).toBe('high');
    // ...but the user's earlier disposition on this exact key survived.
    expect(secondRow.disposition).toBe('accepted_risk');
    expect(secondRow.disposition_note).toBe('Rotation scheduled next maintenance window');
  });
});
