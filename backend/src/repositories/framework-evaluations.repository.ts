/**
 * Storage for compliance-framework evaluations:
 *
 *   framework_evaluation_runs             history, one row per organization x framework x scan
 *   compliance_check_evaluations          current outcome of each check for each resource
 *   framework_evaluation_reconciliations  resources whose last evaluation could not be stored
 *
 * and the one place aws_resources.compliance_issues is written from them.
 *
 * TENANT ISOLATION is enforced twice, independently: every statement carries an
 * explicit organization predicate, and the tables force row-level security, so
 * the caller's connection must carry app.current_organization_id. Every function
 * takes the caller's executor; none opens a connection of its own.
 *
 * ORDERING -- the generation rule. Each run gets a generation from the database
 * (an identity column), and each check row records the generation that wrote
 * it. Three rules follow, and every reader and writer here uses them and no
 * timestamp:
 *
 *   1. WRITE. A check row is overwritten only by an equal or higher generation
 *      (`WHERE stored.run_generation <= incoming`). An older run that is still
 *      going can fill in rows a newer run did not write, and can never replace
 *      one the newer run did.
 *   2. CURRENT RUN. The latest FINISHED run of a framework is the highest
 *      generation whose status is 'complete' or 'partial'. A 'failed' or still
 *      'running' run is never it, whatever its generation.
 *   3. STALE. A check row is stale exactly when its generation is lower than
 *      the current run's (or when the framework has no finished run at all).
 *      Nothing is stored for this: STALE_SQL below derives it on every read.
 *
 * How a resource's outcome in a run maps onto rule 3:
 *
 *   resource's transaction   run counts it as   its check rows afterwards
 *   ----------------------   ----------------   ------------------------------------
 *   committed                persisted          this run's generation -> current
 *   rolled back (any error)  failed             previous generation   -> stale once
 *   lock timeout             failed               this run finishes ('partial')
 *   resource gone            (not counted)      removed by the foreign key
 *   never had a row          --                 no row: reported as not_evaluated,
 *                                               never as a stale stored result
 *
 * So a run is 'partial' exactly when at least one resource's rows were left at
 * an older generation by it, and those are exactly the rows rule 3 reports as
 * stale. The two cannot disagree: both come from the same generation.
 */
import { PoolClient } from 'pg';
import {
  ComplianceIssue,
  ComplianceIssueProvenance,
  ComplianceSeverity,
  FindingEvaluationState,
  FrameworkApplicabilityState,
  FrameworkCheckEvaluation,
} from '../types/aws-resources.types';

/** A run that has not reported progress for this long is treated as dead. */
export const ABANDONED_RUN_AFTER_MINUTES = 15;
/** Run history older than this is pruned. Current check state is never pruned. */
export const RUN_RETENTION_DAYS = 90;
/** A framework whose latest finished run is older than this is reported as stale (twice the 6-hour scan schedule). */
export const FRAMEWORK_STALE_AFTER_HOURS = 12;

const SOURCE_KIND = 'framework';

/** A connection the caller has already tagged with the organization. */
type Executor = Pick<PoolClient, 'query'>;

/**
 * The stale rule (rule 3 above), as SQL. `$1` is the organization. Yields, per
 * framework, the generation of its latest finished run; a check row is stale
 * when `latest.generation IS NULL OR row.run_generation < latest.generation`.
 * The generation itself never leaves the database.
 */
export const LATEST_FINISHED_RUNS_SQL = `
  SELECT framework, MAX(generation) AS generation
    FROM framework_evaluation_runs
   WHERE organization_id = $1
     AND status IN ('complete', 'partial')
   GROUP BY framework`;

export const STALE_SQL = `(latest.generation IS NULL OR c.run_generation < latest.generation)`;

export interface FrameworkRun {
  id: string;
  /** Opaque: only ever passed back to this repository. A string because it is a 64-bit value. */
  generation: string;
  framework: string;
  applicability: FrameworkApplicabilityState;
  reasonCode: string;
}

export interface StartRunInput {
  organizationId: string;
  framework: string;
  applicability: FrameworkApplicabilityState;
  reasonCode: string;
  discoveryJobId: string | null;
  evaluatorVersion: string;
}

