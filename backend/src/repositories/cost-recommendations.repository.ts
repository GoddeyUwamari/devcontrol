import { PoolClient } from 'pg';
import { pool } from '../config/database';
import {
  CostRecommendation,
  CreateRecommendationRequest,
  RecommendationFilters,
  RecommendationStats,
  RecommendationStatus,
} from '../types';
import { DetectorObservation } from '../services/cost-optimization.service';
import { HeldLease, beginFenced } from '../services/scan-lease';
import { aggregateEstimatedSavings, countSavingsFindings } from '../services/estimated-savings';
import { EMPTY_RECONCILE_COUNTS, ReconcileCounts } from '../services/cost-analysis-outcome';
import { AuditEventAction, AuditRequestContext, insertAuditEventInTransaction } from '../services/auditEvents.service';
import { DetectionState, NotConfirmedReason, judgeFreshness } from '../services/cost-finding-freshness';
import { LatestLeasedRun, latestLeasedRun } from './cost-analysis-runs.repository';
import { displayIssue } from '../services/finding-display';
import {
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_RDS_OVERSIZED_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EBS_GP2_TO_GP3,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_DYNAMODB_CAPACITY,
  ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
} from '../config/optimization-rules';

/** Open findings by what their dollar figure is (getActiveSavingsBreakdown). */
export interface ActiveSavingsBreakdown {
  /** Every ACTIVE finding. */
  active: number;
  /** De-duplicated sum of the estimates (aggregateEstimatedSavings().total); never includes an upper bound. */
  estimatedMonthlySavings: number;
  /** Findings whose estimate adds more than $0 to estimatedMonthlySavings (countedEstimateAmounts). */
  estimatedFindings: number;
  /** Upper bounds by resource type (aggregateEstimatedSavings().ceilingByResourceType). */
  ceilingByResourceType: Record<string, number>;
  /** Findings with neither an estimate above $0 nor an upper bound (no figure, no supported basis, or an estimate that adds $0). */
  unestimatedFindings: number;
}

// Fixed, canonical issue strings for the resource-identity-based detectors
// this occurrence lifecycle applies to
// (backend/src/services/cost-optimization.service.ts, via the shared
// identities in config/optimization-rules.ts). Reserved Instance Opportunity
// is deliberately excluded -- its resource_id is a synthetic, fleet-level
// aggregate (`ri-opportunity-${instanceType}`), not a discrete AWS resource,
// so it keeps the pre-existing unconditional delete+recreate behavior via
// replaceReservedInstanceRecommendations() instead of reconcileActiveRecommendations().
const NON_RI_ISSUES = [
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_RDS_OVERSIZED_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  ISSUE_LAMBDA_LOW_USAGE,
] as const;

// Distinct from the migration runner's single-integer advisory lock
// (database/migrate.js, key 727271, the untyped single-bigint keyspace) and
// from stripe-webhook-ledger.service.ts's hashtextextended(id, 0) locks
// (same two-argument keyspace, salt 0) -- this uses the same keyspace with
// a different salt so none of the three can collide with each other.
const RECONCILIATION_LOCK_SALT = 1;

/**
 * The scan a reconciliation answers for (multi-region plan M4, §6.2): the home region
 * its home-listed detectors listed. Rows of those issues in another region are not
 * this scan's to delete or end.
 */
export interface CostReconcileScope {
  homeRegion: string;
}

/**
 * Issues whose detector lists the home region only (DescribeInstances,
 * DescribeAddresses, DescribeVolumes, ListFunctions with the home-region client), so
 * a scan reconciles their rows in the home region only (and rows with no region, as
 * written before regions were recorded). The DynamoDB issues too since multi-region
 * PR 1 (review H-1): their detectors read the home region's DynamoDB rows only, so a
 * recommendation of another region is not this scan's to end or delete. S3 lifecycle
 * (account-wide ListBuckets) and the retired oversized-RDS issue keep their
 * region-unrestricted scope.
 */
const HOME_REGION_SCOPED_ISSUES: ReadonlySet<string> = new Set([
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EBS_GP2_TO_GP3,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_DYNAMODB_CAPACITY,
  ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
]);

/**
 * Inserts one ACTIVE recommendation, unconditionally (no occurrence-lifecycle
 * suppression), and returns how many rows it inserted. ON CONFLICT DO NOTHING
 * guards idx_cost_recommendations_active_identity. The one INSERT shared by
 * createBulk() and replaceReservedInstanceRecommendations().
 */
async function insertActiveRecommendation(
  client: PoolClient,
  organizationId: string,
  rec: CreateRecommendationRequest
): Promise<number> {
  const result = await client.query(
    `INSERT INTO cost_recommendations (
       organization_id, resource_id, resource_name, resource_type, issue, description,
       potential_savings, severity, aws_region, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (organization_id, resource_id, issue) WHERE status = 'ACTIVE' DO NOTHING`,
    [
      organizationId,
      rec.resource_id,
      rec.resource_name,
      rec.resource_type,
      rec.issue,
      rec.description,
      rec.potential_savings,
      rec.severity,
      rec.aws_region,
      JSON.stringify(rec.metadata || {}),
    ]
  );
  return result.rowCount || 0;
}

/** The region a statement for `issue` is limited to, or null for no region limit. */
function regionLimitFor(issue: string, scope: CostReconcileScope | undefined): string | null {
  return scope && HOME_REGION_SCOPED_ISSUES.has(issue) ? scope.homeRegion : null;
}

