/**
 * Typed reads of the multi-region scan foundation tables created by
 * database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql:
 *
 *   aws_account_regions          per (organization, AWS account, region) state
 *   aws_scan_leases, job_leases  leases with fencing tokens
 *   organization_feature_flags   per-organization flags, OFF unless a row says enabled
 *
 * Nothing calls these yet. Read-only on purpose: acquiring, renewing and
 * releasing leases (the fencing-token contract in the migration's header) is
 * implemented with the code that takes them.
 *
 * TENANT ISOLATION is enforced twice, independently: every statement carries an
 * explicit organization predicate, and the tables force row-level security, so
 * the caller's connection must carry app.current_organization_id. Every function
 * takes the caller's executor; none opens a connection of its own.
 */
import { PoolClient } from 'pg';

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
