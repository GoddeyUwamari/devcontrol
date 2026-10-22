/**
 * Typed reads of the multi-region scan foundation tables created by
 * database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql:
 *
 *   aws_account_regions          per (organization, AWS account, region) state
 *   aws_scan_leases, job_leases  leases with fencing tokens
 *   organization_feature_flags   per-organization flags, OFF unless a row says enabled
 *
 * Reads, plus the two writes discovery makes to aws_account_regions: the
 * account's region list (recordRegionList, multi-region M5a) and the home
 * region's scan status (recordHomeRegionScanStatus, M5b). Acquiring,
 * renewing and releasing leases (the fencing-token contract in the migration's
 * header) is implemented with the code that takes them (scan-lease.ts).
 *
 * TENANT ISOLATION is enforced twice, independently: every statement carries an
 * explicit organization predicate, and the tables force row-level security, so
 * the caller's connection must carry app.current_organization_id. Every function
 * takes the caller's executor; none opens a connection of its own.
 */
import { ClientBase, PoolClient } from 'pg';
import { HeldLease, withFencedTransaction } from '../services/scan-lease';
import type { ListedRegion } from '../services/region-list';
import type { HomeRegionScanResult } from '../services/region-scan-status';

/** A connection the caller has already tagged with the organization. */
type Executor = Pick<PoolClient, 'query'>;

/** The flag that will gate multi-region discovery per organization. */
export const MULTI_REGION_DISCOVERY_FLAG = 'multi_region_discovery';

export type RegionScanStatus =
  | 'ok'
  | 'partial'
  | 'denied'
  | 'failed'
  | 'timed_out'
  | 'skipped_locked'
  | 'not_enabled'
  | 'never_scanned';

export interface AccountRegion {
  organizationId: string;
  awsAccountId: string;
  region: string;
  optInStatus: string | null;
  enabled: boolean;
  scanEnabled: boolean;
  firstSeenAt: Date;
  lastListedAt: Date | null;
  disabledAt: Date | null;
  lastScanStartedAt: Date | null;
  lastScanFinishedAt: Date | null;
  lastSuccessAt: Date | null;
  lastScanStatus: RegionScanStatus;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  updatedAt: Date;
}

interface LeaseTiming {
  /** Opaque: compared only by equality. A string because it is a 64-bit value. */
  fencingToken: string;
  holder: string;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  /** released_at IS NULL AND expires_at > now(), evaluated by the database. */
  held: boolean;
}

export interface ScanLease extends LeaseTiming {
  organizationId: string;
  awsAccountId: string;
  scanKind: string;
  jobId: string | null;
}

export interface JobLease extends LeaseTiming {
  organizationId: string;
  jobName: string;
  lastCompletedAt: Date | null;
}

const HELD_SQL = '(released_at IS NULL AND expires_at > now()) AS held';

function mapLeaseTiming(row: any): LeaseTiming {
  return {
    fencingToken: String(row.fencing_token),
    holder: row.holder,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    held: row.held,
  };
}

/**
 * Whether `flag` is ON for the organization. No row means OFF: flags default
 * to off, and only a row with enabled = true turns one on.
 */
