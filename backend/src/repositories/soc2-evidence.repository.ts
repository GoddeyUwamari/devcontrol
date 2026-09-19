/**
 * SOC 2 Readiness Evidence Layer -- Phase 1 repository.
 *
 * Every method acquires a dedicated PoolClient and sets app.current_organization_id on
 * it before querying, exactly like AccountSecurityFindingsRepository.withOrgClient /
 * RiskTrackingService.withOrgClient -- never the shared, unscoped `pool` directly for
 * an organization-sensitive query. RLS on soc2_evidence_observations/
 * soc2_control_evaluations enforces isolation independently of this discipline; this
 * repository does not rely on RLS alone.
 *
 * This repository only ever writes to soc2_evidence_observations and
 * soc2_control_evaluations. It never writes to aws_resources.compliance_issues,
 * account_security_findings, or security_hub_findings.
 */
import { Pool, PoolClient } from 'pg';
import {
  Soc2ControlEvaluation,
  Soc2EvidenceObservation,
  Soc2EvidenceSummary,
  Soc2ObservationReconciliationScope,
} from '../types/soc2-evidence.types';

/**
 * Distinct from cost-recommendations.repository.ts's RECONCILIATION_LOCK_SALT (1) and
 * stripe-webhook-ledger.service.ts's salt (0) -- see hashtextextended(organizationId,
 * salt)'s own semantics: the salt is what separates independent lock domains that
 * otherwise key on the same organizationId text, so it must never collide with an
 * existing salt. Used by persistComputation() to guarantee only one SOC 2 computation
 * can be in flight per organization at a time (Phase 5 concurrency guard).
 */
const SOC2_COMPUTATION_LOCK_SALT = 2;

export class Soc2EvidenceRepository {
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

  private mapObservationRow(row: any): Soc2EvidenceObservation {
    return {
      id: row.id,
      organization_id: row.organization_id,
      criterion_id: row.criterion_id,
      resource_arn: row.resource_arn,
      resource_type: row.resource_type,
      provenance: row.provenance,
      result: row.result,
      observed_at: row.observed_at,
      collected_at: row.collected_at,
      source: row.source,
      explanation: row.explanation,
      schema_version: row.schema_version,
      created_at: row.created_at,
    };
  }

  private mapEvaluationRow(row: any): Soc2ControlEvaluation {
    return {
      id: row.id,
      organization_id: row.organization_id,
      criterion_id: row.criterion_id,
      disposition_class: row.disposition_class,
      evidence_summary: row.evidence_summary as Soc2EvidenceSummary,
      customer_evidence_ids: row.customer_evidence_ids ?? [],
      computed_at: row.computed_at,
    };
  }

  /**
   * Shared by upsertObservations() and persistComputation() -- one observation's own
   * INSERT .. ON CONFLICT DO UPDATE, unchanged from the original single-purpose
   * upsertObservations() implementation. Identity matches the migration's expression
   * unique index exactly -- (organization_id, criterion_id, resource_type,
   * COALESCE(resource_arn, '')) -- so a NULL resource_arn org-level aggregate row
   * collides with itself on re-run instead of silently duplicating (see the migration's
   * "RESOURCE IDENTITY NOTE"). Caller is responsible for its own transaction boundary.
   */
  private async upsertObservationRow(client: PoolClient, obs: Soc2EvidenceObservation): Promise<void> {
    await client.query(
      `INSERT INTO soc2_evidence_observations
        (organization_id, criterion_id, resource_arn, resource_type, provenance,
         result, observed_at, collected_at, source, explanation, schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (organization_id, criterion_id, resource_type, COALESCE(resource_arn, ''))
       DO UPDATE SET
         provenance = EXCLUDED.provenance,
         result = EXCLUDED.result,
         observed_at = EXCLUDED.observed_at,
         collected_at = EXCLUDED.collected_at,
         source = EXCLUDED.source,
         explanation = EXCLUDED.explanation,
         schema_version = EXCLUDED.schema_version`,
      [
        obs.organization_id,
        obs.criterion_id,
        obs.resource_arn,
        obs.resource_type,
        obs.provenance,
        obs.result,
        obs.observed_at,
        obs.collected_at,
        JSON.stringify(obs.source),
        obs.explanation,
        obs.schema_version ?? 1,
      ]
    );
  }