/** One framework's part of a resource's evaluation, as it is to be stored. */
export interface FrameworkResourceEvaluation {
  run: FrameworkRun;
  /** This run's outcome for each check that applies to the resource. Empty unless the framework is enabled. */
  evaluations: FrameworkCheckEvaluation[];
  /** Every check key the framework currently has, applicable to this resource or not. */
  registeredCheckKeys: string[];
}

export interface StoredFailure {
  framework: string;
  check: string;
  severity: ComplianceSeverity;
  evidence_basis: string;
  reason_code: string;
}

export interface PersistResourceInput {
  organizationId: string;
  resourceId: string;
  evaluatorVersion: string;
  /** Baseline findings from this scan; written as they are. */
  baselineIssues: ComplianceIssue[];
  frameworks: FrameworkResourceEvaluation[];
  /** Turns the resource's stored failures into findings. Called inside the transaction. */
  project: (failures: StoredFailure[]) => ComplianceIssue[];
}

export type PersistResourceResult =
  | { outcome: 'persisted'; frameworkIssues: ComplianceIssue[] }
  | { outcome: 'resource_missing' }
  | { outcome: 'failed'; failureCode: 'lock_timeout' | 'persist_error' };

/**
 * The connection could not be returned to a usable state after a failed
 * transaction. Nothing more can safely be run on it.
 */
export class EvaluationConnectionUnusableError extends Error {
  constructor() {
    super('Database connection is unusable after a failed framework evaluation transaction');
    this.name = 'EvaluationConnectionUnusableError';
  }
}

const TABLES = ['framework_evaluation_runs', 'compliance_check_evaluations', 'framework_evaluation_reconciliations'];

/**
 * Whether the evaluation tables exist. A lookup, not an attempt: it cannot fail
 * a transaction the caller has open. False means the administrative migration
 * has not been applied to this database (or has been rolled back).
 */
export async function frameworkEvaluationStorageAvailable(executor: Executor): Promise<boolean> {
  // No parameters and no tenant data: a catalog lookup of three fixed names.
  const { rows } = await executor.query(
    `SELECT ${TABLES.map((name) => `to_regclass('${name}') IS NOT NULL`).join(' AND ')} AS available`
  );
  return rows[0]?.available === true;
}

/**
 * Starts a run. Before inserting it:
 *   - closes this framework's runs that stopped reporting progress as
 *     failed/abandoned (rule 2: they are then never the current run);
 *   - prunes this framework's finished history older than the retention window,
 *     always keeping the latest finished run. Check rows hold no key to a run,
 *     so pruning cannot touch them.
 */
export async function startFrameworkRun(executor: Executor, input: StartRunInput): Promise<FrameworkRun> {
  await executor.query(
    `UPDATE framework_evaluation_runs
        SET status = 'failed', failure_code = 'abandoned', finished_at = clock_timestamp()
      WHERE organization_id = $1
        AND framework = $2
        AND status = 'running'
        AND heartbeat_at < clock_timestamp() - make_interval(mins => $3)`,
    [input.organizationId, input.framework, ABANDONED_RUN_AFTER_MINUTES]
  );

  await executor.query(
    `DELETE FROM framework_evaluation_runs r
      WHERE r.organization_id = $1
        AND r.framework = $2
        AND r.status <> 'running'
        AND r.started_at < clock_timestamp() - make_interval(days => $3)
        AND r.generation IS DISTINCT FROM (
              SELECT MAX(l.generation)
                FROM framework_evaluation_runs l
               WHERE l.organization_id = $1
                 AND l.framework = $2
                 AND l.status IN ('complete', 'partial'))`,
    [input.organizationId, input.framework, RUN_RETENTION_DAYS]
  );

  // The job id is taken through a subquery that also matches the organization,
  // so a job that is not this organization's is recorded as NULL.
  const { rows } = await executor.query(
    `INSERT INTO framework_evaluation_runs
       (organization_id, framework, applicability, applicability_reason_code, discovery_job_id, evaluator_version)
     VALUES ($1, $2, $3, $4,
             (SELECT j.id FROM resource_discovery_jobs j WHERE j.id = $5 AND j.organization_id = $1),
             $6)
     RETURNING id, generation::text AS generation`,
    [input.organizationId, input.framework, input.applicability, input.reasonCode, input.discoveryJobId, input.evaluatorVersion]
  );
  return {
    id: rows[0].id,
    generation: rows[0].generation,
    framework: input.framework,
    applicability: input.applicability,
    reasonCode: input.reasonCode,
  };
}