export async function isOrganizationFeatureEnabled(
  db: Executor,
  organizationId: string,
  flag: string
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT enabled FROM organization_feature_flags
      WHERE organization_id = $1 AND flag = $2`,
    [organizationId, flag]
  );
  return rows[0]?.enabled === true;
}

/** Every recorded region of one AWS account, by region name. */
export async function listAccountRegions(
  db: Executor,
  organizationId: string,
  awsAccountId: string
): Promise<AccountRegion[]> {
  const { rows } = await db.query(
    `SELECT * FROM aws_account_regions
      WHERE organization_id = $1 AND aws_account_id = $2
      ORDER BY region`,
    [organizationId, awsAccountId]
  );
  return rows.map((row: any) => ({
    organizationId: row.organization_id,
    awsAccountId: row.aws_account_id,
    region: row.region,
    optInStatus: row.opt_in_status,
    enabled: row.enabled,
    scanEnabled: row.scan_enabled,
    firstSeenAt: row.first_seen_at,
    lastListedAt: row.last_listed_at,
    disabledAt: row.disabled_at,
    lastScanStartedAt: row.last_scan_started_at,
    lastScanFinishedAt: row.last_scan_finished_at,
    lastSuccessAt: row.last_success_at,
    lastScanStatus: row.last_scan_status,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    consecutiveFailures: row.consecutive_failures,
    updatedAt: row.updated_at,
  }));
}

/** The lease row for one (organization, AWS account, scan kind), held or not; null if never taken. */
export async function getScanLease(
  db: Executor,
  organizationId: string,
  awsAccountId: string,
  scanKind: string
): Promise<ScanLease | null> {
  const { rows } = await db.query(
    `SELECT *, ${HELD_SQL} FROM aws_scan_leases
      WHERE organization_id = $1 AND aws_account_id = $2 AND scan_kind = $3`,
    [organizationId, awsAccountId, scanKind]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...mapLeaseTiming(row),
    organizationId: row.organization_id,
    awsAccountId: row.aws_account_id,
    scanKind: row.scan_kind,
    jobId: row.job_id,
  };
}

/** The lease row for one (organization, job name), held or not; null if never taken. */
export async function getJobLease(
  db: Executor,
  organizationId: string,
  jobName: string
): Promise<JobLease | null> {
  const { rows } = await db.query(
    `SELECT *, ${HELD_SQL} FROM job_leases
      WHERE organization_id = $1 AND job_name = $2`,
    [organizationId, jobName]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...mapLeaseTiming(row),
    organizationId: row.organization_id,
    jobName: row.job_name,
    lastCompletedAt: row.last_completed_at,
  };
}

/**
 * Records the account's region list (multi-region plan M5a, m5-plan.md §2.5,
 * §3): one row per listed region, in one transaction that starts with the
 * scan lease's commit fence (token and account check, F17). The organization
 * and the AWS account are the lease's, never values from the AWS response.
 *
 * Only the list columns are written: opt_in_status, enabled, last_listed_at
 * (one value for every row of this list, the transaction's now()),
 * disabled_at, updated_at; first_seen_at and every scan column keep their
 * defaults on insert and their values on update. disabled_at is set when a
 * region that was enabled is listed as not enabled, cleared when it is listed
 * as enabled again, and otherwise kept.
 *
 * No row is ever deleted: a region missing from this list keeps its row and
 * its older last_listed_at, which is how readers tell it is not in the
 * latest list. Throws as the fence does (LeaseLostError, AwsAccountAmbiguousError);
 * the transaction then writes nothing. Returns the number of rows written.
 */
export async function recordRegionList(client: ClientBase, lease: HeldLease, regions: readonly ListedRegion[]): Promise<number> {
  if (lease.key.table !== 'aws_scan_leases') throw new Error('recordRegionList: a scan lease is required');
  const { organizationId, awsAccountId } = lease.key;
  return withFencedTransaction(client, lease, async () => {
    const result = await client.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at)
       SELECT $1, $2, r.region, r.opt_in_status, r.enabled, now()
         FROM unnest($3::text[], $4::text[], $5::boolean[]) AS r(region, opt_in_status, enabled)
       ON CONFLICT (organization_id, aws_account_id, region) DO UPDATE
         SET opt_in_status = EXCLUDED.opt_in_status,
             enabled = EXCLUDED.enabled,
             last_listed_at = EXCLUDED.last_listed_at,
             disabled_at = CASE
               WHEN EXCLUDED.enabled THEN NULL
               WHEN aws_account_regions.enabled THEN now()
               ELSE aws_account_regions.disabled_at
             END,
             updated_at = now()`,
      [
        organizationId,
        awsAccountId,
        regions.map((r) => r.region),
        regions.map((r) => r.optInStatus),
        regions.map((r) => r.enabled),
      ]
    );
    return result.rowCount ?? 0;
  });
}

/**
 * Records the home region's scan status (multi-region plan M5b, m5-plan.md
 * §13) on its existing row, in one transaction that starts with the scan
 * lease's commit fence (token and account check, F18). The organization and
 * the AWS account are the lease's.
 *
 * Only the scan columns are written: last_scan_status, last_error_code,
 * last_scan_started_at (the job's own started_at), last_scan_finished_at,
 * last_success_at (now() for `ok`; every other status keeps the previous
 * value), consecutive_failures (0 for `ok`, +1 for a failure, kept for
 * `partial`), updated_at. The list columns and last_error_message are never
 * written; no row is inserted or deleted. A row whose last scan started after
 * this scan's job is left as it is, so an older scan never overwrites a newer
 * one's status.
 *
 * Returns the number of rows written: 0 when the home region has no row (its
 * list was never stored) or a newer scan's status is already there. Throws as
 * the fence does (LeaseLostError, AwsAccountAmbiguousError); the transaction
 * then writes nothing.
 */
export async function recordHomeRegionScanStatus(
  client: ClientBase,
  lease: HeldLease,
  scan: { region: string; jobId: string; result: HomeRegionScanResult }
): Promise<number> {
  if (lease.key.table !== 'aws_scan_leases') throw new Error('recordHomeRegionScanStatus: a scan lease is required');
  const { organizationId, awsAccountId } = lease.key;
  return withFencedTransaction(client, lease, async () => {
    const result = await client.query(
      `UPDATE aws_account_regions r
          SET last_scan_status = $5::text,
              last_error_code = $6,
              last_scan_started_at = j.started_at,
              last_scan_finished_at = now(),
              last_success_at = CASE WHEN $5::text = 'ok' THEN now() ELSE r.last_success_at END,
              consecutive_failures = CASE
                WHEN $5::text = 'ok' THEN 0
                WHEN $5::text = 'partial' THEN r.consecutive_failures
                ELSE r.consecutive_failures + 1
              END,
              updated_at = now()
         FROM resource_discovery_jobs j
        WHERE r.organization_id = $1 AND r.aws_account_id = $2 AND r.region = $3
          AND j.id = $4 AND j.organization_id = $1
          AND (r.last_scan_started_at IS NULL OR r.last_scan_started_at <= j.started_at)`,
      [organizationId, awsAccountId, scan.region, scan.jobId, scan.result.status, scan.result.errorCode]
    );
    return result.rowCount ?? 0;
  });
}
