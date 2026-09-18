/**
 * Live-DB coverage for soc2_evidence_observations / soc2_control_evaluations' RLS/
 * tenant isolation. Same real-Postgres convention as security-hub-findings-rls.test.ts
 * -- the property under test is real RLS policy enforcement, not something a mocked pg
 * client could verify.
 */
import { Pool } from 'pg';
import { Soc2EvidenceRepository } from '../soc2-evidence.repository';
import { Soc2EvidenceObservation, Soc2ControlEvaluation } from '../../types/soc2-evidence.types';

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
const repo = new Soc2EvidenceRepository(pool);
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
    [`SOC2 Evidence Org ${suffix}`, `soc2-evidence-org-${suffix}`, `SOC2 Evidence Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function observation(organizationId: string, overrides: Partial<Soc2EvidenceObservation> = {}): Soc2EvidenceObservation {
  const now = new Date();
  return {
    organization_id: organizationId,
    criterion_id: 'CC6.1',
    resource_arn: `arn:aws:s3:::rls-test-${uniqueSuffix()}`,
    resource_type: 's3',
    provenance: 'OBSERVED',
    result: 'SUPPORTS',
    observed_at: now,
    collected_at: now,
    source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 's3' },
    explanation: 'test observation',
    schema_version: 1,
    ...overrides,
  };
}

function evaluation(organizationId: string, overrides: Partial<Soc2ControlEvaluation> = {}): Soc2ControlEvaluation {
  return {
    organization_id: organizationId,
    criterion_id: 'CC6.1',
    disposition_class: 'A_OBSERVABLE',
    evidence_summary: { supports: 1, contradicts: 0, unknown: 0 },
    customer_evidence_ids: [],
    computed_at: new Date(),
    ...overrides,
  };
}

describe('Soc2EvidenceRepository — schema/contract (live DB)', () => {
  it('columns, RLS, and constraints exist as expected', async () => {
    const { rows: cols } = await pool.query(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'soc2_evidence_observations' ORDER BY ordinal_position`
    );
    const colNames = cols.map((c) => c.column_name);
    expect(colNames).toEqual([
      'id', 'organization_id', 'criterion_id', 'resource_arn', 'resource_type',
      'provenance', 'result', 'observed_at', 'collected_at', 'source', 'explanation',
      'schema_version', 'created_at',
    ]);
    expect(cols.find((c) => c.column_name === 'resource_arn')?.is_nullable).toBe('YES');
    expect(cols.find((c) => c.column_name === 'organization_id')?.is_nullable).toBe('NO');
    expect(cols.find((c) => c.column_name === 'source')?.data_type).toBe('jsonb');

    const { rows: rls } = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname IN ('soc2_evidence_observations', 'soc2_control_evaluations')`
    );
    expect(rls.every((r) => r.relrowsecurity === true)).toBe(true);
  });

  it('the unique index rejects a duplicate (org, criterion, resource_type, resource_arn) upsert as an update, not a second row', async () => {
    const orgId = await insertOrg();
    const obs = observation(orgId, { resource_arn: 'arn:aws:s3:::dup-test', result: 'SUPPORTS' });

    await repo.upsertObservations(orgId, [obs]);
    await repo.upsertObservations(orgId, [{ ...obs, result: 'CONTRADICTS' }]);

    const rows = await repo.getObservations(orgId, 'CC6.1');
    const matching = rows.filter((r) => r.resource_arn === 'arn:aws:s3:::dup-test');
    expect(matching).toHaveLength(1);
    expect(matching[0].result).toBe('CONTRADICTS');
  });

  it('two NULL-resource_arn aggregate rows for the same (org, criterion, resource_type) collide correctly instead of duplicating', async () => {
    const orgId = await insertOrg();
    const agg = observation(orgId, {
      criterion_id: 'CC7.1',
      resource_arn: null,
      resource_type: 'organization',
      result: 'SUPPORTS',
    });

    await repo.upsertObservations(orgId, [agg]);
    await repo.upsertObservations(orgId, [{ ...agg, result: 'CONTRADICTS' }]);

    const rows = await repo.getObservations(orgId, 'CC7.1');
    const aggregateRows = rows.filter((r) => r.resource_arn === null);
    expect(aggregateRows).toHaveLength(1);
    expect(aggregateRows[0].result).toBe('CONTRADICTS');
  });
});

describe('organization isolation — soc2_evidence_observations / soc2_control_evaluations', () => {
  it('an observation persisted for org A is invisible when read as org B', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();

    await repo.upsertObservations(orgA, [observation(orgA)]);

    const asOrgB = await repo.getObservations(orgB);
    expect(asOrgB).toHaveLength(0);

    const asOrgA = await repo.getObservations(orgA);
    expect(asOrgA.length).toBeGreaterThan(0);
  });

  it('org A cannot read org B control evaluations', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();

    await repo.upsertControlEvaluation(orgB, evaluation(orgB));

    const asOrgA = await repo.getControlEvaluations(orgA);
    expect(asOrgA).toHaveLength(0);

    const asOrgB = await repo.getControlEvaluations(orgB);
    expect(asOrgB).toHaveLength(1);
  });

  // NOTE: a "raw SQL with the session var explicitly cleared" bypass test was
  // considered and removed -- this suite's DB connection authenticates as `postgres`
  // (see dbConfig()), which is this local database's table owner/superuser and
  // therefore bypasses RLS entirely by PostgreSQL's own design, regardless of policy
  // correctness (RLS applies to non-owner, non-superuser roles unless a table is
  // explicitly created with FORCE ROW LEVEL SECURITY, which no migration in this
  // repository uses -- matching account_security_findings/security_hub_findings'
  // same convention). That would not be testing this schema; it would only be
  // re-proving that `postgres` is the table owner. The two tests above -- reading
  // through Soc2EvidenceRepository's own set_config-scoped methods, exactly the
  // access pattern every real code path (HTTP requests via auth.middleware.ts,
  // services via their own withOrgClient) actually uses -- are what proves isolation
  // for the real production role (`devcontrol`, non-superuser, not a table owner
  // created this way), matching security-hub-findings-rls.test.ts's identical choice
  // to test isolation exclusively through repository methods, not a raw-connection
  // bypass.
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