/** The ACTIVE resources of `issue` before this scan changes them. */
async function activeResourceIds(client: PoolClient, organizationId: string, issue: string): Promise<Set<string>> {
  const { rows } = await client.query<{ resource_id: string }>(
    `SELECT resource_id FROM cost_recommendations
     WHERE organization_id = $1 AND issue = $2 AND status = 'ACTIVE'`,
    [organizationId, issue]
  );
  return new Set(rows.map((row) => row.resource_id));
}

/**
 * For each resource of `issue` with an open occurrence, its newest decision. One
 * finding can have many open rows; the latest decision is the one in force.
 */
async function latestOpenDecisions(
  client: PoolClient,
  organizationId: string,
  issue: string
): Promise<Map<string, RecommendationStatus>> {
  const { rows } = await client.query<{ resource_id: string; status: RecommendationStatus }>(
    `SELECT DISTINCT ON (resource_id) resource_id, status
     FROM cost_recommendations
     WHERE organization_id = $1 AND issue = $2
       AND status IN ('RESOLVED', 'DISMISSED') AND occurrence_ended_at IS NULL
     ORDER BY resource_id, updated_at DESC, id DESC`,
    [organizationId, issue]
  );
  return new Map(rows.map((row) => [row.resource_id, row.status]));
}

/**
 * Issues outside the occurrence lifecycle, so never hidden by a decision:
 * Reserved Instance Opportunities are delete-and-recreate (a RESOLVED row
 * suppresses nothing), and the retired oversized-RDS category ends every open
 * occurrence on every scan.
 */
const NEVER_HIDDEN_ISSUES: readonly string[] = [ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, ISSUE_RDS_OVERSIZED_INSTANCE];

/**
 * Who made a decision on a recommendation, recorded with it (founder decision
 * 3a: the audit row is written in the same transaction as the change).
 */
export interface CostDecisionActor {
  userId: string;
  request: AuditRequestContext | null;
  source: 'button' | 'execute_remediation';
}

/**
 * Serializes with reconciliation for this organization until the transaction
 * ends: the same key as reconcileActiveRecommendations()'s session lock, and a
 * transaction lock and a session lock on one key conflict. Call it first in the
 * transaction, so the decision's NOW() and its place in the order agree.
 */