  /**
   * Shared by upsertControlEvaluation() and persistComputation() -- one evaluation's
   * own INSERT .. ON CONFLICT DO UPDATE, unchanged from the original single-purpose
   * upsertControlEvaluation() implementation. Caller is responsible for its own
   * transaction boundary.
   */
  private async upsertEvaluationRow(
    client: PoolClient,
    organizationId: string,
    evaluation: Soc2ControlEvaluation
  ): Promise<void> {
    await client.query(
      `INSERT INTO soc2_control_evaluations
        (organization_id, criterion_id, disposition_class, evidence_summary,
         customer_evidence_ids, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, criterion_id)
       DO UPDATE SET
         disposition_class = EXCLUDED.disposition_class,
         evidence_summary = EXCLUDED.evidence_summary,
         customer_evidence_ids = EXCLUDED.customer_evidence_ids,
         computed_at = EXCLUDED.computed_at`,
      [
        organizationId,
        evaluation.criterion_id,
        evaluation.disposition_class,
        JSON.stringify(evaluation.evidence_summary),
        evaluation.customer_evidence_ids,
        evaluation.computed_at,
      ]
    );
  }

  /**
   * Deletes any existing observation row for (organizationId, criterionId,
   * resourceType) whose resource_arn is not among currentResourceArns -- the
   * reconciliation step for Phase 1's current-state model (a resource that discovery
   * no longer reports, e.g. terminated/deleted, or a finding that is no longer active,
   * must not leave a permanently stale observation behind).
   *
   * `resource_arn IS NOT NULL` is unconditional: the per-criterion org-level aggregate
   * row (resource_arn IS NULL) is NEVER a target of this reconciliation -- it is always
   * re-upserted fresh, every run, by the caller's own per-criterion aggregate logic
   * (see Soc2EvidenceService.perResourceAndAggregate), so it is never "missing" from a
   * run's computed set in the first place.
   *
   * `<> ALL($4::text[])` over an empty array is vacuously true for every row -- the
   * same idiom already used by cost-recommendations.repository.ts's
   * reconcileActiveRecommendations() -- so an organization that now has zero resources
   * of this (criterion, resource_type) correctly clears every previously-stored
   * per-resource row for it.
   *
   * Caller is responsible for its own transaction boundary.
   */
  private async reconcileObservationScope(
    client: PoolClient,
    organizationId: string,
    scope: Soc2ObservationReconciliationScope
  ): Promise<void> {
    await client.query(
      `DELETE FROM soc2_evidence_observations
       WHERE organization_id = $1
         AND criterion_id = $2
         AND resource_type = $3
         AND resource_arn IS NOT NULL
         AND resource_arn <> ALL($4::text[])`,
      [organizationId, scope.criterionId, scope.resourceType, scope.currentResourceArns]
    );
  }

  /**
   * Upserts observations for one organization inside a single transaction. Identity
   * matches the migration's expression unique index exactly --
   * (organization_id, criterion_id, resource_type, COALESCE(resource_arn, '')) -- so a
   * NULL resource_arn org-level aggregate row collides with itself on re-run instead of
   * silently duplicating (see the migration's "RESOURCE IDENTITY NOTE").
   *
   * Deliberately unchanged from Phase 1: performs no reconciliation/deletion of its
   * own -- it is a general-purpose upsert primitive used directly by
   * soc2-evidence-rls.test.ts with a single hand-built observation at a time, where
   * "delete anything else for this (criterion, resource_type) not in this call" would
   * be an incorrect, surprising side effect. The reconciling, atomic, six-evaluation
   * workflow computeAndPersistEvidence() actually uses is persistComputation() below.
   */
  async upsertObservations(
    organizationId: string,
    observations: Soc2EvidenceObservation[]
  ): Promise<void> {
    if (observations.length === 0) return;

    await this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');
        for (const obs of observations) {
          if (obs.organization_id !== organizationId) {
            throw new Error(
              `Soc2EvidenceRepository.upsertObservations: observation.organization_id (${obs.organization_id}) does not match the scoped organizationId (${organizationId})`
            );
          }
          await this.upsertObservationRow(client, obs);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async getObservations(
    organizationId: string,
    criterionId?: string
  ): Promise<Soc2EvidenceObservation[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = criterionId
        ? await client.query(
            `SELECT * FROM soc2_evidence_observations WHERE organization_id = $1 AND criterion_id = $2 ORDER BY resource_arn NULLS FIRST`,
            [organizationId, criterionId]
          )
        : await client.query(
            `SELECT * FROM soc2_evidence_observations WHERE organization_id = $1 ORDER BY criterion_id, resource_arn NULLS FIRST`,
            [organizationId]
          );
      return rows.map((r) => this.mapObservationRow(r));
    });
  }

