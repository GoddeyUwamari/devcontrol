import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth.middleware';
import {
  AWS_ACCOUNT_AMBIGUOUS_MESSAGE,
  AwsAccountsQueryable,
  findEligibleAwsAccount,
  homeRegionOf,
  isAwsAccountAmbiguous,
} from '../repositories/aws-accounts.repository';
import type { RegionScanStatus } from '../repositories/multi-region-foundation.repository';
import { isMultiRegionDiscoveryOn } from '../repositories/multi-region-coverage.repository';
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  splitDiscoveryMessage,
} from '../services/discovery-warnings';
import {
  REGION_CODE_ACCESS_DENIED,
  REGION_CODE_ACCESS_DENIED_SCP,
  REGION_CODE_CALL_TIMEOUT,
  REGION_CODE_DEADLINE,
  REGION_CODE_ERROR,
  REGION_CODE_NOT_READY,
  REGION_CODE_SCAN_BUDGET,
  REGION_CODE_THROTTLED,
} from '../services/region-run';
import { MAX_LEASE_AGE_SECONDS } from '../services/scan-lease';
import { SCAN_KIND_DISCOVERY } from '../services/scan-session';
import { parseAccountIdFromArn } from '../utils/awsAccountId';
import { INVENTORY_FROM, inventoryWhere } from './services.routes';
import { requireCurrentMembership } from './services-intelligence.routes';

const router = Router();

/**
 * What the Services page may say about scan coverage (Phase 1, PR S1-B), read
 * from the database only: no AWS call is made to answer it.
 *
 * The scope is the scanner's as it runs today (multi-region stage M6):
 *   - the home region is the one region discovery scans every inventoried type in;
 *   - S3 buckets are listed account-wide and stored at each bucket's own region;
 *   - CloudFront distributions are global (stored with region 'global').
 * IAM is not inventoried, so nothing here claims it.
 *
 * Multi-region M5c (m5c-plan.md) adds what the scanner has recorded per region,
 * for the connected AWS account (the account its role ARN names, the scan
 * lease's rule): the enabled regions of the latest region list (M5a), each
 * one's last scan status (M5b; only the home region is scanned until M7),
 * whether a discovery scan is running now (the lease), and the newest
 * completed scan. Until a region list has been stored the enabled regions are
 * unknown, never a number.
 *
 * Counts are over the same rows as the Services list and /stats
 * (INVENTORY_FROM + inventoryWhere: this organization, not terminated), and
 * tags_unknown_by_type is /stats' unknown_by_type, from the same ownership rule.
 */
export interface ServicesCoverage {
  account: { connected: boolean; status: string | null; home_region: string | null };
  scope: {
    home_region: { region: string; count: number } | null;
    s3: { in_last_scan: boolean; regions: RegionCount[] };
    cloudfront: { in_last_scan: boolean; count: number };
    enabled_regions: {
      known: boolean;
      /** Enabled regions in the latest list; null while no list has been stored. */
      count: number | null;
      /** When the latest list was taken. */
      listed_at: Date | null;
      /** The latest list is older than STALE_AFTER_SECONDS (database clock); false while unknown. */
      stale: boolean;
    };
  };
  /** The enabled regions of the latest list, home first: [] with no account or no list. */
  region_status: RegionCoverage[];
  /**
   * Non-null only while the account's discovery lease is held (database clock)
   * AND names a discovery job that is running or pending. A cost Analyze holds
   * the same lease with no job: not a scan in progress. since = the lease's
   * acquisition time.
   */
  scan_in_progress: { since: Date } | null;
  /** The newest completed job (its completed_at is last_successful_scan_at); null when none. */
  last_completed_scan: {
    started_at: Date | null;
    completed_at: Date;
    resource_types: string[];
    warnings: string[];
  } | null;
  last_successful_scan_at: Date | null;
  /**
   * The latest attempt: the organization's newest job, whatever its status
   * (m5-plan.md §14.1). A region's status is written only by a scan that
   * reached its end, so whether the latest attempt worked is read here.
   */
  last_scan: {
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    warnings: string[];
  } | null;
  resource_types: string[] | null;
  tags_unknown_by_type: Record<string, number>;
  regions: RegionCount[];
  total: number;
  /**
   * Multi-region PR 2: present ONLY for an organization whose multi_region_discovery
   * flag is on (organization_feature_flags). Without the flag the key is absent and
   * the response is byte-identical to the one before PR 2 (a contract test pins it).
   */
  multi_region?: MultiRegionCoverage;
}

/**
 * What a multi-region scan has recorded per region (multi-region PR 2, Step 1 §10),
 * read from the database only. Additive to the keys above, which keep their meaning.
 *
 * SCAN SELECTION (founder decision, approved mock state (d)): while a discovery scan
 * runs, `progress` is THAT scan's ("9 of 17 done") and each region carries its own
 * last recorded result: the running scan's when the region is done in it
 * (result_of = 'running_scan'), otherwise the result of the last scan that finished
 * that region (result_of = 'earlier_scan'). With no scan running, `progress` is null
 * and every result is the latest scan's. A count (0 included) is returned only when a
 * successful check backs it (review H-1): never for a region that was never checked
 * successfully, and for a running or waiting region only its earlier successful count,
 * marked as such (resources_from).
 */
