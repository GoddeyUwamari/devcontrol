/**
 * aws_connection_checks (AWS connect PR D1, admin migration
 * 202611111200_create_aws_connection_checks.sql): one row per aws_accounts row,
 * holding the connection's health (connection-health.ts), the role's unique ID,
 * the saved permission probes, the policy-set compare, the per-source outcome of
 * the latest scan, and the owner's Check again cooldown.
 *
 * Postgres-owned with row level security forced: every statement runs on a
 * connection tagged for the organization (the fences below set the tag LOCAL;
 * request reads are tagged by the request lifecycle). devcontrol has SELECT,
 * INSERT and UPDATE only.
 *
 * Writes:
 *   - are fenced with the connection identity the work started with
 *     (aws-connection-fence.ts), or run inside the scan's lease fence, so work
 *     for a connection that is no longer the active one writes nothing;
 *   - are monotonic: each one carries the time of the evidence it records and
 *     never replaces newer evidence;
 *   - are fail-soft where a caller says so (recordAssumeOutcomeSoft): a missing
 *     table (the migration not applied yet, D1-D13) or any database failure is
 *     logged by name and never fails a scan or a connect.
 */
import type { ClientBase } from 'pg';
import { pool as defaultPool } from '../config/database';
import { withConnectionFence, isConnectionChanged, type FenceConnectionSource } from '../services/aws-connection-fence';
import {
  EMPTY_HEALTH,
  displayHealth,
  nextHealth,
  type AssumeAttempt,
  type AssumeResult,
  type HealthDisplay,
  type HealthRow,
} from '../services/connection-health';
import type { PolicyCompareResult } from '../services/connect-policy-compare';
import type { PermissionCheckEntry } from '../services/connect-permission-check';
import type { SourceStatus } from '../services/source-outcome';

export const AWS_CONNECTION_CHECKS_TABLE = 'aws_connection_checks';

/** Check again may start at most once per connection in this window (D1-D6). */
export const CHECK_AGAIN_COOLDOWN_MS = 5 * 60 * 1000;

/** A scan's AccessDenied compares the policies at most this often (D1-D9). */
export const SCAN_POLICY_COMPARE_MIN_INTERVAL_MS = 60 * 60 * 1000;

export type PermissionTrigger = 'connect' | 'check_again';
export type PolicyTrigger = 'connect' | 'check_again' | 'scan_access_denied' | 'role_replaced';
export type RoleIdSource = 'connect' | 'scan' | 'check_again';

/** The 8 listing sources whose outcome a scan saves (D1-D10), and the action each one's listing calls. */
export const SAVED_SCAN_SOURCES: Readonly<Record<string, string>> = {
  ec2: 'ec2:DescribeInstances',
  ebs: 'ec2:DescribeVolumes',
  rds: 'rds:DescribeDBInstances',
  s3: 's3:ListAllMyBuckets',
  lambda: 'lambda:ListFunctions',
  'load-balancer': 'elasticloadbalancing:DescribeLoadBalancers',
  cloudfront: 'cloudfront:ListDistributions',
  'resource-explorer': 'resource-explorer-2:Search',
};

export interface ConnectionChecksRow extends HealthRow {
  aws_account_id: string;
  organization_id: string;
  role_unique_id: string | null;
  role_unique_id_source: RoleIdSource | null;
  role_unique_id_recorded_at: Date | null;
  role_replaced_at: Date | null;
  permission_results: PermissionCheckEntry[] | null;
  permission_checked_at: Date | null;
  permission_trigger: PermissionTrigger | null;
  policy_result: PolicyCompareResult | null;
  policy_checked_at: Date | null;
  policy_trigger: PolicyTrigger | null;
  policy_contract_version: number | null;
  scan_sources: Record<string, SourceStatus> | null;
  scan_sources_job_id: string | null;
  scan_sources_at: Date | null;
  check_again_started_at: Date | null;
}

type Db = Pick<ClientBase, 'query'>;

/** PostgreSQL's undefined_table: the migration is not applied yet. */
export function isChecksTableMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '42P01';
}