export async function heartbeatFrameworkRun(executor: Executor, organizationId: string, runId: string): Promise<void> {
  await executor.query(
    `UPDATE framework_evaluation_runs SET heartbeat_at = clock_timestamp()
      WHERE id = $1 AND organization_id = $2 AND status = 'running'`,
    [runId, organizationId]
  );
}

/**
 * Finishes a run: 'complete' when every resource's evaluation was stored,
 * 'partial' when at least one was not. Returns false when the run was no longer
 * 'running' (it had been closed as abandoned); its rows stay valid either way.
 */
export async function finishFrameworkRun(
  executor: Executor,
  organizationId: string,
  runId: string,
  totals: { inScope: number; persisted: number; failed: number; stateCounts: Record<string, number> }
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE framework_evaluation_runs
        SET status = CASE WHEN $5::int = 0 THEN 'complete' ELSE 'partial' END,
            finished_at = clock_timestamp(),
            heartbeat_at = clock_timestamp(),
            resources_in_scope = $3,
            resources_persisted = $4,
            resources_failed = $5,
            state_counts = $6
      WHERE id = $1 AND organization_id = $2 AND status = 'running'`,
    [runId, organizationId, totals.inScope, totals.persisted, totals.failed, JSON.stringify(totals.stateCounts)]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Closes a run that could not finish. A failed run is never the current run (rule 2). */
export async function failFrameworkRun(
  executor: Executor,
  organizationId: string,
  runId: string,
  failureCode: 'persist_error' | 'unexpected'
): Promise<void> {
  await executor.query(
    `UPDATE framework_evaluation_runs
        SET status = 'failed', failure_code = $3, finished_at = clock_timestamp()
      WHERE id = $1 AND organization_id = $2 AND status = 'running'`,
    [runId, organizationId, failureCode]
  );
}

const UPSERT_CHECK_SQL = `
  INSERT INTO compliance_check_evaluations AS c
    (organization_id, resource_id, source_kind, source_key, check_key,
     evaluation_state, severity, evidence_basis, provenance, reason_code, error_code, evidence,
     evaluated_at, run_generation, evaluator_version,
     last_conclusive_state, last_conclusive_at, last_conclusive_severity)
  VALUES ($1, $2, $3, $4, $5,
          $6::text, $7::text, $8, $9, $10, $11, NULL,
          clock_timestamp(), $12::bigint, $13,
          CASE WHEN $6::text IN ('failed', 'passed') THEN $6::text END,
          CASE WHEN $6::text IN ('failed', 'passed') THEN clock_timestamp() END,
          CASE WHEN $6::text = 'failed' THEN $7::text END)
  ON CONFLICT (organization_id, resource_id, source_kind, source_key, check_key) DO UPDATE SET
     evaluation_state = EXCLUDED.evaluation_state,
     severity = EXCLUDED.severity,
     evidence_basis = EXCLUDED.evidence_basis,
     provenance = EXCLUDED.provenance,
     reason_code = EXCLUDED.reason_code,
     error_code = EXCLUDED.error_code,
     evidence = EXCLUDED.evidence,
     evaluated_at = EXCLUDED.evaluated_at,
     run_generation = EXCLUDED.run_generation,
     evaluator_version = EXCLUDED.evaluator_version,
     -- The last real pass or fail survives every outcome that is not one.
     last_conclusive_state = COALESCE(EXCLUDED.last_conclusive_state, c.last_conclusive_state),
     last_conclusive_at = CASE WHEN EXCLUDED.last_conclusive_state IS NOT NULL
                               THEN EXCLUDED.last_conclusive_at ELSE c.last_conclusive_at END,
     last_conclusive_severity = CASE WHEN EXCLUDED.last_conclusive_state IS NOT NULL
                                     THEN EXCLUDED.last_conclusive_severity ELSE c.last_conclusive_severity END
   -- Rule 1: never overwrite a row a newer run wrote.
   WHERE c.run_generation <= EXCLUDED.run_generation`;

/**
 * Rows of this framework that this run did not produce an outcome for: the
 * check no longer applies to the resource, or is no longer part of the
 * framework. They move to 'not_applicable' (the row is kept, with its last
 * conclusive result) rather than being deleted, so "stopped applying" stays
 * distinguishable from "never evaluated" (no row).
 */
const MARK_NOT_APPLICABLE_SQL = `
  UPDATE compliance_check_evaluations c
     SET evaluation_state = 'not_applicable', severity = NULL, error_code = NULL, evidence = NULL,
         evidence_basis = 'none', provenance = NULL,
         reason_code = CASE WHEN c.check_key = ANY($6::text[]) THEN 'check_not_applicable_to_resource' ELSE 'check_retired' END,
         evaluated_at = clock_timestamp(), run_generation = $7::bigint, evaluator_version = $8
   WHERE c.organization_id = $1 AND c.resource_id = $2 AND c.source_kind = $3 AND c.source_key = $4
     AND NOT (c.check_key = ANY($5::text[]))
     AND c.run_generation <= $7::bigint`;

/**
 * A framework that is not enabled is not evaluated: its existing rows move to
 * 'not_evaluated' with the applicability's reason (the last conclusive result is
 * kept). No row is created for a resource that never had one.
 */
const MARK_NOT_EVALUATED_SQL = `
  UPDATE compliance_check_evaluations c
     SET evaluation_state = 'not_evaluated', severity = NULL, error_code = NULL, evidence = NULL,
         evidence_basis = 'none', provenance = NULL, reason_code = $5,
         evaluated_at = clock_timestamp(), run_generation = $6::bigint, evaluator_version = $7
   WHERE c.organization_id = $1 AND c.resource_id = $2 AND c.source_kind = $3 AND c.source_key = $4
     AND c.run_generation <= $6::bigint`;

/**
 * Stores one resource's evaluation and rewrites its findings from what is then
 * stored, in ONE transaction on the caller's connection:
 *
 *   1. lock the resource row (serialises overlapping scans per resource);
 *   2. write this run's check outcomes, under rule 1;
 *   3. read the resource's stored 'failed' rows -- whichever run wrote them;
 *   4. write compliance_issues = this scan's baseline findings + those failures;
 *   5. clear the resource's reconciliation marker.
 *
 * Step 4 is built from step 3, not from this run's own outcomes, so after a
 * commit the framework entries in compliance_issues are exactly the stored
 * failures -- including when rule 1 rejected this run's writes. On any error the
 * whole transaction is rolled back: neither the check rows nor compliance_issues
 * change, and the caller is told so (`failed`); nothing here claims otherwise.
 *
 * The caller must make no other query on this connection while this runs.
 */
export async function persistResourceEvaluation(
  client: Executor,
  input: PersistResourceInput
): Promise<PersistResourceResult> {
  await client.query('BEGIN');
  try {
    // A concurrent scan holding this resource is writing it right now; do not queue behind it.
    await client.query(`SET LOCAL lock_timeout = '5s'`);

    const locked = await client.query(
      `SELECT 1 FROM aws_resources WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [input.resourceId, input.organizationId]
    );
    if ((locked.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { outcome: 'resource_missing' };
    }

    for (const framework of input.frameworks) {
      const { run } = framework;
      const key = [input.organizationId, input.resourceId, SOURCE_KIND, run.framework];

      if (run.applicability !== 'enabled') {
        await client.query(MARK_NOT_EVALUATED_SQL, [...key, run.reasonCode, run.generation, input.evaluatorVersion]);
        continue;
      }

      const produced: string[] = [];
      for (const evaluation of framework.evaluations) {
        if (evaluation.check === null) continue;
        produced.push(evaluation.check);
        await client.query(UPSERT_CHECK_SQL, [
          ...key,
          evaluation.check,
          evaluation.evaluation_state,
          evaluation.severity,
          evaluation.evidence_basis,
          evaluation.provenance,
          evaluation.reason_code,
          evaluation.error_code,
          run.generation,
          input.evaluatorVersion,
        ]);
      }
      await client.query(MARK_NOT_APPLICABLE_SQL, [
        ...key,
        produced,
        framework.registeredCheckKeys,
        run.generation,
        input.evaluatorVersion,
      ]);
    }

    const stored = await client.query(
      `SELECT source_key AS framework, check_key AS "check", severity, evidence_basis, reason_code
         FROM compliance_check_evaluations
        WHERE organization_id = $1 AND resource_id = $2 AND source_kind = $3 AND evaluation_state = 'failed'
        ORDER BY source_key ASC, check_key ASC`,
      [input.organizationId, input.resourceId, SOURCE_KIND]
    );
    const frameworkIssues = input.project(stored.rows as StoredFailure[]);

    await client.query(
      `UPDATE aws_resources SET compliance_issues = $1 WHERE id = $2 AND organization_id = $3`,
      [JSON.stringify([...input.baselineIssues, ...frameworkIssues]), input.resourceId, input.organizationId]
    );
    await client.query(
      `DELETE FROM framework_evaluation_reconciliations WHERE organization_id = $1 AND resource_id = $2`,
      [input.organizationId, input.resourceId]
    );

    await client.query('COMMIT');
    return { outcome: 'persisted', frameworkIssues };
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      throw new EvaluationConnectionUnusableError();
    }
    // 55P03 = lock_not_available. Only the category is returned and stored; the
    // database's message goes to the log and nowhere else.
    const failureCode = error?.code === '55P03' ? 'lock_timeout' : 'persist_error';
    console.error(`[FrameworkEvaluations] resource evaluation transaction rolled back (${failureCode}):`, error?.message);
    return { outcome: 'failed', failureCode };
  }
}