export interface MultiRegionCoverage {
  /**
   * The scan this response describes (review M-1): the running discovery job while one
   * runs, otherwise the organization's newest job, whatever its status; null when no
   * job exists. The id is the organization's own job id (POST /discover returns it as jobId).
   */
  scan: MultiRegionScan | null;
  /** One overall coverage status, computed here (review M-1). See CoverageStatus. */
  coverage_status: CoverageStatus;
  home_region: string | null;
  /**
   * The regions savings (cost recommendations) are checked in: the home region only
   * (FD-1, review H-1). Empty when no home region is known. Data for PR 3's line; no
   * per-region cost is reported.
   */
  savings_regions: string[];
  /** Regions of the latest list the account has NOT enabled (opt-in regions), by name. Never scanned, never in a count. */
  not_enabled_regions: string[];
  /** The enabled regions of the latest list, home first, then by name: one entry each. */
  regions: MultiRegionRegion[];
  /** How many enabled regions' last recorded result is in each state (null enabled: no list stored yet). */
  regions_checked: RegionsChecked;
  /** The running discovery scan's progress over its regions; null when no scan runs. */
  progress: MultiRegionProgress | null;
  /**
   * Region-scoped warning codes, each with its region, from each region's last
   * recorded result (aws_account_regions.last_error_code): Resource Explorer
   * no_index / no_view and the truncation codes. Codes only, never text. Not
   * scan_budget (a region never started: its state) and not scan_deadline (a scan-level
   * stop after the regions, in last_scan.warnings; it has no region).
   */
  region_warnings: Array<{ code: string; region: string }>;
  /**
   * Whether region_warnings can name every region a Resource Explorer warning came
   * from: true when every scanned region's last result is ok. A region with another
   * outcome (partial, denied, failed, timed_out) records that outcome's code in its one
   * code column, so a Resource Explorer warning in it would not be named.
   */
  region_warnings_complete: boolean;
}

/**
 * The overall coverage status (review M-1):
 *
 *   in_progress                         a discovery scan is running now
 *   all_checked                         the newest scan completed, and every region it covers
 *                                       (home + the enabled, allow-listed regions of the latest
 *                                       list) has a checked / checked_with_warnings result
 *                                       written by that scan
 *   completed_with_regions_not_checked  the newest scan completed, but at least one of those
 *                                       regions has no checked result from it (failed, denied,
 *                                       not ready, deadline, scan budget, or no result written)
 *   latest_scan_failed                  the newest scan failed, or was abandoned (running or
 *                                       pending with no held lease): regions it did not reach
 *                                       show earlier results (result_of = 'earlier_scan')
 *   unavailable                         no scan has run, or no region list is stored yet (no
 *                                       "N of M" can be stated)
 */
export type CoverageStatus = 'in_progress' | 'all_checked' | 'completed_with_regions_not_checked' | 'latest_scan_failed' | 'unavailable';

export interface MultiRegionScan {
  id: string;
  /** resource_discovery_jobs.status: running, pending, completed, failed. */
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  /** The regions this scan covers (home + the enabled, allow-listed regions of the latest list). */
  regions_total: number;
  /** Of those, the regions with a checked or checked_with_warnings result written by THIS scan. */
  regions_checked: number;
}

export interface MultiRegionRegion {
  region: string;
  home: boolean;
  /** An opt-in region the account has enabled (opt_in_status 'opted-in'). */
  opt_in: boolean;
  /** The region's last recorded result (which scan wrote it: result_of). */
  status: RegionScanStatus;
  /** A code on MULTI_REGION_ERROR_CODES, or null; never the stored message. */
  error_code: string | null;
  last_scan_finished_at: Date | null;
  last_success_at: Date | null;
  /** As region_status[].stale: a status was written and is older than STALE_AFTER_SECONDS (database clock). */
  stale: boolean;
  /**
   * Which scan wrote the region's last result: 'running_scan' (done in the scan running
   * now), 'latest_scan' (no scan running; written by the newest scan, `scan`),
   * 'earlier_scan' (any older scan, e.g. a region the newest scan never reached), null
   * (never scanned).
   */
  result_of: 'running_scan' | 'latest_scan' | 'earlier_scan' | null;
  /**
   * Only while a scan runs (else null): done in it, started and not done, not started
   * yet, or excluded (a region the account's allow-list keeps out of scans,
   * scan_enabled = false: the scan never covers it, review L-1).
   */
  scan_state: 'done' | 'running' | 'waiting' | 'excluded' | null;
  /**
   * The region's state in one field (review M-2), so a page never combines status,
   * error_code, scan_state and result_of itself. See RegionState.
   */
  state: RegionState;
  /**
   * Resources stored for the region (the Services list's rows: this organization, not
   * terminated), returned ONLY when a successful check backs the count (PR 2 fix round,
   * review H-1, founder decision); otherwise null, never 0:
   *   - the region's last recorded result is ok or partial: its rows now
   *     (resources_from = 'last_result');
   *   - its last result is not (denied, failed, not ready, timed out, scan budget) but
   *     an earlier scan of it succeeded (last_success_at): the rows kept from that
   *     success (resources_from = 'earlier_success');
   *   - running or waiting in the running scan: the rows stored before that scan began,
   *     only when its earlier result was ok/partial or it has an earlier success
   *     (resources_from = 'earlier_success'); never what the running scan wrote so far;
   *   - otherwise (never scanned, or never successfully checked): null.
   */
  resources: number | null;
  /** What backs `resources`: see above. null exactly when `resources` is null. */
  resources_from: 'last_result' | 'earlier_success' | null;
  /**
   * True ONLY when a successful check found nothing: the region's last recorded result
   * is ok with no warning code, it is not running or waiting, and it has 0 resources.
   * A partial result, a Resource Explorer warning, a failure, the scan budget, a
   * running or waiting region, or a count kept from an earlier success is never empty.
   */
  empty: boolean;
}