const COLUMNS = `aws_account_id, organization_id, last_attempt_at, last_attempt_result, last_conclusive_at, last_ok_at,
  health_state, failing_since, lost_at, consecutive_role_failures, role_unique_id, role_unique_id_source,
  role_unique_id_recorded_at, role_replaced_at, permission_results, permission_checked_at, permission_trigger,
  policy_result, policy_checked_at, policy_trigger, policy_contract_version, scan_sources, scan_sources_job_id,
  scan_sources_at, check_again_started_at`;

/** The row of the connection, or null. Reads with the caller's (tagged) connection. */
export async function readConnectionChecks(db: Db, organizationId: string, awsAccountRowId: string): Promise<ConnectionChecksRow | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM aws_connection_checks WHERE organization_id = $1 AND aws_account_id = $2`,
    [organizationId, awsAccountRowId]
  );
  return (rows[0] as ConnectionChecksRow | undefined) ?? null;
}

/** The row, or null when there is none or the table does not exist yet. Other failures throw. */
export async function readConnectionChecksOrNull(db: Db, organizationId: string, awsAccountRowId: string): Promise<ConnectionChecksRow | null> {
  try {
    return await readConnectionChecks(db, organizationId, awsAccountRowId);
  } catch (error: unknown) {
    if (isChecksTableMissing(error)) return null;
    throw error;
  }
}

async function ensureRow(db: Db, organizationId: string, awsAccountRowId: string): Promise<void> {
  await db.query(
    `INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2) ON CONFLICT (aws_account_id) DO NOTHING`,
    [awsAccountRowId, organizationId]
  );
}

async function lockRow(db: Db, organizationId: string, awsAccountRowId: string): Promise<ConnectionChecksRow> {
  await ensureRow(db, organizationId, awsAccountRowId);
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM aws_connection_checks WHERE organization_id = $1 AND aws_account_id = $2 FOR UPDATE`,
    [organizationId, awsAccountRowId]
  );
  if (!rows[0]) throw new Error('aws_connection_checks: the row is not visible to this organization');
  return rows[0] as ConnectionChecksRow;
}

export interface AssumeOutcome {
  attempt: AssumeAttempt;
  /** From the AssumeRole response; only for a successful attempt. */
  roleUniqueId?: string | null;
  /** Who recorded it: connect and Check again set the role ID baseline; a scan compares with it. */
  source: RoleIdSource;
}

export interface AssumeOutcomeWritten {
  /** False when the attempt was older than the recorded one (nothing changed). */
  written: boolean;
  /** True only when THIS write first saw a different role ID (D1-D7: a policy compare follows). */
  roleReplacedNow: boolean;
}

/**
 * Applies one AssumeRole outcome to the row, inside the caller's open
 * transaction on a tagged connection (the connect INSERT's transaction, or a
 * connection fence). Database statements only.
 */
