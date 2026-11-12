import { PoolClient } from 'pg';
import { pool } from '../config/database';
import type { CostAnalysisCheck, DetectorSummary, ReconcileCounts } from '../services/cost-analysis-outcome';
import { SCAN_KIND_DISCOVERY, SCAN_WAIT_CAP_MS } from '../services/scan-session';
import { HeldLease, withFencedTransaction } from '../services/scan-lease';
import { withConnectionFenceOn } from '../services/aws-connection-fence';

/**
 * What a run row's creation is fenced with (AWS connect PR C): the scan lease of
 * the worker creating it, or, before any lease is held (Analyze), the identity
 * of the connection the run belongs to. A worker whose lease is lost, or whose
 * connection is no longer the organization's active one, creates no row.
 */
export type RunCreationFence = { lease: HeldLease } | { connection: string };

export type CostAnalysisRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'interrupted';
export type CostAnalysisRunSource = 'manual' | 'discovery';

export interface CostAnalysisRun {
  id: string;
  organization_id: string;
  status: CostAnalysisRunStatus;
  recommendations_found: number | null;
  total_potential_savings: string | null; // NUMERIC comes back from pg as a string
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  source: CostAnalysisRunSource;
  discovery_job_id: string | null;
  // Counts: null means not recorded, never 0.
  detected_count: number | null;
  new_count: number | null;
  refreshed_count: number | null;
  suppressed_resolved_count: number | null;
  suppressed_dismissed_count: number | null;
  duplicate_count: number | null;
  persisted_count: number | null;
  failed_detector_count: number | null;
  unknown_resource_count: number | null;
  checks: CostAnalysisCheck[] | null;
  lease_acquired_at: string | null;
  /** status as a reader should see it: a dead worker's 'running' row reads 'interrupted'. */
  run_state: CostAnalysisRunStatus;
}

/** What a finished run records about its detectors and findings. */
export interface CostAnalysisRunDetail {
  summary: DetectorSummary;
  /** Null when the counts are not known. */
  counts: ReconcileCounts | null;
}

/**
 * How long a run may sit 'running' with no lease before it is taken as gone:
 * longer than the longest wait for the lease. Covers rows that never took one.
 */
export const QUEUED_RUN_TIMEOUT_SECONDS = SCAN_WAIT_CAP_MS / 1000 + 5 * 60;

/**
 * Persistence for every cost analysis: manual (POST
 * /api/cost-recommendations/analyze) and the cost step of a discovery scan.
 *
 * Owned by postgres with row-level security forced since admin migration
 * 202611101200_transfer_tenant_table_ownership.sql, so every statement runs on
 * a connection tagged for its organization. EVERY statement here also carries
 * an explicit organization_id predicate (or column, for the INSERT) as defence
 * in depth; a static test (cost-analysis-runs.tenant-scope.test.ts) holds
 * every statement to that.
 *
 * A finishing write only moves a row out of 'running', so a slow worker never
 * overwrites a row recovery has already closed.
 */