/**
 * One region's state (review M-2), derived on the server from the existing codes:
 *
 *   not_started            no result yet: waiting in the running scan, or never scanned
 *   in_progress            running in the running scan
 *   checked                last result ok, no warning code
 *   checked_with_warnings  last result ok with a Resource Explorer code, or partial
 *   failed                 failed (error), or timed out on throttling / one call's limit
 *                          (throttled, call_timeout): the check did not complete
 *   not_checked_budget     never started: the scan budget ran out (timed_out, scan_budget)
 *   not_checked_deadline   started, ran past its deadline (timed_out, region_deadline)
 *   denied                 refused (access_denied, access_denied_scp)
 *   not_ready              enabled but not usable yet (failed, region_not_ready)
 *   excluded               kept out of scans by the account's allow-list (scan_enabled = false)
 *
 * The running scan decides in_progress / not_started for a region not done in it;
 * otherwise the region's last recorded result does (status and error_code keep the detail).
 */
export type RegionState =
  | 'not_started'
  | 'in_progress'
  | 'checked'
  | 'checked_with_warnings'
  | 'failed'
  | 'not_checked_budget'
  | 'not_checked_deadline'
  | 'denied'
  | 'not_ready'
  | 'excluded';

export const REGION_STATES: readonly RegionState[] = [
  'not_started', 'in_progress', 'checked', 'checked_with_warnings', 'failed',
  'not_checked_budget', 'not_checked_deadline', 'denied', 'not_ready', 'excluded',
];

export interface RegionsChecked {
  /** enabled_regions.count; null while no list is stored. */
  enabled: number | null;
  /** Last result ok: checked completely (a Resource Explorer code included). */
  complete: number;
  /** Last result partial: checked, a listing cut off. */
  partial: number;
  /** Last result denied, failed or timed_out, the scan budget excepted: started, not checked completely. */
  not_checked: number;
  /** Last result timed_out with scan_budget: never started, the scan budget ran out (review M-2: never counted as failed). */
  not_reached: number;
  /** Never scanned. */
  never_scanned: number;
  /** Every enabled region of the latest list by its current state (every state present, 0 when none). */
  by_state: Record<RegionState, number>;
}

export interface MultiRegionProgress {
  /** The running job's started_at: a region is done in this scan when its result was started then (null: not recorded, none done). */
  scan_started_at: Date | null;
  /** The regions the scan covers: home plus the enabled (and allow-listed) regions of the latest list. */
  regions_total: number;
  regions_done: number;
  regions_running: number;
  regions_waiting: number;
}

interface RegionCount {
  region: string | null;
  count: number;
}

export interface RegionCoverage {
  region: string;
  home: boolean;
  status: RegionScanStatus;
  last_scan_finished_at: Date | null;
  last_success_at: Date | null;
  /** A code on REGION_ERROR_CODES, or null; never the stored message. */
  last_error_code: string | null;
  /**
   * Scans in a row that REACHED the status write with a failed home-region
   * source (m5-plan.md §14, §14.1). A scan that stopped before the write
   * (credentials, lost lease, fatal error) is not counted: this is not
   * "failed attempts in a row".
   */
  consecutive_failures: number;
  /** A status was written and last_scan_finished_at is older than STALE_AFTER_SECONDS (database clock). */
  stale: boolean;
}

/** Scheduled discovery runs every 6 hours (the cron in jobs/resourceDiscovery.job.ts; a test pins the two together). */
export const DISCOVERY_INTERVAL_SECONDS = 6 * 60 * 60;

/**
 * A region status or region list older than this is stale: two scheduled
 * scans in a row did not refresh it, allowing the second one its longest
 * possible run (the scan lease's maximum age). 13 hours.
 */
export const STALE_AFTER_SECONDS = 2 * DISCOVERY_INTERVAL_SECONDS + MAX_LEASE_AGE_SECONDS;

/**
 * The only region error codes passed on: the codes multi-region M5b records
 * for a partial scan (region-scan-status.ts). Any other stored value is
 * returned as null.
 */
export const REGION_ERROR_CODES: readonly string[] = [DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED];

function regionErrorCode(code: unknown): string | null {
  return typeof code === 'string' && REGION_ERROR_CODES.includes(code) ? code : null;
}

