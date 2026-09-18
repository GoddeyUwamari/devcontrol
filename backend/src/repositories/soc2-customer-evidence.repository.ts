/**
 * SOC 2 Readiness Evidence Layer -- Phase 3 customer-evidence repository.
 *
 * Follows soc2-evidence.repository.ts's exact organization-scoping discipline: every
 * method acquires a dedicated PoolClient and sets app.current_organization_id on it
 * before querying -- never the shared, unscoped `pool` directly. RLS on
 * customer_evidence enforces isolation independently of this discipline; this
 * repository does not rely on RLS alone.
 *
 * This repository only ever reads/writes customer_evidence. It never writes to
 * soc2_evidence_observations, soc2_control_evaluations, aws_resources.compliance_issues,
 * account_security_findings, or security_hub_findings.
 *
 * LIFECYCLE ENFORCEMENT: review/expire/supersede are each a single conditional UPDATE
 * whose WHERE clause encodes the legal-transition rule (e.g. `AND status = 'SUBMITTED'`
 * for review) -- not a separate read-then-check-then-write. This makes the transition
 * check atomic and race-safe: two concurrent review attempts on the same row can never
 * both succeed, and a caller can distinguish "row doesn't exist" from "row exists but in
 * the wrong status" only by a follow-up existence check, exactly like
 * soc2-evidence.repository.ts's upsert methods don't attempt to.
 *
 * NO DELETE METHOD EXISTS ON THIS REPOSITORY -- v1 has no hard delete, by design (see
 * the migration's docblock). expireCustomerEvidence/supersedeCustomerEvidence are the
 * only ways a record stops being "current," and both are status transitions, not row
 * removal.
 */
import { Pool, PoolClient } from 'pg';
import { Soc2CustomerEvidence, Soc2CustomerEvidenceType } from '../types/soc2-evidence.types';

export interface CreateCustomerEvidenceInput {
  criterion_id: string;
  evidence_type: Soc2CustomerEvidenceType;
  title: string;
  description: string | null;
  external_reference: string | null;
  submitted_by: string | null;
  review_date: Date | null;
}

export interface UpdateCustomerEvidenceMetadataInput {
  evidence_type?: Soc2CustomerEvidenceType;
  title?: string;
  description?: string | null;
  external_reference?: string | null;
  review_date?: Date | null;
}

export interface SupersedeResult {
  superseded: Soc2CustomerEvidence;
  replacement: Soc2CustomerEvidence;
}

