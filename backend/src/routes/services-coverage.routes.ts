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
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  splitDiscoveryMessage,
} from '../services/discovery-warnings';
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