/**
 * The region codes multi_region passes on (PR 2): every code a multi-region scan
 * writes to aws_account_regions.last_error_code (region-run.ts), and the Resource
 * Explorer codes it writes on an `ok` region (RR-M2). Any other stored value is null.
 * region_status[].last_error_code keeps REGION_ERROR_CODES, unchanged.
 */
export const MULTI_REGION_ERROR_CODES: readonly string[] = [
  ...REGION_ERROR_CODES,
  REGION_CODE_ACCESS_DENIED,
  REGION_CODE_ACCESS_DENIED_SCP,
  REGION_CODE_NOT_READY,
  REGION_CODE_DEADLINE,
  REGION_CODE_THROTTLED,
  REGION_CODE_CALL_TIMEOUT,
  REGION_CODE_SCAN_BUDGET,
  REGION_CODE_ERROR,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
];

/** The region codes that are warnings (the scan still completed): reported in region_warnings with their region. */
export const REGION_WARNING_CODES: readonly string[] = [
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  // scan_budget is not here (review L-2): a region never started is not checked, not a
  // warning on a check; it is its state (not_checked_budget) and its error_code.
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
];

function multiRegionErrorCode(code: unknown): string | null {
  return typeof code === 'string' && MULTI_REGION_ERROR_CODES.includes(code) ? code : null;
}

/** One region_status element as json_agg returns it: timestamps as text. */
interface RegionStatusJson {
  region: string;
  status: RegionScanStatus;
  last_scan_finished_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  consecutive_failures: number;
  stale: boolean;
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

// A stored warning is a fixed code (discovery-warnings.ts). Anything else in the
// column is not passed on: the response never carries free text from a job row.
const WARNING_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * The last job's warnings: the codes in resource_discovery_jobs.warnings (the
 * JSONB column multi-region M3 adds and M4c writes) together with those encoded
 * in error_message (where discovery writes them before M4c, and during M4c's
 * dual-write), each once, in that order. The error text itself is never returned.
 */
export function lastScanWarnings(column: unknown, errorMessage: string | null): string[] {
  const fromColumn = Array.isArray(column)
    ? column.filter((code): code is string => typeof code === 'string' && WARNING_CODE.test(code))
    : [];
  return [...new Set([...fromColumn, ...splitDiscoveryMessage(errorMessage).warnings])];
}

/**
 * One statement for everything but the account. The jobs are read with an
 * explicit organization predicate, the inventory through inventoryWhere's; RLS
 * on both tables is a second layer, not the scope.
 *
 * warnings is read as to_jsonb(last_job) -> 'warnings' rather than by name, so the
 * statement is the same whether or not the M3 admin migration that adds the
 * column has been applied: without it, the value is NULL.
 *
 * The last job is the newest by created_at (then id), whatever its status, as
 * services intelligence reads it. The last successful scan is the newest
 * completed_at of a 'completed' job: a 'failed' job may have refreshed some of
 * the inventory, but not which part.
 */