export class Soc2CustomerEvidenceRepository {
  constructor(private pool: Pool) {}

  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private mapRow(row: any): Soc2CustomerEvidence {
    return {
      id: row.id,
      organization_id: row.organization_id,
      criterion_id: row.criterion_id,
      evidence_type: row.evidence_type,
      title: row.title,
      description: row.description,
      external_reference: row.external_reference,
      provenance: row.provenance,
      status: row.status,
      submitted_by: row.submitted_by,
      submitted_at: row.submitted_at,
      review_date: row.review_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * provenance and status are never accepted as input here -- provenance is always
   * 'SELF_ATTESTED' (the column default, also DB-CHECK-enforced) and status always
   * starts 'SUBMITTED' (also the column default). organization_id is the scoped
   * parameter, never read from `input`, so a caller cannot smuggle a different org in.
   */
  async createCustomerEvidence(
    organizationId: string,
    input: CreateCustomerEvidenceInput
  ): Promise<Soc2CustomerEvidence> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO customer_evidence
          (organization_id, criterion_id, evidence_type, title, description,
           external_reference, submitted_by, review_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          organizationId,
          input.criterion_id,
          input.evidence_type,
          input.title,
          input.description,
          input.external_reference,
          input.submitted_by,
          input.review_date,
        ]
      );
      return this.mapRow(rows[0]);
    });
  }

  async getCustomerEvidence(
    organizationId: string,
    criterionId?: string
  ): Promise<Soc2CustomerEvidence[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = criterionId
        ? await client.query(
            `SELECT * FROM customer_evidence WHERE organization_id = $1 AND criterion_id = $2 ORDER BY created_at DESC`,
            [organizationId, criterionId]
          )
        : await client.query(
            `SELECT * FROM customer_evidence WHERE organization_id = $1 ORDER BY created_at DESC`,
            [organizationId]
          );
      return rows.map((r) => this.mapRow(r));
    });
  }

  async getCustomerEvidenceById(
    organizationId: string,
    evidenceId: string
  ): Promise<Soc2CustomerEvidence | undefined> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM customer_evidence WHERE id = $1 AND organization_id = $2`,
        [evidenceId, organizationId]
      );
      return rows[0] ? this.mapRow(rows[0]) : undefined;
    });
  }

  /**
   * Metadata-only update. Never touches organization_id, criterion_id, provenance,
   * status, submitted_by, or submitted_at -- those columns simply do not appear in this
   * query's SET clause, so no caller-supplied value can reach them regardless of what
   * `patch` contains. Only permitted while status = 'SUBMITTED' -- editing the
   * underlying content of evidence that has already been REVIEWED would silently
   * invalidate that review; use supersedeCustomerEvidence instead once reviewed.
   * Returns undefined if the row doesn't exist, isn't in this organization, or isn't
   * SUBMITTED (the caller cannot distinguish which from this alone; see the service
   * layer for a precise error).
   */
  async updateCustomerEvidenceMetadata(
    organizationId: string,
    evidenceId: string,
    patch: UpdateCustomerEvidenceMetadataInput
  ): Promise<Soc2CustomerEvidence | undefined> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `UPDATE customer_evidence
         SET evidence_type = COALESCE($3, evidence_type),
             title = COALESCE($4, title),
             description = CASE WHEN $5::boolean THEN $6 ELSE description END,
             external_reference = CASE WHEN $7::boolean THEN $8 ELSE external_reference END,
             review_date = CASE WHEN $9::boolean THEN $10 ELSE review_date END,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'SUBMITTED'
         RETURNING *`,
        [
          evidenceId,
          organizationId,
          patch.evidence_type ?? null,
          patch.title ?? null,
          'description' in patch,
          patch.description ?? null,
          'external_reference' in patch,
          patch.external_reference ?? null,
          'review_date' in patch,
          patch.review_date ?? null,
        ]
      );
      return rows[0] ? this.mapRow(rows[0]) : undefined;
    });
  }

  /** SUBMITTED -> REVIEWED only. Atomic conditional UPDATE -- see this file's docblock. */
  async reviewCustomerEvidence(
    organizationId: string,
    evidenceId: string
  ): Promise<Soc2CustomerEvidence | undefined> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `UPDATE customer_evidence
         SET status = 'REVIEWED', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'SUBMITTED'
         RETURNING *`,
        [evidenceId, organizationId]
      );
      return rows[0] ? this.mapRow(rows[0]) : undefined;
    });
  }

  /** SUBMITTED or REVIEWED -> EXPIRED only. Never from EXPIRED/SUPERSEDED (already
   * terminal). Manual action only -- nothing calls this automatically. */
  async expireCustomerEvidence(
    organizationId: string,
    evidenceId: string
  ): Promise<Soc2CustomerEvidence | undefined> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `UPDATE customer_evidence
         SET status = 'EXPIRED', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status IN ('SUBMITTED', 'REVIEWED')
         RETURNING *`,
        [evidenceId, organizationId]
      );
      return rows[0] ? this.mapRow(rows[0]) : undefined;
    });
  }

  /**
   * SUBMITTED or REVIEWED -> SUPERSEDED, atomically paired with inserting the
   * replacement row, in one transaction. The replacement always inherits the old
   * record's criterion_id (never taken from `replacement`) -- supersede replaces one
   * piece of evidence for the same criterion with a newer one; it must never be usable
   * to attach evidence to a different criterion under the guise of a supersede. The old
   * record is never deleted -- it remains readable in status SUPERSEDED.
   */
  async supersedeCustomerEvidence(
    organizationId: string,
    oldEvidenceId: string,
    replacement: Omit<CreateCustomerEvidenceInput, 'criterion_id'>
  ): Promise<SupersedeResult | undefined> {
    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');

        const { rows: supersededRows } = await client.query(
          `UPDATE customer_evidence
           SET status = 'SUPERSEDED', updated_at = NOW()
           WHERE id = $1 AND organization_id = $2 AND status IN ('SUBMITTED', 'REVIEWED')
           RETURNING *`,
          [oldEvidenceId, organizationId]
        );

        if (supersededRows.length === 0) {
          await client.query('ROLLBACK');
          return undefined;
        }

        const oldRow = supersededRows[0];

        const { rows: replacementRows } = await client.query(
          `INSERT INTO customer_evidence
            (organization_id, criterion_id, evidence_type, title, description,
             external_reference, submitted_by, review_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            organizationId,
            oldRow.criterion_id,
            replacement.evidence_type,
            replacement.title,
            replacement.description,
            replacement.external_reference,
            replacement.submitted_by,
            replacement.review_date,
          ]
        );

        await client.query('COMMIT');

        return {
          superseded: this.mapRow(oldRow),
          replacement: this.mapRow(replacementRows[0]),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
}