/**
 * Records that a resource's evaluation could not be stored. Written after the
 * failed transaction has rolled back, as its own statement, and removed by the
 * resource's next successful transaction. It counts attempts, so a resource
 * that fails on every scan is visible as such instead of failing silently.
 */
export async function recordReconciliationRequired(
  executor: Executor,
  input: { organizationId: string; resourceId: string; failureCode: string; generation: string }
): Promise<void> {
  await executor.query(
    `INSERT INTO framework_evaluation_reconciliations AS r
       (organization_id, resource_id, failure_code, last_run_generation)
     VALUES ($1, $2, $3, $4::bigint)
     ON CONFLICT (organization_id, resource_id) DO UPDATE SET
       last_failed_at = clock_timestamp(),
       failure_count = r.failure_count + 1,
       failure_code = EXCLUDED.failure_code,
       last_run_generation = GREATEST(r.last_run_generation, EXCLUDED.last_run_generation)`,
    [input.organizationId, input.resourceId, input.failureCode, input.generation]
  );
}

/**
 * Writes a resource's baseline findings while leaving its framework entries
 * exactly as they are. Used when the framework evaluation could not be stored
 * (or there is nowhere to store it): the baseline is still this scan's, and the
 * framework entries are still what was last stored -- not re-verified, and
 * reported as such by the reader, never silently dropped and never refreshed.
 *
 * A framework entry is an array element that is an object with a `framework`
 * key. Everything else in the old array is replaced by the new baseline.
 */