export async function applyAssumeOutcome(db: Db, organizationId: string, awsAccountRowId: string, outcome: AssumeOutcome): Promise<AssumeOutcomeWritten> {
  const row = await lockRow(db, organizationId, awsAccountRowId);
  const prev: HealthRow = {
    last_attempt_at: row.last_attempt_at,
    last_attempt_result: row.last_attempt_result,
    last_conclusive_at: row.last_conclusive_at,
    last_ok_at: row.last_ok_at,
    health_state: row.health_state,
    failing_since: row.failing_since,
    lost_at: row.lost_at,
    consecutive_role_failures: row.consecutive_role_failures ?? 0,
  };
  const next = nextHealth(row.health_state || row.last_attempt_at ? prev : EMPTY_HEALTH, outcome.attempt);
  if (!next) return { written: false, roleReplacedNow: false };

  let roleId = row.role_unique_id;
  let roleIdSource = row.role_unique_id_source;
  let roleIdAt = row.role_unique_id_recorded_at;
  let replacedAt = row.role_replaced_at;
  let roleReplacedNow = false;
  const seen = outcome.attempt.result === 'ok' ? outcome.roleUniqueId ?? null : null;
  if (seen) {
    if (outcome.source !== 'scan' || !roleId) {
      // connect and Check again set the baseline (and clear a replacement notice); a
      // scan records one only when none exists (connections from before D1).
      roleId = seen;
      roleIdSource = outcome.source;
      roleIdAt = outcome.attempt.at;
      if (outcome.source !== 'scan') replacedAt = null;
    } else if (seen !== roleId && !replacedAt) {
      replacedAt = outcome.attempt.at;
      roleReplacedNow = true;
    }
  }

  await db.query(
    `UPDATE aws_connection_checks
        SET last_attempt_at = $3, last_attempt_result = $4, last_conclusive_at = $5, last_ok_at = $6,
            health_state = $7, failing_since = $8, lost_at = $9, consecutive_role_failures = $10,
            role_unique_id = $11, role_unique_id_source = $12, role_unique_id_recorded_at = $13, role_replaced_at = $14,
            updated_at = now()
      WHERE organization_id = $1 AND aws_account_id = $2`,
    [
      organizationId, awsAccountRowId,
      next.last_attempt_at, next.last_attempt_result, next.last_conclusive_at, next.last_ok_at,
      next.health_state, next.failing_since, next.lost_at, next.consecutive_role_failures,
      roleId, roleIdSource, roleIdAt, replacedAt,
    ]
  );
  return { written: true, roleReplacedNow };
}

/** applyAssumeOutcome in its own connection fence (`identity` = the connection the attempt used). */
export async function recordAssumeOutcome(
  organizationId: string,
  identity: string,
  awsAccountRowId: string,
  outcome: AssumeOutcome,
  source: FenceConnectionSource = defaultPool
): Promise<AssumeOutcomeWritten> {
  return withConnectionFence(source, organizationId, identity, (client) => applyAssumeOutcome(client, organizationId, awsAccountRowId, outcome));
}

/** Logs a failed health or check write by name only: never the row, the ID or an AWS value. */
export function logChecksWriteFailure(what: string, organizationId: string, error: unknown): void {
  const name = isConnectionChanged(error) ? 'connection_changed' : isChecksTableMissing(error) ? 'table_missing' : error instanceof Error ? error.name : 'unknown error';
  console.warn(`[Connection checks] ${what} not recorded for org ${organizationId} (${name})`);
}

/** recordAssumeOutcome that never throws (scans and connect): a failure is logged and reported as not written. */
export async function recordAssumeOutcomeSoft(
  organizationId: string,
  identity: string,
  awsAccountRowId: string,
  outcome: AssumeOutcome,
  source: FenceConnectionSource = defaultPool
): Promise<AssumeOutcomeWritten> {
  try {
    return await recordAssumeOutcome(organizationId, identity, awsAccountRowId, outcome, source);
  } catch (error: unknown) {
    logChecksWriteFailure('assume outcome', organizationId, error);
    return { written: false, roleReplacedNow: false };
  }
}

/**
 * What a connect or a Check again found, saved in ONE fenced transaction, so a
 * connection that changed meanwhile gets none of it (ConnectionChangedError):
 * the AssumeRole outcome (Check again only; connect records it in its INSERT's
 * transaction), the six probes and the policy compare. Each part is kept only
 * if no newer one is saved.
 */
export async function saveCheckResults(
  organizationId: string,
  identity: string,
  awsAccountRowId: string,
  found: {
    outcome?: AssumeOutcome;
    permission?: { checks: PermissionCheckEntry[]; at: Date; trigger: PermissionTrigger };
    policy?: { result: PolicyCompareResult; at: Date; trigger: PolicyTrigger };
  },
  source: FenceConnectionSource = defaultPool
): Promise<void> {
  await withConnectionFence(source, organizationId, identity, async (client) => {
    if (found.outcome) await applyAssumeOutcome(client, organizationId, awsAccountRowId, found.outcome);
    else await ensureRow(client, organizationId, awsAccountRowId);
    if (found.permission) {
      await client.query(
        `UPDATE aws_connection_checks
            SET permission_results = $3::jsonb, permission_checked_at = $4, permission_trigger = $5, updated_at = now()
          WHERE organization_id = $1 AND aws_account_id = $2
            AND (permission_checked_at IS NULL OR permission_checked_at <= $4)`,
        [organizationId, awsAccountRowId, JSON.stringify(found.permission.checks.map(({ action, status }) => ({ action, status }))), found.permission.at, found.permission.trigger]
      );
    }
    if (found.policy) await updatePolicy(client, organizationId, awsAccountRowId, found.policy);
  });
}