function coverageStatement(orgId: string, homeRegion: string | null, awsAccountId: string | null) {
  const { where, values } = inventoryWhere(orgId, {});
  const home = values.length + 1;
  const account = values.length + 2;
  const staleAfter = values.length + 3;
  const scanKind = values.length + 4;
  const text = `WITH last_job AS (
       SELECT j.*
         FROM resource_discovery_jobs j
        WHERE j.organization_id = $1
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1
     ),
     inv AS (
       SELECT r.resource_type AS type, r.region, os.ownership
         FROM ${INVENTORY_FROM}
        WHERE ${where}
     ),
     regions AS (
       SELECT ar.region, ar.enabled, ar.last_listed_at, ar.last_scan_status, ar.last_scan_finished_at,
              ar.last_success_at, ar.last_error_code, ar.consecutive_failures
         FROM aws_account_regions ar
        WHERE ar.organization_id = $1 AND ar.aws_account_id = $${account}::text
     ),
     latest_list AS (
       SELECT MAX(regions.last_listed_at) AS listed_at FROM regions
     ),
     listed AS (
       SELECT regions.* FROM regions, latest_list
        WHERE regions.enabled AND regions.last_listed_at = latest_list.listed_at
     ),
     lease AS (
       SELECT sl.acquired_at
         FROM aws_scan_leases sl
         JOIN resource_discovery_jobs lj ON lj.id = sl.job_id AND lj.organization_id = $1
        WHERE sl.organization_id = $1 AND sl.aws_account_id = $${account}::text AND sl.scan_kind = $${scanKind}::text
          AND sl.released_at IS NULL AND sl.expires_at > clock_timestamp()
          AND lj.status IN ('running', 'pending')
     ),
     last_completed AS (
       SELECT cj.started_at, cj.completed_at, cj.resource_types, cj.error_message, to_jsonb(cj) -> 'warnings' AS warnings
         FROM resource_discovery_jobs cj
        WHERE cj.organization_id = $1 AND cj.status = 'completed'
        ORDER BY cj.completed_at DESC NULLS LAST, cj.created_at DESC, cj.id DESC
        LIMIT 1
     )
     SELECT last_job.status, last_job.started_at, last_job.completed_at, last_job.resource_types,
            last_job.error_message, to_jsonb(last_job) -> 'warnings' AS warnings,
            (SELECT MAX(j.completed_at) FROM resource_discovery_jobs j
              WHERE j.organization_id = $1 AND j.status = 'completed') AS last_successful_scan_at,
            (SELECT COUNT(*) FROM inv)::int AS total,
            (SELECT COUNT(*) FROM inv WHERE inv.region = $${home}::text)::int AS home_count,
            (SELECT COUNT(*) FROM inv WHERE inv.type = 'cloudfront')::int AS cloudfront_count,
            COALESCE(
              (SELECT json_agg(json_build_object('region', region, 'count', n) ORDER BY n DESC, region COLLATE "C")
                 FROM (SELECT region, COUNT(*)::int AS n FROM inv WHERE type = 's3' GROUP BY region) s),
              '[]'::json) AS s3_regions,
            COALESCE(
              (SELECT json_agg(json_build_object('region', region, 'count', n) ORDER BY n DESC, region COLLATE "C")
                 FROM (SELECT region, COUNT(*)::int AS n FROM inv GROUP BY region) g),
              '[]'::json) AS regions,
            COALESCE(
              (SELECT json_object_agg(type, n ORDER BY type)
                 FROM (SELECT type, COUNT(*)::int AS n FROM inv WHERE ownership = 'unknown' GROUP BY type) u),
              '{}'::json) AS tags_unknown_by_type,
            (SELECT listed_at FROM latest_list) AS regions_listed_at,
            (SELECT COUNT(*) FROM listed)::int AS enabled_region_count,
            COALESCE((SELECT listed_at < now() - make_interval(secs => $${staleAfter}) FROM latest_list), false) AS regions_list_stale,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'region', listed.region,
                        'status', listed.last_scan_status,
                        'last_scan_finished_at', listed.last_scan_finished_at,
                        'last_success_at', listed.last_success_at,
                        'last_error_code', listed.last_error_code,
                        'consecutive_failures', listed.consecutive_failures,
                        'stale', listed.last_scan_status <> 'never_scanned'
                                 AND COALESCE(listed.last_scan_finished_at < now() - make_interval(secs => $${staleAfter}), false))
                      ORDER BY (listed.region = $${home}::text) DESC, listed.region COLLATE "C")
                 FROM listed),
              '[]'::json) AS region_status,
            (SELECT acquired_at FROM lease) AS scan_in_progress_since,
            last_completed.started_at AS last_completed_started_at,
            last_completed.completed_at AS last_completed_completed_at,
            last_completed.resource_types AS last_completed_resource_types,
            last_completed.error_message AS last_completed_error_message,
            last_completed.warnings AS last_completed_warnings
       FROM (SELECT 1) one
       LEFT JOIN last_job ON true
       LEFT JOIN last_completed ON true`;
  return { text, values: [...values, homeRegion, awsAccountId, STALE_AFTER_SECONDS, SCAN_KIND_DISCOVERY] };
}

/**
 * The multi-region statement (PR 2): one read, only for a flagged organization, so
 * the coverage statement above is unchanged for every other.
 *
 *   listed    every row of the latest region list (enabled or not);
 *   running   the discovery job the account's held lease names, while it is running
 *             or pending (the scan_in_progress rule): its started_at and the regions
 *             it has started (resource_discovery_jobs.regions, which a multi-region
 *             scan empties when it begins and extends as each region starts);
 *   counts    per region, the Services list's rows (inventoryWhere: this organization,
 *             not terminated) now, and those first stored before the running scan
 *             began (none while no scan runs).
 *
 * A region is done in the running scan when its status was written by it
 * (last_scan_started_at = the job's started_at: recordRegionScanStatus writes the
 * job's started_at). The scan's region list is the scanner's own rule
 * (listScanRegions + regionsToScan): home, then every enabled and allow-listed region
 * of the latest list.
 */
