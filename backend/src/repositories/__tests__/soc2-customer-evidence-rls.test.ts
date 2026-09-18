/**
 * Live-DB coverage for customer_evidence's schema/RLS/tenant isolation and lifecycle
 * transitions. Same real-Postgres convention as soc2-evidence-rls.test.ts -- the
 * property under test is real RLS policy enforcement and atomic conditional-UPDATE
 * transition behavior, not something a mocked pg client could verify.
 */
import { Pool } from 'pg';
import {
  CreateCustomerEvidenceInput,
  Soc2CustomerEvidenceRepository,
} from '../soc2-customer-evidence.repository';

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
const repo = new Soc2CustomerEvidenceRepository(pool);
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active')
     RETURNING id`,
    [`Customer Evidence Org ${suffix}`, `customer-evidence-org-${suffix}`, `Customer Evidence Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function evidenceInput(overrides: Partial<CreateCustomerEvidenceInput> = {}): CreateCustomerEvidenceInput {
  return {
    criterion_id: 'CC6.1',
    evidence_type: 'policy',
    title: `Test policy ${uniqueSuffix()}`,
    description: 'A test evidence record.',
    external_reference: 'https://example.com/policy.pdf',
    submitted_by: null,
    review_date: null,
    ...overrides,
  };
}

describe('customer_evidence — schema/contract (live DB)', () => {
  it('columns, defaults, RLS, and constraints exist as expected', async () => {
    const { rows: cols } = await pool.query(
      `SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns
       WHERE table_name = 'customer_evidence' ORDER BY ordinal_position`
    );
    const colNames = cols.map((c) => c.column_name);
    expect(colNames).toEqual([
      'id', 'organization_id', 'criterion_id', 'evidence_type', 'title', 'description',
      'external_reference', 'provenance', 'status', 'submitted_by', 'submitted_at',
      'review_date', 'created_at', 'updated_at',
    ]);
    expect(cols.find((c) => c.column_name === 'organization_id')?.is_nullable).toBe('NO');
    expect(cols.find((c) => c.column_name === 'description')?.is_nullable).toBe('YES');
    expect(cols.find((c) => c.column_name === 'external_reference')?.is_nullable).toBe('YES');
    expect(cols.find((c) => c.column_name === 'review_date')?.is_nullable).toBe('YES');
    expect(cols.find((c) => c.column_name === 'provenance')?.column_default).toMatch(/SELF_ATTESTED/);
    expect(cols.find((c) => c.column_name === 'status')?.column_default).toMatch(/SUBMITTED/);

    const { rows: rls } = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_evidence'`
    );
    expect(rls[0].relrowsecurity).toBe(true);

    const { rows: constraints } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.customer_evidence'::regclass`
    );
    const provenanceCheck = constraints.find((c) => c.def.includes('provenance'));
    expect(provenanceCheck?.def).toMatch(/SELF_ATTESTED/);
    expect(provenanceCheck?.def).not.toMatch(/OBSERVED|DERIVED/);

    const statusCheck = constraints.find((c) => c.def.includes('status'));
    expect(statusCheck?.def).toMatch(/SUBMITTED/);
    expect(statusCheck?.def).toMatch(/REVIEWED/);
    expect(statusCheck?.def).toMatch(/EXPIRED/);
    expect(statusCheck?.def).toMatch(/SUPERSEDED/);
    expect(statusCheck?.def).not.toMatch(/ACCEPTED/);

    // No UNIQUE(organization_id, criterion_id) -- multiple evidence records per
    // criterion must be allowed (locked product decision).
    const uniqueConstraints = constraints.filter((c) => c.def.startsWith('UNIQUE'));
    expect(uniqueConstraints).toHaveLength(0);
  });

  it('multiple evidence records for the same (organization, criterion) are allowed', async () => {
    const orgId = await insertOrg();
    await repo.createCustomerEvidence(orgId, evidenceInput({ title: 'First policy doc' }));
    await repo.createCustomerEvidence(orgId, evidenceInput({ title: 'Second policy doc' }));

    const rows = await repo.getCustomerEvidence(orgId, 'CC6.1');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('every created record has provenance SELF_ATTESTED and status SUBMITTED regardless of input', async () => {
    const orgId = await insertOrg();
    const created = await repo.createCustomerEvidence(orgId, evidenceInput());
    expect(created.provenance).toBe('SELF_ATTESTED');
    expect(created.status).toBe('SUBMITTED');
  });
});

