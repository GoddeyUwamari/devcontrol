/**
 * Multi-region PR 2: the reads the coverage API and the discover result share, from
 * the database only (no AWS call).
 *
 *   isMultiRegionDiscoveryOn   the organization's multi_region_discovery flag, read as
 *                              the scanner reads it (no row: off) and fail-safe off:
 *                              a flag that cannot be read leaves a response as it was.
 *   readScanRegionsChecked     how one finished scan's regions came out, from the
 *                              status each region's run wrote (aws_account_regions rows
 *                              whose last_scan_started_at is that job's started_at:
 *                              recordRegionScanStatus writes the job's started_at).
 *
 * Every statement carries an explicit organization predicate; RLS on the tables is a
 * second layer. The caller passes its executor (the request's tagged connection).
 */
import { MULTI_REGION_DISCOVERY_FLAG } from './multi-region-foundation.repository';
import { AwsAccountsQueryable, findEligibleAwsAccount } from './aws-accounts.repository';
import { parseAccountIdFromArn } from '../utils/awsAccountId';

// A constant, checked here once: only [a-z0-9_] can ever reach the statement text.
const FLAG_LITERAL = /^[a-z][a-z0-9_]{0,63}$/.test(MULTI_REGION_DISCOVERY_FLAG) ? MULTI_REGION_DISCOVERY_FLAG : (() => {
  throw new Error('MULTI_REGION_DISCOVERY_FLAG is not a plain flag name');
})();

/** Whether multi-region discovery is on for the organization; false when the flag cannot be read (logged by error name). */
export async function isMultiRegionDiscoveryOn(db: AwsAccountsQueryable, organizationId: string, logLabel: string): Promise<boolean> {
  try {
    // isOrganizationFeatureEnabled's statement, on this executor type. The flag name is
    // this module's constant (it matches the column's CHECK), written into the text so the
    // statement's only parameter is the organization: callers' tenant-scoping tests
    // (e.g. costs-summary-endpoint) hold every statement to that.
    const { rows } = await db.query(
      `SELECT enabled FROM organization_feature_flags WHERE organization_id = $1 AND flag = '${FLAG_LITERAL}'`,
      [organizationId]
    );
    return rows[0]?.enabled === true;
  } catch (error: unknown) {
    console.warn(`${logLabel} multi_region_flag_unreadable: org ${organizationId} (${error instanceof Error ? error.name : 'unknown error'})`);
    return false;
  }
}

/** How one scan's regions came out (POST /api/services/discover, PR 2). Counts only; PR 3 words them. */
export interface ScanRegionsChecked {
  /** Enabled regions in the latest region list; null while none is stored. */
  enabled: number | null;
  /** Regions whose status this scan wrote (started, or never started on the scan budget). */
  recorded: number;
  /** ok: checked completely. */
  complete: number;
  /** partial: checked, a listing cut off. */
  partial: number;
  /** denied, failed or timed_out, the scan budget excepted: started, not checked completely. */
  not_checked: number;
  /** timed_out with scan_budget: never started, the scan budget ran out (review M-2: never counted as failed). */
  not_reached: number;
}

/**
 * How the job's regions came out, for the connected AWS account. Null when the job is
 * not this organization's or has no started_at.
 */
export async function readScanRegionsChecked(db: AwsAccountsQueryable, organizationId: string, jobId: string): Promise<ScanRegionsChecked | null> {
  const account = await findEligibleAwsAccount(db, organizationId);
  const awsAccountId = account ? parseAccountIdFromArn(account.role_arn ?? '') ?? null : null;
  const { rows } = await db.query(
    `WITH j AS (
       SELECT started_at FROM resource_discovery_jobs WHERE id = $2 AND organization_id = $1 AND started_at IS NOT NULL
     ),
     regions AS (
       SELECT ar.region, ar.enabled, ar.last_listed_at, ar.last_scan_status, ar.last_scan_started_at, ar.last_error_code
         FROM aws_account_regions ar
        WHERE ar.organization_id = $1 AND ar.aws_account_id = $3::text
     ),
     latest AS (SELECT MAX(last_listed_at) AS listed_at FROM regions)
     SELECT
       (SELECT COUNT(*) FROM j)::int AS job_found,
       (SELECT listed_at FROM latest) AS listed_at,
       (SELECT COUNT(*) FROM regions, latest WHERE regions.enabled AND regions.last_listed_at = latest.listed_at)::int AS enabled,
       (SELECT COUNT(*) FROM regions, j WHERE regions.last_scan_started_at = j.started_at)::int AS recorded,
       (SELECT COUNT(*) FROM regions, j WHERE regions.last_scan_started_at = j.started_at AND regions.last_scan_status = 'ok')::int AS complete,
       (SELECT COUNT(*) FROM regions, j WHERE regions.last_scan_started_at = j.started_at AND regions.last_scan_status = 'partial')::int AS partial,
       (SELECT COUNT(*) FROM regions, j WHERE regions.last_scan_started_at = j.started_at
                                          AND regions.last_scan_status IN ('denied', 'failed', 'timed_out')
                                          AND NOT (regions.last_scan_status = 'timed_out'
                                                   AND regions.last_error_code IS NOT DISTINCT FROM 'scan_budget'))::int AS not_checked,
       (SELECT COUNT(*) FROM regions, j WHERE regions.last_scan_started_at = j.started_at
                                          AND regions.last_scan_status = 'timed_out'
                                          AND regions.last_error_code = 'scan_budget')::int AS not_reached`,
    [organizationId, jobId, awsAccountId]
  );
  const row = rows[0];
  if (row.job_found === 0) return null;
  return {
    enabled: row.listed_at === null ? null : row.enabled,
    recorded: row.recorded,
    complete: row.complete,
    partial: row.partial,
    not_checked: row.not_checked,
    not_reached: row.not_reached,
  };
}