function multiRegionStatement(orgId: string, homeRegion: string | null, awsAccountId: string | null) {
  const { where, values } = inventoryWhere(orgId, {});
  const home = values.length + 1;
  const account = values.length + 2;
  const staleAfter = values.length + 3;
  const scanKind = values.length + 4;
  const text = `WITH listed AS (
       SELECT ar.region, ar.enabled, ar.scan_enabled, ar.opt_in_status, ar.last_scan_status, ar.last_scan_started_at,
              ar.last_scan_finished_at, ar.last_success_at, ar.last_error_code
         FROM aws_account_regions ar
        WHERE ar.organization_id = $1 AND ar.aws_account_id = $${account}::text
          AND ar.last_listed_at = (SELECT MAX(l.last_listed_at) FROM aws_account_regions l
                                    WHERE l.organization_id = $1 AND l.aws_account_id = $${account}::text)
     ),
     running AS (
       SELECT true AS present, lj.id, lj.status, lj.started_at, lj.completed_at, COALESCE(lj.regions, '{}') AS started_regions
         FROM aws_scan_leases sl
         JOIN resource_discovery_jobs lj ON lj.id = sl.job_id AND lj.organization_id = $1
        WHERE sl.organization_id = $1 AND sl.aws_account_id = $${account}::text AND sl.scan_kind = $${scanKind}::text
          AND sl.released_at IS NULL AND sl.expires_at > clock_timestamp()
          AND lj.status IN ('running', 'pending')
        LIMIT 1
     ),
     newest AS (
       -- The organization's newest job, whatever its status (last_scan's rule).
       SELECT j.id, j.status, j.started_at, j.completed_at
         FROM resource_discovery_jobs j
        WHERE j.organization_id = $1
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1
     ),
     counts AS (
       SELECT r.region,
              COUNT(*)::int AS now_count,
              -- A row with no recorded first discovery predates the column's default: earlier.
              COUNT(*) FILTER (WHERE COALESCE(r.first_discovered_at, r.created_at) IS NULL
                                  OR COALESCE(r.first_discovered_at, r.created_at) < (SELECT started_at FROM running))::int AS before_count
         FROM aws_resources r
        WHERE ${where}
        GROUP BY r.region
     )
     SELECT
       COALESCE((SELECT present FROM running), false) AS scanning,
       (SELECT started_at FROM running) AS running_started_at,
       (SELECT started_regions FROM running) AS running_started_regions,
       (SELECT json_build_object('id', id, 'status', status, 'started_at', started_at, 'completed_at', completed_at) FROM running) AS running_job,
       (SELECT json_build_object('id', id, 'status', status, 'started_at', started_at, 'completed_at', completed_at) FROM newest) AS newest_job,
       COALESCE((SELECT json_agg(listed.region ORDER BY listed.region COLLATE "C") FROM listed WHERE NOT listed.enabled), '[]'::json) AS not_enabled,
       COALESCE((SELECT json_agg(json_build_object(
                  'region', listed.region,
                  'scan_enabled', listed.scan_enabled,
                  'opt_in_status', listed.opt_in_status,
                  'status', listed.last_scan_status,
                  'last_scan_started_at', listed.last_scan_started_at,
                  'last_scan_finished_at', listed.last_scan_finished_at,
                  'last_success_at', listed.last_success_at,
                  'last_error_code', listed.last_error_code,
                  'stale', listed.last_scan_status <> 'never_scanned'
                           AND COALESCE(listed.last_scan_finished_at < now() - make_interval(secs => $${staleAfter}), false),
                  'done_in_running_scan', listed.last_scan_started_at IS NOT NULL
                           AND listed.last_scan_started_at = (SELECT started_at FROM running),
                  'in_newest_scan', listed.last_scan_started_at IS NOT NULL
                           AND listed.last_scan_started_at = (SELECT started_at FROM newest),
                  'now_count', COALESCE(counts.now_count, 0),
                  'before_count', COALESCE(counts.before_count, 0))
                ORDER BY (listed.region = $${home}::text) DESC, listed.region COLLATE "C")
           FROM listed LEFT JOIN counts ON counts.region = listed.region
          WHERE listed.enabled), '[]'::json) AS regions`;
  return { text, values: [...values, homeRegion, awsAccountId, STALE_AFTER_SECONDS, SCAN_KIND_DISCOVERY] };
}

/** One element of the multi-region statement's `regions`, as json_agg returns it (timestamps as text). */
interface MultiRegionRowJson {
  region: string;
  scan_enabled: boolean;
  opt_in_status: string | null;
  status: RegionScanStatus;
  last_scan_started_at: string | null;
  last_scan_finished_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  stale: boolean;
  done_in_running_scan: boolean;
  in_newest_scan: boolean;
  now_count: number;
  before_count: number;
}

const NOT_CHECKED_STATUSES: readonly string[] = ['denied', 'failed', 'timed_out'];

/** The states that are a check (review M-1): the region was looked at and its result stands. */
const CHECKED_STATES: readonly RegionState[] = ['checked', 'checked_with_warnings'];

/** A last result that is the scan budget: the region was never started (not a failure). */
const notReached = (entry: { status: string; error_code: string | null }) => entry.status === 'timed_out' && entry.error_code === REGION_CODE_SCAN_BUDGET;

/** A recorded region result that is a successful check (founder decision H-1): ok, or partial (checked, a listing cut off). */
const SUCCESSFUL_STATUSES: readonly string[] = ['ok', 'partial'];

/**
 * A region's resource count, what backs it, and whether it is a successful empty
 * check (review H-1). `notDone`: running or waiting in the running scan.
 */
export function regionResources(entry: {
  status: string;
  error_code: string | null;
  last_success_at: unknown;
  now_count: number;
  before_count: number;
}, notDone: boolean): Pick<MultiRegionRegion, 'resources' | 'resources_from' | 'empty'> {
  const lastResultSuccessful = SUCCESSFUL_STATUSES.includes(entry.status);
  const earlierSuccess = entry.last_success_at !== null && entry.last_success_at !== undefined;
  if (notDone) {
    // The earlier result, and only if a check ever succeeded; never the running scan's writes.
    return lastResultSuccessful || earlierSuccess
      ? { resources: entry.before_count, resources_from: 'earlier_success', empty: false }
      : { resources: null, resources_from: null, empty: false };
  }
  if (lastResultSuccessful) {
    return {
      resources: entry.now_count,
      resources_from: 'last_result',
      empty: entry.now_count === 0 && entry.status === 'ok' && entry.error_code === null,
    };
  }
  if (earlierSuccess) return { resources: entry.now_count, resources_from: 'earlier_success', empty: false };
  return { resources: null, resources_from: null, empty: false };
}