async function updatePolicy(client: Db, organizationId: string, awsAccountRowId: string, saved: { result: PolicyCompareResult; at: Date; trigger: PolicyTrigger }): Promise<number> {
  const result = await client.query(
    `UPDATE aws_connection_checks
        SET policy_result = $3::jsonb, policy_checked_at = $4, policy_trigger = $5, policy_contract_version = $6, updated_at = now()
      WHERE organization_id = $1 AND aws_account_id = $2
        AND (policy_checked_at IS NULL OR policy_checked_at <= $4)`,
    [organizationId, awsAccountRowId, JSON.stringify(saved.result), saved.at, saved.trigger, saved.result.contractVersion]
  );
  return result.rowCount ?? 0;
}

/** Saves a policy compare, unless a newer one is saved. */
export async function savePolicyResult(
  organizationId: string,
  identity: string,
  awsAccountRowId: string,
  saved: { result: PolicyCompareResult; at: Date; trigger: PolicyTrigger },
  source: FenceConnectionSource = defaultPool
): Promise<boolean> {
  return withConnectionFence(source, organizationId, identity, async (client) => {
    await ensureRow(client, organizationId, awsAccountRowId);
    return (await updatePolicy(client, organizationId, awsAccountRowId, saved)) > 0;
  });
}

/**
 * Saves a scan's per-source outcomes, inside the scan's own fenced transaction
 * (the caller runs it through LeaseSession.fenced). Only the saved sources are
 * kept; an older scan never replaces a newer one's.
 */
export async function saveScanSources(
  client: Db,
  organizationId: string,
  awsAccountRowId: string,
  scan: { outcomes: readonly { source: string; status: SourceStatus }[]; jobId: string; at: Date }
): Promise<boolean> {
  const sources: Record<string, SourceStatus> = {};
  for (const outcome of scan.outcomes) if (outcome.source in SAVED_SCAN_SOURCES) sources[outcome.source] = outcome.status;
  await ensureRow(client, organizationId, awsAccountRowId);
  const result = await client.query(
    `UPDATE aws_connection_checks
        SET scan_sources = $3::jsonb, scan_sources_job_id = $4, scan_sources_at = $5, updated_at = now()
      WHERE organization_id = $1 AND aws_account_id = $2
        AND (scan_sources_at IS NULL OR scan_sources_at <= $5)`,
    [organizationId, awsAccountRowId, JSON.stringify(sources), scan.jobId, scan.at]
  );
  return (result.rowCount ?? 0) > 0;
}

export type CheckAgainClaim = { ok: true } | { ok: false; availableAt: Date };

/**
 * Claims the Check again cooldown for the connection (D1-D6), fenced: at most
 * one start per CHECK_AGAIN_COOLDOWN_MS across every process, decided by the
 * database clock in one statement. The claim stands whatever the check then finds.
 */
export async function claimCheckAgain(
  organizationId: string,
  identity: string,
  awsAccountRowId: string,
  source: FenceConnectionSource = defaultPool
): Promise<CheckAgainClaim> {
  return withConnectionFence(source, organizationId, identity, async (client) => {
    await ensureRow(client, organizationId, awsAccountRowId);
    const claimed = await client.query(
      `UPDATE aws_connection_checks
          SET check_again_started_at = now(), updated_at = now()
        WHERE organization_id = $1 AND aws_account_id = $2
          AND (check_again_started_at IS NULL OR check_again_started_at <= now() - make_interval(secs => $3::double precision / 1000))
        RETURNING check_again_started_at`,
      [organizationId, awsAccountRowId, CHECK_AGAIN_COOLDOWN_MS]
    );
    if ((claimed.rowCount ?? 0) > 0) return { ok: true } as const;
    const { rows } = await client.query(
      `SELECT check_again_started_at + make_interval(secs => $3::double precision / 1000) AS available_at
         FROM aws_connection_checks WHERE organization_id = $1 AND aws_account_id = $2`,
      [organizationId, awsAccountRowId, CHECK_AGAIN_COOLDOWN_MS]
    );
    return { ok: false, availableAt: new Date(rows[0].available_at) } as const;
  });
}