export class CostAnalysisRunsRepository {
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
   * Creates a 'running' row, unfenced. For test fixtures only: production code
   * creates run rows with createFenced() (AWS connect PR C), and a static test
   * pins that no production file calls this.
   */
  async create(
    organizationId: string,
    options: { source?: CostAnalysisRunSource; discoveryJobId?: string; leaseAcquiredAt?: Date } = {}
  ): Promise<CostAnalysisRun> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO cost_analysis_runs (organization_id, status, started_at, source, discovery_job_id, lease_acquired_at)
         VALUES ($1, 'running', NOW(), $2, $3, $4)
         RETURNING *`,
        [organizationId, options.source ?? 'manual', options.discoveryJobId ?? null, options.leaseAcquiredAt ?? null]
      );
      return result.rows[0];
    });
  }

  /** The run now holds the scan lease: from here on recovery can tell whether its worker is gone. */
  /**
   * create(), inside ONE transaction that starts with `fence` (the scan lease's
   * fence, or the connection fence): every production caller uses this, so a
   * stale worker never creates a run row. create() itself stays for test fixtures
   * only (a static test pins that no production file calls it).
   */
  async createFenced(
    organizationId: string,
    options: { source?: CostAnalysisRunSource; discoveryJobId?: string; leaseAcquiredAt?: Date },
    fence: RunCreationFence
  ): Promise<CostAnalysisRun> {
    return this.withOrgClient(organizationId, async (client) => {
      const insert = async (): Promise<CostAnalysisRun> => {
        const result = await client.query(
          `INSERT INTO cost_analysis_runs (organization_id, status, started_at, source, discovery_job_id, lease_acquired_at)
           VALUES ($1, 'running', NOW(), $2, $3, $4)
           RETURNING *`,
          [organizationId, options.source ?? 'manual', options.discoveryJobId ?? null, options.leaseAcquiredAt ?? null]
        );
        return result.rows[0];
      };
      return 'lease' in fence
        ? withFencedTransaction(client, fence.lease, insert)
        : withConnectionFenceOn(client, organizationId, fence.connection, insert);
    });
  }

  async markLeaseAcquired(id: string, organizationId: string, leaseAcquiredAt: Date): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `UPDATE cost_analysis_runs SET lease_acquired_at = $1
         WHERE id = $2 AND organization_id = $3 AND status = 'running'`,
        [leaseAcquiredAt, id, organizationId]
      );
    });
  }

  /**
   * Records a run that reached its end: 'completed' or 'partial', never
   * speculatively, and never when no detector completed (see markFailed).
   *
   * Fenced with the run's scan lease (AWS connect PR B): a worker whose lease or
   * AWS connection is no longer current gets LeaseLostError and records nothing
   * here; its caller closes its own row with markInterrupted instead.
   */
  async markFinished(
    id: string,
    organizationId: string,
    data: { recommendationsFound: number; totalPotentialSavings: number } & CostAnalysisRunDetail,
    lease: HeldLease
  ): Promise<void> {
    if (data.summary.state === 'failed') {
      throw new Error('A run in which no detector completed cannot be marked finished');
    }
    await this.withOrgClient(organizationId, async (client) => {
      await withFencedTransaction(client, lease, async () => {
        await client.query(
          `UPDATE cost_analysis_runs
           SET status = $1, completed_at = NOW(),
               recommendations_found = $2, total_potential_savings = $3, ${detailAssignments(6)}
           WHERE id = $4 AND organization_id = $5 AND status = 'running'`,
          [data.summary.state, data.recommendationsFound, data.totalPotentialSavings, id, organizationId, ...detailValues(data)]
        );
      });
    });
  }

  /**
   * Marks a run failed, storing the full real error for server-side
   * diagnostics. GET /api/cost-recommendations/analysis-runs deliberately
   * does not return this column verbatim to the frontend. `detail` is given
   * when detectors ran and none completed: its counts stay NULL, because a run
   * that evaluated nothing has no counts, and 0 would read as "nothing detected".
   */
  async markFailed(
    id: string,
    organizationId: string,
    errorMessage: string,
    detail?: Pick<CostAnalysisRunDetail, 'summary'>
  ): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      if (detail) {
        await client.query(
          `UPDATE cost_analysis_runs
           SET status = 'failed', completed_at = NOW(), error_message = $1, ${detailAssignments(4)}
           WHERE id = $2 AND organization_id = $3 AND status = 'running'`,
          [errorMessage, id, organizationId, ...detailValues({ summary: detail.summary, counts: null })]
        );
        return;
      }
      await client.query(
        `UPDATE cost_analysis_runs
         SET status = 'failed', completed_at = NOW(), error_message = $1
         WHERE id = $2 AND organization_id = $3 AND status = 'running'`,
        [errorMessage, id, organizationId]
      );
    });
  }

  /** The worker lost its lease: it wrote nothing more, and the run did not finish. */
  async markInterrupted(id: string, organizationId: string): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `UPDATE cost_analysis_runs SET status = 'interrupted', completed_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'running'`,
        [id, organizationId]
      );
    });
  }

  /**
   * Closes the organization's runs whose worker is gone. Called by a worker that
   * has just ACQUIRED the scan lease: a row that took a lease earlier cannot be
   * alive, because that lease had to end for this one to exist. A row with no
   * lease may simply be queued, so only age closes it. Never closes a row on age
   * alone while it holds a lease.
   */
  async recoverInterrupted(organizationId: string, leaseAcquiredAt: Date): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE cost_analysis_runs SET status = 'interrupted', completed_at = NOW()
         WHERE organization_id = $1 AND status = 'running'
           AND ((lease_acquired_at IS NOT NULL AND lease_acquired_at < $2)
             OR (lease_acquired_at IS NULL AND created_at < NOW() - make_interval(secs => $3)))`,
        [organizationId, leaseAcquiredAt, QUEUED_RUN_TIMEOUT_SECONDS]
      );
      return result.rowCount ?? 0;
    });
  }

  /**
   * Most recent runs, latest first, all sources when `source` is null.
   * run_state is computed on every read, so a dead worker's row stops reading as
   * running without waiting for the next scan: a run that took a lease is
   * interrupted once no lease is held, and one that never did once it is older
   * than QUEUED_RUN_TIMEOUT_SECONDS. Nothing is written.
   */
  async getLatest(
    organizationId: string,
    limit: number = 5,
    source: CostAnalysisRunSource | null = null
  ): Promise<CostAnalysisRun[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT r.*,
                CASE
                  WHEN r.status <> 'running' THEN r.status
                  WHEN r.lease_acquired_at IS NULL
                    THEN CASE WHEN r.created_at < NOW() - make_interval(secs => $4) THEN 'interrupted' ELSE 'running' END
                  WHEN EXISTS (
                    SELECT 1 FROM aws_scan_leases l
                    WHERE l.organization_id = $1 AND l.scan_kind = $5
                      AND l.released_at IS NULL AND l.expires_at > clock_timestamp()
                  ) THEN 'running'
                  ELSE 'interrupted'
                END AS run_state
         FROM cost_analysis_runs r
         WHERE r.organization_id = $1 AND ($3::varchar IS NULL OR r.source = $3)
         ORDER BY r.created_at DESC LIMIT $2`,
        [organizationId, limit, source, QUEUED_RUN_TIMEOUT_SECONDS, SCAN_KIND_DISCOVERY]
      );
      return result.rows;
    });
  }
}

/** The fields of a run that judge whether a hidden finding is still detected. */
export interface LatestLeasedRun {
  id: string;
  source: CostAnalysisRunSource;
  completed_at: string | null;
  checks: CostAnalysisCheck[] | null;
  run_state: CostAnalysisRunStatus;
}

/**
 * The organization's latest run that took the scan lease, any source: the anchor
 * for "still detected" (cost-finding-freshness.ts). Ordered by when it took the
 * lease, not when its row was created: only a lease holder reconciles, the lease
 * serializes them, and a manual run's row is created before it waits for the lease.
 * A run that never took the lease attempted nothing and is not an anchor.
 * run_state reads as getLatest() does for a leased run: 'running' only while a
 * lease is live. On the caller's org-tagged client, so a caller holding a
 * transaction (reopen) judges within it. Nothing is written.
 */
export async function latestLeasedRun(client: PoolClient, organizationId: string): Promise<LatestLeasedRun | null> {
  const result = await client.query<LatestLeasedRun>(
    `SELECT r.id, r.source, r.completed_at, r.checks,
            CASE
              WHEN r.status <> 'running' THEN r.status
              WHEN EXISTS (
                SELECT 1 FROM aws_scan_leases l
                WHERE l.organization_id = $1 AND l.scan_kind = $2
                  AND l.released_at IS NULL AND l.expires_at > clock_timestamp()
              ) THEN 'running'
              ELSE 'interrupted'
            END AS run_state
     FROM cost_analysis_runs r
     WHERE r.organization_id = $1 AND r.lease_acquired_at IS NOT NULL
     ORDER BY r.lease_acquired_at DESC, r.created_at DESC
     LIMIT 1`,
    [organizationId, SCAN_KIND_DISCOVERY]
  );
  return result.rows[0] ?? null;
}

/** The organization's latest analysis run (any source) as a reader sees it, and its last completed one. */
export interface LatestAnalysisRuns {
  latest: Pick<CostAnalysisRun, 'run_state' | 'started_at' | 'completed_at' | 'created_at'> | null;
  lastCompleted: Pick<CostAnalysisRun, 'status' | 'completed_at' | 'created_at'> | null;
}

/**
 * The organization's latest cost analysis run, any source, with run_state read
 * exactly as getLatest() reads it (a dead worker's 'running' row is
 * 'interrupted'), and its latest run that completed: status 'completed', or
 * 'partial' with a completion time (it reached its end with some cost checks
 * failed, and reconciled the open findings). On the caller's org-tagged client
 * (the weekly summary's held client). Nothing is written.
 */
export async function latestAnalysisRuns(client: Pick<PoolClient, 'query'>, organizationId: string): Promise<LatestAnalysisRuns> {
  const latest = await client.query(
    `SELECT r.started_at, r.completed_at, r.created_at,
            CASE
              WHEN r.status <> 'running' THEN r.status
              WHEN r.lease_acquired_at IS NULL
                THEN CASE WHEN r.created_at < NOW() - make_interval(secs => $2) THEN 'interrupted' ELSE 'running' END
              WHEN EXISTS (
                SELECT 1 FROM aws_scan_leases l
                WHERE l.organization_id = $1 AND l.scan_kind = $3
                  AND l.released_at IS NULL AND l.expires_at > clock_timestamp()
              ) THEN 'running'
              ELSE 'interrupted'
            END AS run_state
     FROM cost_analysis_runs r
     WHERE r.organization_id = $1
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [organizationId, QUEUED_RUN_TIMEOUT_SECONDS, SCAN_KIND_DISCOVERY]
  );
  const completed = await client.query(
    `SELECT r.status, r.completed_at, r.created_at
     FROM cost_analysis_runs r
     WHERE r.organization_id = $1
       AND (r.status = 'completed' OR (r.status = 'partial' AND r.completed_at IS NOT NULL))
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [organizationId]
  );
  return { latest: latest.rows[0] ?? null, lastCompleted: completed.rows[0] ?? null };
}

const DETAIL_COLUMNS = [
  'failed_detector_count',
  'unknown_resource_count',
  'checks',
  'detected_count',
  'new_count',
  'refreshed_count',
  'suppressed_resolved_count',
  'suppressed_dismissed_count',
  'duplicate_count',
  'persisted_count',
] as const;

/** The detail columns of a finishing UPDATE, their parameters numbered from `first`. detailValues() supplies them in this order. */
function detailAssignments(first: number): string {
  return DETAIL_COLUMNS.map((column, index) => `${column} = $${first + index}`).join(', ');
}

function detailValues({ summary, counts }: CostAnalysisRunDetail): unknown[] {
  return [
    summary.failedDetectorCount,
    summary.unknownResourceCount,
    JSON.stringify(summary.checks),
    counts?.detected ?? null,
    counts?.new ?? null,
    counts?.refreshed ?? null,
    counts?.suppressedResolved ?? null,
    counts?.suppressedDismissed ?? null,
    counts?.duplicate ?? null,
    counts?.persisted ?? null,
  ];
}