export async function writeBaselinePreservingFrameworkFindings(
  executor: Executor,
  input: { organizationId: string; resourceId: string; baselineIssues: ComplianceIssue[] }
): Promise<void> {
  await executor.query(
    `UPDATE aws_resources r
        SET compliance_issues = $1::jsonb || COALESCE((
              SELECT jsonb_agg(e.value ORDER BY e.ordinality)
                FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(r.compliance_issues) = 'array' THEN r.compliance_issues ELSE '[]'::jsonb END
                     ) WITH ORDINALITY AS e(value, ordinality)
               WHERE jsonb_typeof(e.value) = 'object' AND e.value ? 'framework'
            ), '[]'::jsonb)
      WHERE r.id = $2 AND r.organization_id = $3`,
    [JSON.stringify(input.baselineIssues), input.resourceId, input.organizationId]
  );
}

// ─── Read model ─────────────────────────────────────────────────────────────

export interface FrameworkRunSummaryRow {
  framework: string;
  applicability: FrameworkApplicabilityState;
  applicability_reason_code: string;
  status: 'complete' | 'partial';
  started_at: Date;
  finished_at: Date;
  evaluator_version: string;
  /** The latest finished run is older than FRAMEWORK_STALE_AFTER_HOURS. */
  aged: boolean;
}

export interface FrameworkRunActivityRow {
  framework: string;
  /** A run is in progress and still reporting. */
  running: boolean;
  /** The most recent attempt after the latest finished run failed (or was abandoned). */
  last_attempt_failed: boolean;
}