/** Whether a scan's AccessDenied may compare the policies now (D1-D9). */
export function scanCompareDue(row: Pick<ConnectionChecksRow, 'policy_checked_at'> | null, now: Date): boolean {
  return !row?.policy_checked_at || now.getTime() - new Date(row.policy_checked_at).getTime() >= SCAN_POLICY_COMPARE_MIN_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// What the API returns (GET /api/aws/accounts/checks): fixed verdicts and dates only.
// Never the role ID, a policy document, inline policy names or customer-managed ARNs.
// ---------------------------------------------------------------------------

export interface ConnectionChecksView {
  health: HealthDisplay;
  roleReplacedAt: string | null;
  permissionCheck: { checks: PermissionCheckEntry[]; checkedAt: string; trigger: PermissionTrigger } | null;
  policyCheck: (PolicyCompareResult & { checkedAt: string; trigger: PolicyTrigger }) | null;
  refusedSources: { scannedAt: string; sources: { source: string; action: string }[] } | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

const PERMISSION_STATUSES = new Set(['verified', 'denied', 'not_verified']);

export function connectionChecksView(row: ConnectionChecksRow | null, now: Date): ConnectionChecksView {
  const health = displayHealth(
    row
      ? {
          last_attempt_at: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
          last_attempt_result: row.last_attempt_result as AssumeResult | null,
          last_conclusive_at: row.last_conclusive_at ? new Date(row.last_conclusive_at) : null,
          last_ok_at: row.last_ok_at ? new Date(row.last_ok_at) : null,
          health_state: row.health_state,
          failing_since: row.failing_since ? new Date(row.failing_since) : null,
          lost_at: row.lost_at ? new Date(row.lost_at) : null,
          consecutive_role_failures: row.consecutive_role_failures ?? 0,
        }
      : null,
    now
  );
  const permissionCheck =
    row?.permission_results && row.permission_checked_at && Array.isArray(row.permission_results)
      ? {
          checks: row.permission_results
            .filter((c) => c && typeof c.action === 'string' && PERMISSION_STATUSES.has(c.status))
            .map(({ action, status }) => ({ action, status })),
          checkedAt: iso(row.permission_checked_at)!,
          trigger: row.permission_trigger as PermissionTrigger,
        }
      : null;
  const policy = row?.policy_result;
  const policyCheck =
    policy && row?.policy_checked_at
      ? policy.unreadable
        ? { unreadable: true as const, contractVersion: policy.contractVersion, checkedAt: iso(row.policy_checked_at)!, trigger: row.policy_trigger as PolicyTrigger }
        : {
            unreadable: false as const,
            securityAudit: policy.securityAudit,
            viewOnlyAccess: policy.viewOnlyAccess,
            readExtras: policy.readExtras,
            readOnlyAccess: policy.readOnlyAccess,
            otherAwsManaged: policy.otherAwsManaged,
            otherCount: policy.otherCount,
            contractVersion: policy.contractVersion,
            checkedAt: iso(row.policy_checked_at)!,
            trigger: row.policy_trigger as PolicyTrigger,
          }
      : null;
  const refusedSources =
    row?.scan_sources && row.scan_sources_at
      ? {
          scannedAt: iso(row.scan_sources_at)!,
          sources: Object.keys(SAVED_SCAN_SOURCES)
            .filter((source) => row.scan_sources?.[source] === 'denied')
            .map((source) => ({ source, action: SAVED_SCAN_SOURCES[source] })),
        }
      : null;
  return { health, roleReplacedAt: iso(row?.role_replaced_at ?? null), permissionCheck, policyCheck, refusedSources };
}