async function lockReconciliation(client: PoolClient, organizationId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`, [organizationId]);
}

/** One finding this reconciliation observed while a decision hides it. */
type HiddenObservation =
  | { outcome: 'detected'; rec: CreateRecommendationRequest }
  | { outcome: 'unknown'; resourceId: string; issue: string };

/**
 * Records each hidden finding's observation in this reconciliation
 * (cost_finding_detections, one row per finding). Behind a savepoint: if the
 * write fails, the reconciliation goes on and those findings simply read "not
 * confirmed". A detection write never fails a scan.
 */
async function recordHiddenObservations(
  client: PoolClient,
  organizationId: string,
  runId: string | null,
  observed: HiddenObservation[]
): Promise<void> {
  if (observed.length === 0) return;
  await client.query('SAVEPOINT cost_finding_detections');
  try {
    for (const entry of observed) {
      if (entry.outcome === 'detected') {
        const rec = entry.rec;
        await client.query(
          `INSERT INTO cost_finding_detections (
             organization_id, resource_id, issue, run_id, outcome, observed_at, detected_at,
             resource_name, resource_type, aws_region, description, potential_savings, severity, metadata
           )
           VALUES ($1, $2, $3, $4, 'detected', NOW(), NOW(), $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (organization_id, resource_id, issue) DO UPDATE
             SET run_id = EXCLUDED.run_id, outcome = 'detected', observed_at = EXCLUDED.observed_at,
                 detected_at = EXCLUDED.detected_at, resource_name = EXCLUDED.resource_name,
                 resource_type = EXCLUDED.resource_type, aws_region = EXCLUDED.aws_region,
                 description = EXCLUDED.description, potential_savings = EXCLUDED.potential_savings,
                 severity = EXCLUDED.severity, metadata = EXCLUDED.metadata
             WHERE cost_finding_detections.organization_id = $1`,
          [
            organizationId, rec.resource_id, rec.issue, runId,
            rec.resource_name, rec.resource_type, rec.aws_region, rec.description,
            rec.potential_savings, rec.severity, JSON.stringify(rec.metadata || {}),
          ]
        );
      } else {
        // The last detection's evidence stays as it was.
        await client.query(
          `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, run_id, outcome, observed_at)
           VALUES ($1, $2, $3, $4, 'unknown', NOW())
           ON CONFLICT (organization_id, resource_id, issue) DO UPDATE
             SET run_id = EXCLUDED.run_id, outcome = 'unknown', observed_at = EXCLUDED.observed_at
             WHERE cost_finding_detections.organization_id = $1`,
          [organizationId, entry.resourceId, entry.issue, runId]
        );
      }
    }
    await client.query('RELEASE SAVEPOINT cost_finding_detections');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT cost_finding_detections');
    console.error('[CostRecommendations] Could not record hidden findings\' detections (non-fatal; they read not confirmed):', (error as Error).message);
  }
}

interface DetectionRow {
  resource_id: string;
  issue: string;
  run_id: string | null;
  outcome: 'detected' | 'unknown';
  observed_at: Date;
  detected_at: Date | null;
  resource_name: string | null;
  resource_type: string | null;
  aws_region: string | null;
  description: string | null;
  potential_savings: string | null;
  severity: string | null;
  metadata: Record<string, any> | null;
}

const DETECTION_COLUMNS = `resource_id, issue, run_id, outcome, observed_at, detected_at,
       resource_name, resource_type, aws_region, description, potential_savings, severity, metadata`;

/** One hidden finding, however many open decision rows it has. */
export interface HiddenFinding {
  /** The latest decision row's id; any row of the finding can be reopened. */
  id: string;
  decision: 'RESOLVED' | 'DISMISSED';
  decidedAt: string;
  /** Full name of who made the latest decision, from its audit event; null when not recorded. */
  decidedBy: string | null;
  decisionCount: number;
  issue: string;
  /**
   * The label to show: "Low-activity instance" when the latest detection was
   * made by the low-activity rule, otherwise the stored issue text.
   */
  issueLabel: string;
  resourceId: string;
  resourceName: string | null;
  resourceType: string;
  awsRegion: string | null;
  detection: {
    state: DetectionState;
    reason: NotConfirmedReason | null;
    lastDetectedAt: string | null;
    potentialSavings: number | null;
    savingsBasis: string | null;
    /** metadata.price_source (EC2 idle figures); null when the detection has none. */
    priceSource: string | null;
    severity: string | null;
    description: string | null;
  };
}

export interface HiddenFindingsSummary {
  resolved: number;
  dismissed: number;
  /** Resolved findings that are still detected: not in ACTIVE totals until reopened. */
  stillDetected: {
    count: number;
    estimatedMonthlySavings: number;
    ceilingMonthlySavings: number;
    ceilingByResourceType: Record<string, number>;
  };
  /** Resolved findings the latest analysis could not confirm. */
  notConfirmed: number;
}

export interface HiddenFindings {
  latestRun: { id: string; runState: string; completedAt: string | null } | null;
  summary: HiddenFindingsSummary;
  items: HiddenFinding[];
}

export type ReopenResult =
  | { outcome: 'not_found' }
  | { outcome: 'not_applicable' }
  | { outcome: 'already_open' }
  | { outcome: 'reopened'; rowsEnded: number; activeNow: boolean; recommendation: CostRecommendation | null };

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toNumber = (value: string | number | null): number | null => {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const freshnessRun = (run: LatestLeasedRun | null) =>
  run ? { id: run.id, run_state: run.run_state, checks: run.checks } : null;

export class CostRecommendationsRepository {
  /**
   * Hold a single client for the whole call and set org context session-scoped
   * (is_local = false) so it survives across multiple statements / an explicit
   * transaction on that connection — matches the pattern used across the rest
   * of the backend for RLS-gated tables.
   */
  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
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

  /**
   * Find all recommendations with optional filters
   */
  async findAll(
    organizationId: string,
    filters?: RecommendationFilters
  ): Promise<CostRecommendation[]> {
    return this.withOrgClient(organizationId, async (client) => {
      let query = `
        SELECT *
        FROM cost_recommendations
        WHERE organization_id = $1
      `;
      const params: any[] = [organizationId];
      let paramCount = 1;

      if (filters?.severity) {
        paramCount++;
        params.push(filters.severity);
        query += ` AND severity = $${paramCount}`;
      }

      if (filters?.status) {
        paramCount++;
        params.push(filters.status);
        query += ` AND status = $${paramCount}`;
      }

      if (filters?.resource_type) {
        paramCount++;
        params.push(filters.resource_type);
        query += ` AND resource_type = $${paramCount}`;
      }

      query += ' ORDER BY potential_savings DESC, created_at DESC';

      if (filters?.limit) {
        paramCount++;
        params.push(filters.limit);
        query += ` LIMIT $${paramCount}`;
      }

      if (filters?.offset) {
        paramCount++;
        params.push(filters.offset);
        query += ` OFFSET $${paramCount}`;
      }

      const result = await client.query(query, params);
      return result.rows;
    });
  }

  /**
   * Find recommendation by ID
   */
  async findById(id: string, organizationId: string): Promise<CostRecommendation | null> {
    return this.withOrgClient(organizationId, async (client) => {
      const query = 'SELECT * FROM cost_recommendations WHERE id = $1 AND organization_id = $2';
      const result = await client.query(query, [id, organizationId]);
      return result.rows[0] || null;
    });
  }

  /**
   * Create a new recommendation
   */
  async create(
    recommendation: CreateRecommendationRequest,
    organizationId: string
  ): Promise<CostRecommendation> {
    return this.withOrgClient(organizationId, async (client) => {
      const query = `
        INSERT INTO cost_recommendations (
          organization_id, resource_id, resource_name, resource_type, issue, description,
          potential_savings, severity, aws_region, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const result = await client.query(query, [
        organizationId,
        recommendation.resource_id,
        recommendation.resource_name,
        recommendation.resource_type,
        recommendation.issue,
        recommendation.description,
        recommendation.potential_savings,
        recommendation.severity,
        recommendation.aws_region,
        JSON.stringify(recommendation.metadata || {}),
      ]);

      return result.rows[0];
    });
  }

  /**
   * Create multiple recommendations in bulk (unconditional insert, no
   * occurrence-lifecycle awareness), for callers that don't need suppression
   * logic. Reserved Instance Opportunities are replaced through
   * replaceReservedInstanceRecommendations() instead, whose delete and inserts
   * share one transaction. ON CONFLICT DO NOTHING guards against
   * idx_cost_recommendations_active_identity without aborting the whole
   * batch on one incidental duplicate -- Postgres never raises an error to
   * the client for a DO NOTHING conflict, so no per-row try/catch or
   * savepoint is needed.
   */
  async createBulk(
    recommendations: CreateRecommendationRequest[],
    organizationId: string
  ): Promise<number> {
    if (recommendations.length === 0) return 0;

    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');

        let insertedCount = 0;
        for (const rec of recommendations) {
          insertedCount += await insertActiveRecommendation(client, organizationId, rec);
        }

        await client.query('COMMIT');
        return insertedCount;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Reconciles ACTIVE recommendations for the 3 occurrence-lifecycle-aware
   * detector categories (NON_RI_ISSUES) against this scan's fresh detector
   * output, in one locked transaction per organization.
   *
   * For each category whose detector completed successfully this scan
   * (observation.success === true):
   *  - any RESOLVED/DISMISSED row for that issue whose resource_id is
   *    absent from this scan's findings has its occurrence marked ended
   *    (occurrence_ended_at set, once, if not already set) -- a completed,
   *    successful "not found" observation is the only thing allowed to end
   *    an occurrence.
   *  - existing ACTIVE rows for that issue are replaced with this scan's
   *    fresh findings, except a finding is skipped (suppressed) if a
   *    RESOLVED/DISMISSED row for the same (organization_id, resource_id,
   *    issue) still has an open occurrence (occurrence_ended_at IS NULL) --
   *    this is the actual Resolve/Dismiss fix: an unchanged condition no
   *    longer resurrects as a new ACTIVE row every scan.
   *
   * A category whose detector did NOT complete successfully this scan is
   * left entirely untouched -- no rows ended, no ACTIVE rows deleted or
   * replaced -- exactly preserving whatever was true as of the last
   * successful scan, per the requirement that detector failure/timeout/
   * AWS-not-connected must never be interpreted as disappearance. The same
   * holds, within a successful category, for each resource in the
   * observation's unknownResourceIds (listed but not evaluated this scan):
   * its occurrence is not ended and its ACTIVE row is not deleted -- except
   * that an observation with endActiveForUnknown (the low-activity rule) has
   * the ACTIVE rows of its unknown resources removed too; their decisions are
   * still left open.
   *
   * `scope` limits the home-listed issues (HOME_REGION_SCOPED_ISSUES) to the
   * scan's home region; every scan passes it. Without it no region limit
   * applies.
   *
   * `lease` (multi-region plan M4b, F12; required): the scan lease of the scan or
   * Analyze calling it. The transaction starts with the commit fence, so a worker
   * that lost its lease changes nothing.
   *
   * Serialized per-organization via a session-level advisory lock
   * (hashtextextended keyspace, salt distinct from the migration runner's
   * plain-integer lock and from stripe-webhook-ledger.service.ts's salt 0)
   * so a concurrent scan for the same org -- manual analyze racing the
   * 6-hour cron, or two overlapping manual scans -- waits rather than
   * racing. Without this, a delete-then-insert split across two separately
   * committed operations can both duplicate rows and silently drop a
   * just-inserted row from a still-running concurrent scan.
   *
   * `counts` says how every finding of a successful category ended. A finding
   * blocked by open RESOLVED/DISMISSED rows counts once, however many rows block
   * it, under the newest of those decisions.
   *
   * `runId` (PR 3a): the cost_analysis_runs row of this analysis, null when it
   * has none. Every finding a decision still hides that a successful detector
   * detected, or listed but could not evaluate, has that observation recorded
   * under `runId` in cost_finding_detections, in this transaction. "Still
   * detected" is judged from it when read (cost-finding-freshness.ts).
   */
  async reconcileActiveRecommendations(
    organizationId: string,
    observations: DetectorObservation[],
    scope: CostReconcileScope | undefined,
    lease: HeldLease,
    runId: string | null = null
  ): Promise<{ insertedCount: number; counts?: ReconcileCounts }> {
    const successful = observations.filter((o) => o.success);
    if (successful.length === 0) {
      return { insertedCount: 0, counts: { ...EMPTY_RECONCILE_COUNTS } };
    }

    return this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
        [organizationId]
      );

      try {
        await client.query('BEGIN');
        await beginFenced(client, lease);

        let insertedCount = 0;
        const counts: ReconcileCounts = { ...EMPTY_RECONCILE_COUNTS };
        const hiddenObserved: HiddenObservation[] = [];

        for (const observation of successful) {
          const presentResourceIds = observation.recommendations.map((r) => r.resource_id);
          const unknownResourceIds = observation.unknownResourceIds ?? [];
          const regionLimit = regionLimitFor(observation.issue, scope);
          const previouslyActive = await activeResourceIds(client, organizationId, observation.issue);

          // `<> ALL($3)` over an empty array is vacuously true for every row --
          // correctly ends every open occurrence in this category when the
          // detector completed successfully but found nothing at all. A
          // resource it could not evaluate ($4) is not "found nothing".
          await client.query(
            `UPDATE cost_recommendations
             SET occurrence_ended_at = NOW()
             WHERE organization_id = $1
               AND issue = $2
               AND status IN ('RESOLVED', 'DISMISSED')
               AND occurrence_ended_at IS NULL
               AND resource_id <> ALL($3::varchar[])
               AND resource_id <> ALL($4::varchar[])
               AND ($5::varchar IS NULL OR aws_region = $5 OR aws_region IS NULL)`,
            [organizationId, observation.issue, presentResourceIds, unknownResourceIds, regionLimit]
          );

          const openDecisions = await latestOpenDecisions(client, organizationId, observation.issue);
          // Each hidden resource this detector listed but could not evaluate: its own
          // outcome this run is unknown (another resource's result never decides it).
          for (const resourceId of new Set(unknownResourceIds)) {
            if (openDecisions.has(resourceId)) hiddenObserved.push({ outcome: 'unknown', resourceId, issue: observation.issue });
          }

          // A category that asks for it (the low-activity rule, FP2b-Q12) keeps no
          // ACTIVE row for a resource it could not check: the row goes like any
          // other ACTIVE row of this scan. Only ACTIVE rows: the decisions of an
          // unknown resource were left open above and are never touched here.
          const keepActiveFor = observation.endActiveForUnknown ? [] : unknownResourceIds;
          await client.query(
            `DELETE FROM cost_recommendations
             WHERE organization_id = $1 AND status = 'ACTIVE' AND issue = $2
               AND resource_id <> ALL($3::varchar[])
               AND ($4::varchar IS NULL OR aws_region = $4 OR aws_region IS NULL)`,
            [organizationId, observation.issue, keepActiveFor, regionLimit]
          );

          for (const rec of observation.recommendations) {
            // Skip (suppress) if an open RESOLVED/DISMISSED occurrence exists
            // for this exact tuple. ON CONFLICT is defense-in-depth against
            // idx_cost_recommendations_active_identity -- the DELETE above
            // already cleared this category's ACTIVE rows within this same
            // transaction, so a conflict here would only arise from a
            // pre-existing duplicate predating this migration.
            const result = await client.query(
              `INSERT INTO cost_recommendations (
                 organization_id, resource_id, resource_name, resource_type, issue, description,
                 potential_savings, severity, aws_region, metadata, status
               )
               SELECT $1::UUID, $2::VARCHAR, $3::VARCHAR, $4::VARCHAR, $5::VARCHAR, $6::TEXT,
                      $7::NUMERIC, $8::VARCHAR, $9::VARCHAR, $10::JSONB, 'ACTIVE'
               WHERE NOT EXISTS (
                 SELECT 1 FROM cost_recommendations
                 WHERE organization_id = $1::UUID AND resource_id = $2::VARCHAR AND issue = $5::VARCHAR
                   AND status IN ('RESOLVED', 'DISMISSED') AND occurrence_ended_at IS NULL
               )
               ON CONFLICT (organization_id, resource_id, issue) WHERE status = 'ACTIVE' DO NOTHING`,
              [
                organizationId,
                rec.resource_id,
                rec.resource_name,
                rec.resource_type,
                rec.issue,
                rec.description,
                rec.potential_savings,
                rec.severity,
                rec.aws_region,
                JSON.stringify(rec.metadata || {}),
              ]
            );
            const inserted = result.rowCount || 0;
            insertedCount += inserted;
            counts.detected += 1;
            const decision = openDecisions.get(rec.resource_id);
            if (inserted > 0) {
              counts.persisted += 1;
              if (previouslyActive.has(rec.resource_id)) counts.refreshed += 1;
              else counts.new += 1;
            } else if (decision === 'RESOLVED') {
              counts.suppressedResolved += 1;
              hiddenObserved.push({ outcome: 'detected', rec });
            } else if (decision === 'DISMISSED') {
              counts.suppressedDismissed += 1;
              hiddenObserved.push({ outcome: 'detected', rec });
            } else {
              counts.duplicate += 1;
            }
          }
        }

        await recordHiddenObservations(client, organizationId, runId, hiddenObserved);

        await client.query('COMMIT');
        return { insertedCount, counts };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
          [organizationId]
        );
      }
    });
  }

  /**
   * Records a Resolve or Dismiss decision, with its actor. One transaction,
   * serialized with reconciliation (lockReconciliation): the status change and
   * its audit event (cost_recommendation.resolved / .dismissed) commit
   * together, and an audit failure fails the decision (founder decision 3a).
   * Null, with nothing written, when the row isn't this organization's.
   */
  async updateStatus(
    id: string,
    status: 'RESOLVED' | 'DISMISSED',
    organizationId: string,
    actor: CostDecisionActor
  ): Promise<CostRecommendation | null> {
    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');
        await lockReconciliation(client, organizationId);
        const before = await client.query<{ status: RecommendationStatus; issue: string; resource_type: string }>(
          `SELECT status, issue, resource_type FROM cost_recommendations
           WHERE id = $1::UUID AND organization_id = $2 FOR UPDATE`,
          [id, organizationId]
        );
        if (before.rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }

        const query = `
          UPDATE cost_recommendations
          SET status = $1::VARCHAR,
              updated_at = NOW(),
              resolved_at = CASE WHEN $1::VARCHAR = 'RESOLVED' THEN NOW() ELSE resolved_at END
          WHERE id = $2::UUID AND organization_id = $3
          RETURNING *
        `;
        const result = await client.query(query, [status, id, organizationId]);
        const updated: CostRecommendation = result.rows[0];

        await insertAuditEventInTransaction(client, {
          organizationId,
          actorId: actor.userId,
          action: status === 'RESOLVED' ? 'cost_recommendation.resolved' : 'cost_recommendation.dismissed',
          resourceType: 'cost_recommendation',
          resourceId: id,
          changes: { from: before.rows[0].status, to: status },
          metadata: { issue: before.rows[0].issue, resource_type: before.rows[0].resource_type, source: actor.source },
          request: actor.request,
        });

        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Deletes a recommendation, with its actor: the delete and its audit event
   * (cost_recommendation.deleted) commit together, serialized with
   * reconciliation. Deleting a decision row can stop it hiding a finding, so the
   * event records the row's status and whether its occurrence was open.
   */
  async delete(id: string, organizationId: string, actor: CostDecisionActor): Promise<boolean> {
    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');
        await lockReconciliation(client, organizationId);
        const before = await client.query<{
          status: RecommendationStatus; issue: string; resource_type: string; occurrence_ended_at: Date | null;
        }>(
          `SELECT status, issue, resource_type, occurrence_ended_at FROM cost_recommendations
           WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
          [id, organizationId]
        );
        if (before.rows.length === 0) {
          await client.query('ROLLBACK');
          return false;
        }

        await client.query('DELETE FROM cost_recommendations WHERE id = $1 AND organization_id = $2', [id, organizationId]);

        const row = before.rows[0];
        await insertAuditEventInTransaction(client, {
          organizationId,
          actorId: actor.userId,
          action: 'cost_recommendation.deleted',
          resourceType: 'cost_recommendation',
          resourceId: id,
          changes: { from: row.status, to: 'deleted' },
          metadata: {
            issue: row.issue,
            resource_type: row.resource_type,
            source: actor.source,
            occurrence_open: row.status !== 'ACTIVE' && row.occurrence_ended_at === null,
          },
          request: actor.request,
        });

        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Every finding a Resolved or Dismissed decision hides (an open occurrence),
   * one item per (resource, issue) however many rows it has, under its latest
   * decision (newest updated_at, then id: the same order reconciliation counts
   * by). Each carries whether it is still detected, judged from its own latest
   * observation against the latest leased run (cost-finding-freshness.ts).
   * Read-only.
   */
  async getHiddenFindings(organizationId: string): Promise<HiddenFindings> {
    return this.withOrgClient(organizationId, async (client) => {
      const decisions = await client.query<{
        id: string; resource_id: string; issue: string; status: 'RESOLVED' | 'DISMISSED'; updated_at: Date;
        resource_type: string; resource_name: string | null; aws_region: string | null; decision_count: string;
      }>(
        `SELECT DISTINCT ON (cr.resource_id, cr.issue)
                cr.id, cr.resource_id, cr.issue, cr.status, cr.updated_at,
                cr.resource_type, cr.resource_name, cr.aws_region,
                COUNT(*) OVER (PARTITION BY cr.resource_id, cr.issue) AS decision_count
         FROM cost_recommendations cr
         WHERE cr.organization_id = $1
           AND cr.status IN ('RESOLVED', 'DISMISSED') AND cr.occurrence_ended_at IS NULL
           AND cr.issue <> ALL($2::varchar[])
         ORDER BY cr.resource_id, cr.issue, cr.updated_at DESC, cr.id DESC`,
        [organizationId, NEVER_HIDDEN_ISSUES]
      );

      const detections = await client.query<DetectionRow>(
        `SELECT ${DETECTION_COLUMNS} FROM cost_finding_detections WHERE organization_id = $1`,
        [organizationId]
      );
      const detectionOf = new Map(detections.rows.map((row) => [`${row.resource_id}\u0000${row.issue}`, row]));

      const latestRun = await latestLeasedRun(client, organizationId);

      const decisionIds = decisions.rows.map((row) => row.id);
      const actors = decisionIds.length === 0 ? { rows: [] as { resource_id: string; full_name: string | null }[] } : await client.query<{ resource_id: string; full_name: string | null }>(
        `SELECT DISTINCT ON (al.resource_id) al.resource_id, u.full_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.organization_id = $1 AND al.resource_type = 'cost_recommendation'
           AND al.action = ANY($2::varchar[]) AND al.resource_id = ANY($3::uuid[])
         ORDER BY al.resource_id, al.created_at DESC`,
        [organizationId, ['cost_recommendation.resolved', 'cost_recommendation.dismissed'] satisfies AuditEventAction[], decisionIds]
      );
      const actorOf = new Map(actors.rows.map((row) => [row.resource_id, row.full_name]));

      const items: HiddenFinding[] = decisions.rows.map((row) => {
        const detection = detectionOf.get(`${row.resource_id}\u0000${row.issue}`) ?? null;
        const freshness = judgeFreshness({
          issue: row.issue,
          decidedAt: row.updated_at,
          observation: detection,
          latestRun: freshnessRun(latestRun),
        });
        const detected = detection?.detected_at ? detection : null;
        return {
          id: row.id,
          decision: row.status,
          decidedAt: toIso(row.updated_at)!,
          decidedBy: actorOf.get(row.id) ?? null,
          decisionCount: parseInt(row.decision_count, 10),
          issue: row.issue,
          issueLabel: displayIssue(row.issue, detected?.metadata ?? null),
          resourceId: row.resource_id,
          resourceName: row.resource_name,
          resourceType: row.resource_type,
          awsRegion: row.aws_region,
          detection: {
            state: freshness.state,
            reason: freshness.reason,
            lastDetectedAt: detected ? toIso(detected.detected_at) : null,
            potentialSavings: detected ? toNumber(detected.potential_savings) : null,
            savingsBasis: detected?.metadata?.savings_basis ?? null,
            priceSource: typeof detected?.metadata?.price_source === 'string' ? detected.metadata.price_source : null,
            severity: detected?.severity ?? null,
            description: detected?.description ?? null,
          },
        };
      });

      const resolved = items.filter((item) => item.decision === 'RESOLVED');
      const stillDetected = resolved.filter((item) => item.detection.state === 'still_detected');
      // The same aggregation as getStats(), so estimates and ceilings follow one rule.
      const savings = aggregateEstimatedSavings(
        stillDetected.map((item) => {
          const detection = detectionOf.get(`${item.resourceId}\u0000${item.issue}`)!;
          return { resource_type: item.resourceType, potential_savings: detection.potential_savings, metadata: detection.metadata ?? {} };
        })
      );

      return {
        latestRun: latestRun ? { id: latestRun.id, runState: latestRun.run_state, completedAt: toIso(latestRun.completed_at) } : null,
        summary: {
          resolved: resolved.length,
          dismissed: items.length - resolved.length,
          stillDetected: {
            count: stillDetected.length,
            estimatedMonthlySavings: savings.total,
            ceilingMonthlySavings: savings.ceilingTotal,
            ceilingByResourceType: savings.ceilingByResourceType,
          },
          notConfirmed: resolved.length - stillDetected.length,
        },
        items,
      };
    });
  }

  /**
   * Reopens the finding `id` belongs to: ends every open Resolved/Dismissed
   * occurrence of its (resource, issue), and when the finding is still detected
   * puts one ACTIVE row back from its latest detection. Otherwise no row now: the
   * next analysis that detects it inserts it, because nothing hides it any more.
   *
   * One transaction, serialized with reconciliation (lockReconciliation), the
   * audit event (cost_recommendation.reopened) inside it. Exactly once: the
   * occurrence UPDATE only matches open rows, so a second reopen ends nothing,
   * inserts nothing and records nothing; the partial unique index allows one
   * ACTIVE row per finding.
   */
  async reopen(id: string, organizationId: string, actor: CostDecisionActor): Promise<ReopenResult> {
    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');
        await lockReconciliation(client, organizationId);

        const target = await client.query<{ resource_id: string; issue: string; resource_type: string }>(
          `SELECT resource_id, issue, resource_type FROM cost_recommendations
           WHERE id = $1::UUID AND organization_id = $2`,
          [id, organizationId]
        );
        if (target.rows.length === 0) {
          await client.query('ROLLBACK');
          return { outcome: 'not_found' };
        }
        const { resource_id: resourceId, issue } = target.rows[0];
        if (NEVER_HIDDEN_ISSUES.includes(issue)) {
          await client.query('ROLLBACK');
          return { outcome: 'not_applicable' };
        }

        const latestDecision = await client.query<{
          id: string; status: 'RESOLVED' | 'DISMISSED'; updated_at: Date; resource_type: string;
          resource_name: string | null; aws_region: string | null; decision_count: string;
        }>(
          `SELECT id, status, updated_at, resource_type, resource_name, aws_region, COUNT(*) OVER () AS decision_count
           FROM cost_recommendations
           WHERE organization_id = $1 AND resource_id = $2 AND issue = $3
             AND status IN ('RESOLVED', 'DISMISSED') AND occurrence_ended_at IS NULL
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`,
          [organizationId, resourceId, issue]
        );
        if (latestDecision.rows.length === 0) {
          await client.query('ROLLBACK');
          return { outcome: 'already_open' };
        }
        const decision = latestDecision.rows[0];

        const detectionResult = await client.query<DetectionRow>(
          `SELECT ${DETECTION_COLUMNS} FROM cost_finding_detections
           WHERE organization_id = $1 AND resource_id = $2 AND issue = $3`,
          [organizationId, resourceId, issue]
        );
        const detection = detectionResult.rows[0] ?? null;
        const freshness = judgeFreshness({
          issue,
          decidedAt: decision.updated_at,
          observation: detection,
          latestRun: freshnessRun(await latestLeasedRun(client, organizationId)),
        });

        const ended = await client.query(
          `UPDATE cost_recommendations
           SET occurrence_ended_at = NOW()
           WHERE organization_id = $1 AND resource_id = $2 AND issue = $3
             AND status IN ('RESOLVED', 'DISMISSED') AND occurrence_ended_at IS NULL
           RETURNING id`,
          [organizationId, resourceId, issue]
        );
        const rowsEnded = ended.rowCount ?? 0;

        let recommendation: CostRecommendation | null = null;
        if (freshness.state === 'still_detected' && detection && detection.potential_savings !== null && detection.severity !== null) {
          const inserted = await client.query<CostRecommendation>(
            `INSERT INTO cost_recommendations (
               organization_id, resource_id, resource_name, resource_type, issue, description,
               potential_savings, severity, aws_region, metadata, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
             ON CONFLICT (organization_id, resource_id, issue) WHERE status = 'ACTIVE' DO NOTHING
             RETURNING *`,
            [
              organizationId, resourceId, detection.resource_name ?? decision.resource_name,
              detection.resource_type ?? decision.resource_type, issue, detection.description,
              detection.potential_savings, detection.severity, detection.aws_region ?? decision.aws_region,
              JSON.stringify(detection.metadata ?? {}),
            ]
          );
          recommendation = inserted.rows[0] ?? null;
          if (!recommendation) {
            // An ACTIVE row already exists for this finding (the unique index allows one): it is that row.
            const existing = await client.query<CostRecommendation>(
              `SELECT * FROM cost_recommendations
               WHERE organization_id = $1 AND resource_id = $2 AND issue = $3 AND status = 'ACTIVE'`,
              [organizationId, resourceId, issue]
            );
            recommendation = existing.rows[0] ?? null;
          }
        }

        await insertAuditEventInTransaction(client, {
          organizationId,
          actorId: actor.userId,
          action: 'cost_recommendation.reopened',
          resourceType: 'cost_recommendation',
          resourceId: id,
          changes: { from: decision.status, to: recommendation ? 'ACTIVE' : 'reopened_pending' },
          metadata: {
            issue,
            resource_type: decision.resource_type,
            source: actor.source,
            rows_ended: rowsEnded,
            decision_count: parseInt(decision.decision_count, 10),
            detection_state: freshness.state,
          },
          request: actor.request,
        });

        await client.query('COMMIT');
        return { outcome: 'reopened', rowsEnded, activeNow: recommendation !== null, recommendation };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Replaces the scan's ACTIVE Reserved Instance Opportunities with this scan's
   * findings (the RI check must have completed: the caller passes only a complete
   * answer). Re-derived unconditionally every scan, independent of the occurrence
   * lifecycle reconcileActiveRecommendations() applies to the other categories (see
   * the NON_RI_ISSUES comment above).
   *
   * One transaction, under the same per-organization advisory lock as
   * reconcileActiveRecommendations(): the delete and the inserts commit together or
   * not at all, so a failed insert leaves the stored rows exactly as they were. Only
   * the scan's home region (and rows with no region) is replaced: the RI check lists
   * the home region only. The transaction starts with the commit fence for `lease`
   * (multi-region plan M4b, F13; required).
   */
  async replaceReservedInstanceRecommendations(
    organizationId: string,
    scope: CostReconcileScope,
    recommendations: CreateRecommendationRequest[],
    lease: HeldLease
  ): Promise<{ deletedCount: number; insertedCount: number; counts?: ReconcileCounts }> {
    return this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
        [organizationId]
      );

      try {
        await client.query('BEGIN');
        await beginFenced(client, lease);

        const previouslyActive = await activeResourceIds(client, organizationId, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY);

        const deleted = await client.query(
          `DELETE FROM cost_recommendations
           WHERE organization_id = $1 AND status = 'ACTIVE' AND issue = $2
             AND (aws_region = $3 OR aws_region IS NULL)`,
          [organizationId, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, scope.homeRegion]
        );

        let insertedCount = 0;
        const counts: ReconcileCounts = { ...EMPTY_RECONCILE_COUNTS };
        for (const rec of recommendations) {
          const inserted = await insertActiveRecommendation(client, organizationId, rec);
          insertedCount += inserted;
          counts.detected += 1;
          if (inserted > 0) {
            counts.persisted += 1;
            if (previouslyActive.has(rec.resource_id)) counts.refreshed += 1;
            else counts.new += 1;
          } else {
            counts.duplicate += 1;
          }
        }

        await client.query('COMMIT');
        return { deletedCount: deleted.rowCount || 0, insertedCount, counts };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
          [organizationId]
        );
      }
    });
  }

  /**
   * Get recommendation statistics for an organization
   */
  async getStats(organizationId: string): Promise<RecommendationStats> {
    return this.withOrgClient(organizationId, async (client) => {
      const totalQuery = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE organization_id = $1',
        [organizationId]
      );
      const activeQuery = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      // Not a plain SUM(potential_savings): two active recommendations can
      // draw on the same resource's cost -- see estimated-savings.ts.
      const savingsRows = await client.query(
        'SELECT resource_type, potential_savings, metadata FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      const savings = aggregateEstimatedSavings(savingsRows.rows);
      // The weekly email's own count (getActiveSavingsBreakdown), so the Dashboard's
      // "across N open findings" and "K more ... no dollar estimate" match it.
      const findings = countSavingsFindings(savingsRows.rows);

      const severityQuery = await client.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN severity = 'HIGH' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as high,
          COALESCE(SUM(CASE WHEN severity = 'MEDIUM' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as medium,
          COALESCE(SUM(CASE WHEN severity = 'LOW' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as low
        FROM cost_recommendations
        WHERE organization_id = $1
      `,
        [organizationId]
      );

      return {
        total_recommendations: parseInt(totalQuery.rows[0].count),
        active_recommendations: parseInt(activeQuery.rows[0].count),
        total_potential_savings: savings.total,
        potential_savings_by_resource_type: savings.byResourceType,
        potential_savings_ceiling: savings.ceilingTotal,
        potential_savings_ceiling_by_resource_type: savings.ceilingByResourceType,
        estimated_findings: findings.estimatedFindings,
        unestimated_findings: findings.unestimatedFindings,
        by_severity: {
          high: parseInt(severityQuery.rows[0].high),
          medium: parseInt(severityQuery.rows[0].medium),
          low: parseInt(severityQuery.rows[0].low),
        },
      };
    });
  }

  /**
   * The open (ACTIVE) findings split by what their dollar figure is, for the
   * weekly summary: the de-duplicated estimate total (same rule as getStats),
   * how many findings carry an estimate, the upper bounds by resource type,
   * and how many carry neither -- so "no figure" is never shown as $0.
   */
  async getActiveSavingsBreakdown(organizationId: string): Promise<ActiveSavingsBreakdown> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        'SELECT resource_type, potential_savings, metadata FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      const savings = aggregateEstimatedSavings(rows);
      // The same count getStats() returns to the Dashboard (countSavingsFindings).
      const { estimatedFindings, unestimatedFindings } = countSavingsFindings(rows);
      return {
        active: rows.length,
        estimatedMonthlySavings: savings.total,
        estimatedFindings,
        ceilingByResourceType: savings.ceilingByResourceType,
        unestimatedFindings,
      };
    });
  }

  /**
   * Get count of active recommendations for an organization
   */
  async getActiveCount(organizationId: string): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      return parseInt(result.rows[0].count);
    });
  }
}