/** A region's single state (review M-2): see RegionState. */
export function regionState(status: string, errorCode: string | null, scanState: MultiRegionRegion['scan_state'], scanEnabled: boolean): RegionState {
  if (!scanEnabled) return 'excluded';
  if (scanState === 'running') return 'in_progress';
  if (scanState === 'waiting') return 'not_started';
  switch (status) {
    case 'ok':
      return errorCode === null ? 'checked' : 'checked_with_warnings';
    case 'partial':
      return 'checked_with_warnings';
    case 'denied':
      return 'denied';
    case 'failed':
      return errorCode === REGION_CODE_NOT_READY ? 'not_ready' : 'failed';
    case 'timed_out':
      if (errorCode === REGION_CODE_SCAN_BUDGET) return 'not_checked_budget';
      if (errorCode === REGION_CODE_DEADLINE) return 'not_checked_deadline';
      return 'failed';
    default:
      // never_scanned, and the statuses no scan writes (skipped_locked, not_enabled): nothing checked.
      return 'not_started';
  }
}

/** The multi_region key (PR 2) for a flagged organization. */
export async function readMultiRegionCoverage(
  db: AwsAccountsQueryable,
  orgId: string,
  homeRegion: string | null,
  awsAccountId: string | null
): Promise<MultiRegionCoverage> {
  const { text, values } = multiRegionStatement(orgId, homeRegion, awsAccountId);
  const { rows } = await db.query(text, values);
  const row = rows[0];
  const scanning: boolean = row.scanning;
  const runningStartedAt: Date | null = row.running_started_at;
  const started = new Set<string>(row.running_started_regions ?? []);
  const listed: MultiRegionRowJson[] = row.regions;

  const regions = listed.map((entry): MultiRegionRegion => {
    const done = scanning && entry.done_in_running_scan;
    const neverScanned = entry.status === 'never_scanned';
    const scanState: MultiRegionRegion['scan_state'] = !scanning
      ? null
      : !entry.scan_enabled
        ? 'excluded'
        : done
          ? 'done'
          : started.has(entry.region)
            ? 'running'
            : 'waiting';
    const errorCode = multiRegionErrorCode(entry.last_error_code);
    // Review H-1: a count only when a successful check backs it; empty only for a
    // successful check that found nothing.
    const counted = regionResources({ ...entry, error_code: errorCode }, scanning && !done);
    return {
      region: entry.region,
      home: entry.region === homeRegion,
      opt_in: entry.opt_in_status === 'opted-in',
      status: entry.status,
      error_code: errorCode,
      last_scan_finished_at: toDate(entry.last_scan_finished_at),
      last_success_at: toDate(entry.last_success_at),
      stale: entry.stale,
      result_of: neverScanned ? null : done ? 'running_scan' : !scanning && entry.in_newest_scan ? 'latest_scan' : 'earlier_scan',
      scan_state: scanState,
      state: regionState(entry.status, errorCode, scanState, entry.scan_enabled),
      ...counted,
    };
  });

  // The scan's own region list (regionsToScan): home first, then every enabled and
  // allow-listed region of the latest list; home only when no list is stored.
  const scanList = new Set(listed.filter((entry) => entry.scan_enabled).map((entry) => entry.region));
  if (homeRegion !== null) scanList.add(homeRegion);
  const byRegion = new Map(regions.map((entry) => [entry.region, entry]));
  let progress: MultiRegionProgress | null = null;
  if (scanning) {
    let done = 0;
    let running = 0;
    for (const region of scanList) {
      const state = byRegion.get(region);
      if (state?.scan_state === 'done') done++;
      else if (started.has(region)) running++;
    }
    progress = {
      scan_started_at: runningStartedAt,
      regions_total: scanList.size,
      regions_done: done,
      regions_running: running,
      regions_waiting: scanList.size - done - running,
    };
  }

  // Review M-1: the scan described, and one overall coverage status. A region counts as
  // checked by that scan only when THAT scan wrote a checked result for it, so a failed or
  // partial newest scan never reads as "N of N" from older results.
  const job: { id: string; status: string; started_at: string | null; completed_at: string | null } | null =
    scanning ? row.running_job : row.newest_job;
  const checkedByScan = [...scanList].filter((region) => {
    const entry = byRegion.get(region);
    if (!entry || !CHECKED_STATES.includes(entry.state)) return false;
    return scanning ? entry.scan_state === 'done' : entry.result_of === 'latest_scan';
  }).length;
  const scan: MultiRegionScan | null = job
    ? {
        id: job.id,
        status: job.status,
        started_at: toDate(job.started_at),
        completed_at: toDate(job.completed_at),
        regions_total: scanList.size,
        regions_checked: checkedByScan,
      }
    : null;
  let coverageStatus: CoverageStatus;
  if (scanning) coverageStatus = 'in_progress';
  else if (!job || listed.length === 0) coverageStatus = 'unavailable';
  else if (job.status === 'completed') coverageStatus = checkedByScan === scanList.size ? 'all_checked' : 'completed_with_regions_not_checked';
  // failed, or running/pending with no held lease (abandoned: scan_in_progress's rule).
  else coverageStatus = 'latest_scan_failed';

  const scanned = regions.filter((entry) => entry.status !== 'never_scanned');
  return {
    scan,
    coverage_status: coverageStatus,
    home_region: homeRegion,
    savings_regions: homeRegion === null ? [] : [homeRegion],
    not_enabled_regions: row.not_enabled,
    regions,
    regions_checked: {
      enabled: listed.length > 0 ? listed.length : null,
      complete: regions.filter((entry) => entry.status === 'ok').length,
      partial: regions.filter((entry) => entry.status === 'partial').length,
      not_checked: regions.filter((entry) => NOT_CHECKED_STATUSES.includes(entry.status) && !notReached(entry)).length,
      not_reached: regions.filter(notReached).length,
      never_scanned: regions.filter((entry) => entry.status === 'never_scanned').length,
      by_state: Object.fromEntries(REGION_STATES.map((state) => [state, regions.filter((entry) => entry.state === state).length])) as Record<RegionState, number>,
    },
    progress,
    region_warnings: regions
      .filter((entry) => entry.error_code !== null && REGION_WARNING_CODES.includes(entry.error_code))
      .map((entry) => ({ code: entry.error_code!, region: entry.region })),
    region_warnings_complete: scanned.every((entry) => entry.status === 'ok'),
  };
}