  async upsertControlEvaluation(
    organizationId: string,
    evaluation: Soc2ControlEvaluation
  ): Promise<void> {
    if (evaluation.organization_id !== organizationId) {
      throw new Error(
        `Soc2EvidenceRepository.upsertControlEvaluation: evaluation.organization_id (${evaluation.organization_id}) does not match the scoped organizationId (${organizationId})`
      );
    }
    await this.withOrgClient(organizationId, async (client) => {
      await this.upsertEvaluationRow(client, organizationId, evaluation);
    });
  }

  async getControlEvaluations(organizationId: string): Promise<Soc2ControlEvaluation[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM soc2_control_evaluations WHERE organization_id = $1 ORDER BY criterion_id`,
        [organizationId]
      );
      return rows.map((r) => this.mapEvaluationRow(r));
    });
  }

  /**
   * Whether the organization's most recent discovery job completed its compliance +
   * account-level security scan successfully. This is the only structurally-persisted
   * completeness signal available (resource_discovery_jobs.compliance_scan_completed,
   * set at the end of every discovery run -- see awsResourceDiscovery.ts). It is
   * coarser than per-category (it cannot distinguish "IAM was complete but networking
   * wasn't", or isolate the S3-enhanced-check's own completeness), but it is real and
   * always present, unlike account_security_findings' completeCategories (a call-time
   * parameter never persisted to a column) or the best-effort audit_logs entry it
   * produces. See soc2-evidence.service.ts's docblock for the full reasoning.
   *
   * Returns false (never throws/never assumes complete) if no discovery job has ever
   * run for this org.
   */
  async isLatestDiscoveryComplete(organizationId: string): Promise<boolean> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT compliance_scan_completed FROM resource_discovery_jobs
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [organizationId]
      );
      return rows.length > 0 && rows[0].compliance_scan_completed === true;
    });
  }

  /**
   * Phase 5 -- the single atomic write path computeAndPersistEvidence() uses. In one
   * transaction, on one connection, guarded by a per-organization Postgres advisory
   * lock held for the whole call (same pattern as cost-recommendations.repository.ts's
   * reconcileActiveRecommendations(), just a distinct salt -- see
   * SOC2_COMPUTATION_LOCK_SALT):
   *
   *   1. pg_advisory_lock(hashtextextended(organizationId, SOC2_COMPUTATION_LOCK_SALT))
   *      -- so two concurrent computations for the SAME organization (e.g. an
   *      overlapping cron sweep and a retry) serialize instead of interleaving;
   *      different organizations are never blocked by each other (the lock key
   *      includes organizationId).
   *   2. BEGIN
   *   3. reconcile (delete stale per-resource rows) for every (criterion, resource_type)
   *      scope this run computed, per reconciliationScopes.
   *   4. upsert every fresh observation.
   *   5. upsert all six control evaluations.
   *   6. COMMIT, or ROLLBACK on any error -- so a failure on, say, the fourth
   *      evaluation leaves NO evaluation from this run committed (not "three new, three
   *      old") and every previously-persisted row -- observations and evaluations
   *      alike -- exactly as it was before this call. The caller sees the thrown error;
   *      no partial state is ever visible to a reader.
   *   7. pg_advisory_unlock in a `finally`, on the same connection, before it is
   *      released back to the pool -- released on both success and failure, and never
   *      left held on a pooled connection that could later be reused for an unrelated
   *      request.
   */
  async persistComputation(
    organizationId: string,
    observations: Soc2EvidenceObservation[],
    reconciliationScopes: Soc2ObservationReconciliationScope[],
    evaluations: Soc2ControlEvaluation[]
  ): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${SOC2_COMPUTATION_LOCK_SALT}))`,
        [organizationId]
      );

      try {
        await client.query('BEGIN');

        for (const scope of reconciliationScopes) {
          await this.reconcileObservationScope(client, organizationId, scope);
        }

        for (const obs of observations) {
          if (obs.organization_id !== organizationId) {
            throw new Error(
              `Soc2EvidenceRepository.persistComputation: observation.organization_id (${obs.organization_id}) does not match the scoped organizationId (${organizationId})`
            );
          }
          await this.upsertObservationRow(client, obs);
        }

        for (const evaluation of evaluations) {
          if (evaluation.organization_id !== organizationId) {
            throw new Error(
              `Soc2EvidenceRepository.persistComputation: evaluation.organization_id (${evaluation.organization_id}) does not match the scoped organizationId (${organizationId})`
            );
          }
          await this.upsertEvaluationRow(client, organizationId, evaluation);
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, ${SOC2_COMPUTATION_LOCK_SALT}))`,
          [organizationId]
        );
      }
    });
  }
}
