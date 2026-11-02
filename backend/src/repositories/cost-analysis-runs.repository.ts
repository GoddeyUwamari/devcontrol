import { PoolClient } from 'pg';
import { pool } from '../config/database';
import type { CostAnalysisCheck, DetectorSummary, ReconcileCounts } from '../services/cost-analysis-outcome';
import { SCAN_KIND_DISCOVERY, SCAN_WAIT_CAP_MS } from '../services/scan-session';

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
 * This table is owned by the application role in production, so row-level
 * security does not apply to it: EVERY statement here must carry an explicit
 * organization_id predicate (or column, for the INSERT). A static test
 * (cost-analysis-runs.tenant-scope.test.ts) holds every statement to that.
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
   * Creates a 'running' row. Callers treat a failure here as non-fatal:
   * bookkeeping must never block the analysis itself.
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
   */
  async markFinished(
    id: string,
    organizationId: string,
    data: { recommendationsFound: number; totalPotentialSavings: number } & CostAnalysisRunDetail
  ): Promise<void> {
    if (data.summary.state === 'failed') {
      throw new Error('A run in which no detector completed cannot be marked finished');
    }
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `UPDATE cost_analysis_runs
         SET status = $1, completed_at = NOW(),
             recommendations_found = $2, total_potential_savings = $3, ${detailAssignments(6)}
         WHERE id = $4 AND organization_id = $5 AND status = 'running'`,
        [data.summary.state, data.recommendationsFound, data.totalPotentialSavings, id, organizationId, ...detailValues(data)]
      );
    });
  }

  /**
   * Marks a run failed, storing the full real error for server-side
   * diagnostics. GET /api/cost-recommendations/analysis-runs deliberately
   * does not return this column verbatim to the frontend. `detail` is given
   * when detectors ran, and none completed.
   */
  async markFailed(
    id: string,
    organizationId: string,
    errorMessage: string,
    detail?: CostAnalysisRunDetail
  ): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      if (detail) {
        await client.query(
          `UPDATE cost_analysis_runs
           SET status = 'failed', completed_at = NOW(), error_message = $1, ${detailAssignments(4)}
           WHERE id = $2 AND organization_id = $3 AND status = 'running'`,
          [errorMessage, id, organizationId, ...detailValues(detail)]
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