/**
 * The organization's scan coverage. Throws AwsAccountAmbiguousError when it
 * has more than one eligible AWS account.
 */
export async function readServicesCoverage(db: AwsAccountsQueryable, orgId: string): Promise<ServicesCoverage> {
  // aws_accounts has no RLS: findEligibleAwsAccount filters by organization itself.
  const account = await findEligibleAwsAccount(db, orgId);
  const homeRegion = account ? homeRegionOf(account) : null;
  // The AWS account the scan lease and the region rows are keyed by (scan-session.ts
  // leaseAccountFor): none when the role ARN names no account, so nothing is read for it.
  const awsAccountId = account ? parseAccountIdFromArn(account.role_arn ?? '') ?? null : null;

  const { text, values } = coverageStatement(orgId, homeRegion, awsAccountId);
  const { rows } = await db.query(text, values);
  const row = rows[0];

  const resourceTypes: string[] | null = row.status === null ? null : row.resource_types ?? [];
  const inLastScan = (type: string) => resourceTypes?.includes(type) ?? false;

  // PR 2: only a flagged organization gets the multi_region key; for every other the
  // object below is built exactly as before.
  const multiRegion = (await isMultiRegionDiscoveryOn(db, orgId, '[Services/coverage]'))
    ? { multi_region: await readMultiRegionCoverage(db, orgId, homeRegion, awsAccountId) }
    : {};

  return {
    account: account
      ? { connected: true, status: account.status, home_region: homeRegion }
      : { connected: false, status: null, home_region: null },
    scope: {
      home_region: homeRegion === null ? null : { region: homeRegion, count: row.home_count },
      s3: { in_last_scan: inLastScan('s3'), regions: row.s3_regions },
      cloudfront: { in_last_scan: inLastScan('cloudfront'), count: row.cloudfront_count },
      enabled_regions: {
        known: row.regions_listed_at !== null,
        count: row.regions_listed_at === null ? null : row.enabled_region_count,
        listed_at: row.regions_listed_at,
        stale: row.regions_list_stale,
      },
    },
    region_status: row.region_status.map((entry: RegionStatusJson): RegionCoverage => ({
      region: entry.region,
      home: entry.region === homeRegion,
      status: entry.status,
      last_scan_finished_at: toDate(entry.last_scan_finished_at),
      last_success_at: toDate(entry.last_success_at),
      last_error_code: regionErrorCode(entry.last_error_code),
      consecutive_failures: entry.consecutive_failures,
      stale: entry.stale,
    })),
    scan_in_progress: row.scan_in_progress_since === null ? null : { since: row.scan_in_progress_since },
    last_completed_scan: row.last_completed_completed_at === null
      ? null
      : {
          started_at: row.last_completed_started_at,
          completed_at: row.last_completed_completed_at,
          resource_types: row.last_completed_resource_types ?? [],
          warnings: lastScanWarnings(row.last_completed_warnings, row.last_completed_error_message),
        },
    last_successful_scan_at: row.last_successful_scan_at,
    last_scan: row.status === null
      ? null
      : {
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          warnings: lastScanWarnings(row.warnings, row.error_message),
        },
    resource_types: resourceTypes,
    tags_unknown_by_type: row.tags_unknown_by_type,
    regions: row.regions,
    total: row.total,
    ...multiRegion,
  };
}

// ─── GET /api/services/coverage ──────────────────────────────────────────────
// The organization is the authenticated caller's. Nothing in the query string
// selects a tenant, and the request takes no parameters.

router.get('/', authenticate, requireCurrentMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const coverage = await readServicesCoverage(pool, req.user!.organizationId);
    res.json({ success: true, coverage });
  } catch (err: unknown) {
    if (isAwsAccountAmbiguous(err)) {
      res.status(409).json({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
      return;
    }
    console.error('[Services/coverage]', err);
    res.status(500).json({ success: false, error: 'Failed to load scan coverage' });
  }
});

export default router;