describe('customer_evidence — lifecycle transitions (live DB)', () => {
  it('SUBMITTED -> REVIEWED succeeds; re-reviewing an already-REVIEWED record is rejected', async () => {
    const orgId = await insertOrg();
    const created = await repo.createCustomerEvidence(orgId, evidenceInput());

    const reviewed = await repo.reviewCustomerEvidence(orgId, created.id!);
    expect(reviewed?.status).toBe('REVIEWED');

    const secondReview = await repo.reviewCustomerEvidence(orgId, created.id!);
    expect(secondReview).toBeUndefined();
  });

  it('SUBMITTED -> EXPIRED and REVIEWED -> EXPIRED both succeed', async () => {
    const orgId = await insertOrg();

    const submitted = await repo.createCustomerEvidence(orgId, evidenceInput());
    const expiredFromSubmitted = await repo.expireCustomerEvidence(orgId, submitted.id!);
    expect(expiredFromSubmitted?.status).toBe('EXPIRED');

    const toReview = await repo.createCustomerEvidence(orgId, evidenceInput());
    await repo.reviewCustomerEvidence(orgId, toReview.id!);
    const expiredFromReviewed = await repo.expireCustomerEvidence(orgId, toReview.id!);
    expect(expiredFromReviewed?.status).toBe('EXPIRED');
  });

  it('EXPIRED -> REVIEWED is rejected (not a legal transition)', async () => {
    const orgId = await insertOrg();
    const created = await repo.createCustomerEvidence(orgId, evidenceInput());
    await repo.expireCustomerEvidence(orgId, created.id!);

    const illegal = await repo.reviewCustomerEvidence(orgId, created.id!);
    expect(illegal).toBeUndefined();

    const { rows } = await pool.query(`SELECT status FROM customer_evidence WHERE id = $1`, [created.id]);
    expect(rows[0].status).toBe('EXPIRED');
  });

  it('supersede is atomic: old record becomes SUPERSEDED, replacement is created as SUBMITTED, and the old record remains queryable', async () => {
    const orgId = await insertOrg();
    const original = await repo.createCustomerEvidence(orgId, evidenceInput({ title: 'Original policy' }));

    const result = await repo.supersedeCustomerEvidence(orgId, original.id!, {
      evidence_type: 'policy',
      title: 'Replacement policy',
      description: null,
      external_reference: null,
      submitted_by: null,
      review_date: null,
    });

    expect(result?.superseded.status).toBe('SUPERSEDED');
    expect(result?.replacement.status).toBe('SUBMITTED');
    expect(result?.replacement.provenance).toBe('SELF_ATTESTED');
    // The replacement inherits the old record's criterion_id, not any client-supplied value.
    expect(result?.replacement.criterion_id).toBe('CC6.1');

    // The old row was never deleted -- still readable, still SUPERSEDED.
    const stillThere = await repo.getCustomerEvidenceById(orgId, original.id!);
    expect(stillThere?.status).toBe('SUPERSEDED');
  });

  it('superseding an already-SUPERSEDED record is rejected, and no replacement is created', async () => {
    const orgId = await insertOrg();
    const original = await repo.createCustomerEvidence(orgId, evidenceInput());
    await repo.supersedeCustomerEvidence(orgId, original.id!, {
      evidence_type: 'policy',
      title: 'First replacement',
      description: null,
      external_reference: null,
      submitted_by: null,
      review_date: null,
    });

    const secondSupersede = await repo.supersedeCustomerEvidence(orgId, original.id!, {
      evidence_type: 'policy',
      title: 'Should never be created',
      description: null,
      external_reference: null,
      submitted_by: null,
      review_date: null,
    });
    expect(secondSupersede).toBeUndefined();

    const all = await repo.getCustomerEvidence(orgId, 'CC6.1');
    expect(all.some((e) => e.title === 'Should never be created')).toBe(false);
  });

  it('metadata updates are only permitted while status is SUBMITTED', async () => {
    const orgId = await insertOrg();
    const created = await repo.createCustomerEvidence(orgId, evidenceInput());

    const updated = await repo.updateCustomerEvidenceMetadata(orgId, created.id!, { title: 'Edited while SUBMITTED' });
    expect(updated?.title).toBe('Edited while SUBMITTED');

    await repo.reviewCustomerEvidence(orgId, created.id!);
    const rejectedEdit = await repo.updateCustomerEvidenceMetadata(orgId, created.id!, { title: 'Should not apply' });
    expect(rejectedEdit).toBeUndefined();

    const { rows } = await pool.query(`SELECT title FROM customer_evidence WHERE id = $1`, [created.id]);
    expect(rows[0].title).toBe('Edited while SUBMITTED');
  });
});

describe('organization isolation — customer_evidence', () => {
  it('evidence created for org A is invisible when read as org B', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();

    await repo.createCustomerEvidence(orgA, evidenceInput());

    const asOrgB = await repo.getCustomerEvidence(orgB);
    expect(asOrgB).toHaveLength(0);

    const asOrgA = await repo.getCustomerEvidence(orgA);
    expect(asOrgA.length).toBeGreaterThan(0);
  });

  it('org B cannot fetch org A evidence by id', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const created = await repo.createCustomerEvidence(orgA, evidenceInput());

    const asOrgB = await repo.getCustomerEvidenceById(orgB, created.id!);
    expect(asOrgB).toBeUndefined();

    const asOrgA = await repo.getCustomerEvidenceById(orgA, created.id!);
    expect(asOrgA?.id).toBe(created.id);
  });

  it('org B cannot review, expire, or supersede org A evidence', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const created = await repo.createCustomerEvidence(orgA, evidenceInput());

    expect(await repo.reviewCustomerEvidence(orgB, created.id!)).toBeUndefined();
    expect(await repo.expireCustomerEvidence(orgB, created.id!)).toBeUndefined();
    expect(
      await repo.supersedeCustomerEvidence(orgB, created.id!, {
        evidence_type: 'policy',
        title: 'Should never be created',
        description: null,
        external_reference: null,
        submitted_by: null,
        review_date: null,
      })
    ).toBeUndefined();

    // Confirm org A's record is untouched.
    const stillSubmitted = await repo.getCustomerEvidenceById(orgA, created.id!);
    expect(stillSubmitted?.status).toBe('SUBMITTED');
  });
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