export interface CheckEvaluationRow {
  resource_id: string;
  framework: string;
  check: string;
  evaluation_state: FindingEvaluationState;
  severity: ComplianceSeverity | null;
  evidence_basis: string;
  provenance: ComplianceIssueProvenance | null;
  reason_code: string;
  error_code: string | null;
  evaluated_at: Date;
  last_conclusive_state: 'failed' | 'passed' | null;
  last_conclusive_at: Date | null;
  last_conclusive_severity: ComplianceSeverity | null;
  /** Rule 3. */
  stale: boolean;
}

export interface ReconciliationRow {
  resource_id: string;
  first_failed_at: Date;
  last_failed_at: Date;
  failure_count: number;
  failure_code: string;
}

export interface FrameworkEvaluationRows {
  latestRuns: FrameworkRunSummaryRow[];
  activity: FrameworkRunActivityRow[];
  checks: CheckEvaluationRow[];
  reconciliations: ReconciliationRow[];
}

/**
 * Everything a reader needs, for one organization. No generation is selected:
 * the comparison happens in SQL and only its result (`stale`) is returned.
 * Every statement takes the organization as its only parameter.
 */
export async function readFrameworkEvaluations(executor: Executor, organizationId: string): Promise<FrameworkEvaluationRows> {
  const latestRuns = await executor.query<FrameworkRunSummaryRow>(
    `WITH latest AS (${LATEST_FINISHED_RUNS_SQL})
     SELECT r.framework, r.applicability, r.applicability_reason_code, r.status,
            r.started_at, r.finished_at, r.evaluator_version,
            r.finished_at < clock_timestamp() - make_interval(hours => ${FRAMEWORK_STALE_AFTER_HOURS}) AS aged
       FROM framework_evaluation_runs r
       JOIN latest ON latest.framework = r.framework AND latest.generation = r.generation
      WHERE r.organization_id = $1
      ORDER BY r.framework ASC`,
    [organizationId]
  );

  const activity = await executor.query<FrameworkRunActivityRow>(
    `WITH newest AS (
            SELECT DISTINCT ON (r.framework) r.framework, r.status, r.generation
              FROM framework_evaluation_runs r
             WHERE r.organization_id = $1 AND r.status <> 'running'
             ORDER BY r.framework, r.generation DESC)
     SELECT f.framework,
            EXISTS (SELECT 1 FROM framework_evaluation_runs a
                     WHERE a.organization_id = $1 AND a.framework = f.framework AND a.status = 'running'
                       AND a.heartbeat_at >= clock_timestamp() - make_interval(mins => ${ABANDONED_RUN_AFTER_MINUTES})) AS running,
            COALESCE((SELECT n.status = 'failed' FROM newest n WHERE n.framework = f.framework), false) AS last_attempt_failed
       FROM (SELECT DISTINCT framework FROM framework_evaluation_runs WHERE organization_id = $1) f
      ORDER BY f.framework ASC`,
    [organizationId]
  );

  const checks = await executor.query<CheckEvaluationRow>(
    `WITH latest AS (${LATEST_FINISHED_RUNS_SQL})
     SELECT c.resource_id, c.source_key AS framework, c.check_key AS "check",
            c.evaluation_state, c.severity, c.evidence_basis, c.provenance, c.reason_code, c.error_code,
            c.evaluated_at, c.last_conclusive_state, c.last_conclusive_at, c.last_conclusive_severity,
            ${STALE_SQL} AS stale
       FROM compliance_check_evaluations c
       LEFT JOIN latest ON latest.framework = c.source_key
      WHERE c.organization_id = $1 AND c.source_kind = '${SOURCE_KIND}'
      ORDER BY c.resource_id ASC, c.source_key ASC, c.check_key ASC`,
    [organizationId]
  );

  const reconciliations = await executor.query<ReconciliationRow>(
    `SELECT resource_id, first_failed_at, last_failed_at, failure_count, failure_code
       FROM framework_evaluation_reconciliations
      WHERE organization_id = $1
      ORDER BY resource_id ASC`,
    [organizationId]
  );

  return {
    latestRuns: latestRuns.rows,
    activity: activity.rows,
    checks: checks.rows,
    reconciliations: reconciliations.rows,
  };
}
