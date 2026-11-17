/**
 * Changing an AWS account's home region (home region HR-1, home-region-step1.md
 * §C-§D, founder decisions HR-D1..HR-D22, Nov 16).
 *
 * The home region is aws_accounts.region (HR-D1). It decides where discovery
 * scans with multi-region off, and where cost savings, Operational Health and
 * Security Hub run in every case. Only the organization's owner changes it, by
 * one request; nothing else writes it (no scan, no proposal: HR-D6, §E).
 *
 * Validation (before any lock, and again inside the change transaction):
 *   - a syntactically valid region code other than the current home region;
 *   - the account's stored region list is known, and lists the region as
 *     enabled and not excluded by the allow-list (HR-D9; region-list.ts refuses
 *     a list whose home region is not enabled, and an excluded home region would
 *     read "excluded" on the Services page);
 *   - no discovery scan (or Analyze) holds the account's scan lease and the
 *     discovery cron's job lease is not held (HR-D8): a change would interrupt
 *     them, so it is refused with SCAN_IN_PROGRESS instead.
 *
 * The change is ONE transaction (§D.0) on its own connection, under the
 * organization's connection lock taken EXCLUSIVE (withConnectionChange): every
 * fenced write in flight finishes first, and every one after it sees the new
 * connection identity (the identity includes the home region,
 * aws-accounts.repository.ts awsConnectionIdentity), so caches keyed by it miss
 * and work started for the old home region writes nothing. Inside it:
 *   1. the eligible row is read again and must be the one validated;
 *   2. the region list and both leases are checked again;
 *   3. UPDATE aws_accounts ... compare-and-set on the old raw region;
 *   4. the old home region's ACTIVE cost recommendations of the 8 home-scoped
 *      issues are deleted (HR-D11): every scan's reconcile only ever reaches the
 *      current home region, so they would otherwise stay in every savings total
 *      and swallow new-home findings with the same resource id. Each removed
 *      row's issue, resource id and region go into the audit event, which is
 *      their history (founder decision Nov 16: audit event only). RESOLVED and
 *      DISMISSED rows (decisions) are never touched (HR-D12), and neither are
 *      rows with no region or of other issues;
 *   5. the connection's home-region proposal, if one is open, is marked
 *      accepted (the same region) or superseded (another region); an open
 *      split-spend prompt is marked accepted (the owner chose);
 *   6. the audit event aws_account.home_region_changed: { from, to }, the
 *      counts per issue and the removed findings.
 * After commit the caller starts a scan in the new home region.
 *
 * The cost step needs no reconciliation lock: reconcile's writes take the
 * connection lock SHARED first thing (beginFenced), so they wait for this
 * transaction, and a Resolve/Dismiss racing it either commits first (the row is
 * then not ACTIVE and is not deleted) or finds no row. Counts come from DELETE
 * ... RETURNING: exactly the rows removed.
 */
import type { PoolClient } from 'pg';
import { pool as defaultPool } from '../config/database';
import {
  AwsAccountRow,
  type AwsAccountsQueryable,
  findEligibleAwsAccount,
  homeRegionOf,
  isAwsAccountAmbiguous,
} from '../repositories/aws-accounts.repository';
import {
  MULTI_REGION_DISCOVERY_FLAG,
  getJobLease,
  getScanLease,
  isOrganizationFeatureEnabled,
  listAccountRegions,
  type AccountRegion,
} from '../repositories/multi-region-foundation.repository';
import { HOME_REGION_SCOPED_ISSUE_LIST } from '../repositories/cost-recommendations.repository';
import { insertAuditEventInTransaction, type AuditRequestContext } from './auditEvents.service';
import { withConnectionChange, type FenceConnectionSource } from './aws-connection-fence';
import { DISCOVERY_JOB_NAME, SCAN_KIND_DISCOVERY } from './scan-session';
import { parseAccountIdFromArn } from '../utils/awsAccountId';
import { MAX_REGION_NAME_LENGTH, REGION_NAME_PATTERN } from './region-list';

/** A region code as aws_account_regions stores one (its CHECK; region-list.ts). */
export function isRegionCode(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_REGION_NAME_LENGTH && REGION_NAME_PATTERN.test(value);
}

/** At most this many removed findings are listed in the audit event; the counts are always complete. */
export const AUDIT_REMOVED_FINDINGS_LIMIT = 500;

/** Why a change (or its preview) is refused. Codes only: the page owns the words (PR 3). */
export type HomeRegionRefusal =
  | 'invalid_region'
  | 'unchanged'
  | 'not_connected'
  | 'ambiguous'
  | 'region_list_unknown'
  | 'region_not_enabled'
  | 'region_excluded'
  | 'scan_in_progress'
  | 'connection_changed'
  | 'busy';

export const REFUSAL_RESPONSES: Record<HomeRegionRefusal, { status: number; code: string }> = {
  invalid_region: { status: 400, code: 'INVALID_REGION' },
  unchanged: { status: 400, code: 'HOME_REGION_UNCHANGED' },
  not_connected: { status: 409, code: 'AWS_NOT_CONNECTED' },
  ambiguous: { status: 409, code: 'AWS_ACCOUNT_AMBIGUOUS' },
  region_list_unknown: { status: 409, code: 'REGION_LIST_UNKNOWN' },
  region_not_enabled: { status: 422, code: 'REGION_NOT_ENABLED' },
  region_excluded: { status: 422, code: 'REGION_EXCLUDED' },
  scan_in_progress: { status: 409, code: 'SCAN_IN_PROGRESS' },
  connection_changed: { status: 409, code: 'CONNECTION_CHANGED' },
  busy: { status: 503, code: 'HOME_REGION_CHANGE_BUSY' },
};

export class HomeRegionChangeRefusedError extends Error {
  constructor(readonly refusal: HomeRegionRefusal) {
    super(`HOME_REGION_CHANGE_REFUSED: ${refusal}`);
    this.name = 'HomeRegionChangeRefusedError';
  }
}

export function isHomeRegionChangeRefused(error: unknown): error is HomeRegionChangeRefusedError {
  return error instanceof HomeRegionChangeRefusedError;
}

/** PostgreSQL's lock_not_available: the connection lock could not be taken in time. */
const LOCK_NOT_AVAILABLE = '55P03';

type Db = Pick<PoolClient, 'query'>;

/** Counts of the old home region's ACTIVE home-scoped cost findings, per issue (only issues with at least one). */
export interface CostFindingCounts {
  total: number;
  by_issue: Record<string, number>;
}

/** One region of the account's stored list, as the change dialog lists it. */
export interface SelectableRegion {
  region: string;
  opt_in_status: string | null;
  current: boolean;
  /** Null when the region can be chosen; otherwise why not. */
  refusal: 'region_not_enabled' | 'region_excluded' | null;
}

export interface HomeRegionPreview {
  current_home_region: string;
  multi_region: boolean;
  scan_in_progress: boolean;
  /** The account's stored region list (empty until the first scan records it), by region name. */
  regions: SelectableRegion[];
  /** Present when a target region was asked about. */
  target?: {
    region: string;
    /** Null when a change to it would be accepted now. */
    refusal: HomeRegionRefusal | null;
    /** The old home region's ACTIVE home-scoped cost findings that would leave the totals (HR-S13). */
    cost_findings_leaving: CostFindingCounts;
    /**
     * Multi-region off: the regional resources stored in the old home region that
     * stay listed, no longer scanned (HR-D13). Null with multi-region on (the old
     * home region is still scanned).
     */
    resources_kept_in_old_region: number | null;
  };
}

export interface HomeRegionChangeResult {
  from: string;
  to: string;
  /** proposal: the proposed region was confirmed; split_choice: the owner chose after a split-spend prompt; manual: neither. */
  source: 'proposal' | 'split_choice' | 'manual';
  cost_findings_removed: CostFindingCounts;
}

/** The pieces a decision is made from, read on one tagged connection. */
interface ChangeState {
  regions: AccountRegion[];
  multiRegion: boolean;
  scanInProgress: boolean;
}

async function readState(db: Db, organizationId: string, awsAccountId: string): Promise<ChangeState> {
  const regions = await listAccountRegions(db, organizationId, awsAccountId);
  const multiRegion = await isOrganizationFeatureEnabled(db, organizationId, MULTI_REGION_DISCOVERY_FLAG);
  const scanLease = await getScanLease(db, organizationId, awsAccountId, SCAN_KIND_DISCOVERY);
  const jobLease = await getJobLease(db, organizationId, DISCOVERY_JOB_NAME);
  return { regions, multiRegion, scanInProgress: scanLease?.held === true || jobLease?.held === true };
}

/** Whether `region` may become the home region of an account whose home region is `current`. Null: yes. */
export function refusalFor(region: string, current: string, state: ChangeState): HomeRegionRefusal | null {
  if (!isRegionCode(region)) return 'invalid_region';
  if (region === current) return 'unchanged';
  if (state.regions.length === 0) return 'region_list_unknown';
  const row = state.regions.find((r) => r.region === region);
  if (!row || !row.enabled) return 'region_not_enabled';
  if (!row.scanEnabled) return 'region_excluded';
  if (state.scanInProgress) return 'scan_in_progress';
  return null;
}

/** `fn` on a connection of its own, tagged with the organization (row level security), untagged before it goes back. */
async function onTagged<T>(source: FenceConnectionSource, organizationId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await source.connect();
  let releaseError: Error | undefined;
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
    return await fn(client);
  } finally {
    try {
      await client.query("SELECT set_config('app.current_organization_id', '', false)");
    } catch (error: unknown) {
      releaseError = error instanceof Error ? error : new Error(String(error));
    }
    client.release(releaseError);
  }
}

/** The 12-digit AWS account of the row, or null. */
function awsAccountIdOf(account: AwsAccountRow): string | null {
  return parseAccountIdFromArn(account.role_arn ?? '') ?? null;
}

async function eligibleAccount(source: FenceConnectionSource, organizationId: string): Promise<AwsAccountRow> {
  let account: AwsAccountRow | null;
  try {
    account = await onTagged(source, organizationId, (client) => findEligibleAwsAccount(client, organizationId));
  } catch (error: unknown) {
    if (isAwsAccountAmbiguous(error)) throw new HomeRegionChangeRefusedError('ambiguous');
    throw error;
  }
  if (!account || !awsAccountIdOf(account)) throw new HomeRegionChangeRefusedError('not_connected');
  return account;
}

const SCOPED_PREDICATE = `organization_id = $1 AND status = 'ACTIVE' AND issue = ANY($2::varchar[]) AND aws_region = $3`;

async function countLeaving(db: Db, organizationId: string, oldHome: string): Promise<CostFindingCounts> {
  const { rows } = await db.query(
    `SELECT issue, count(*)::int AS n FROM cost_recommendations WHERE ${SCOPED_PREDICATE} GROUP BY issue ORDER BY issue`,
    [organizationId, [...HOME_REGION_SCOPED_ISSUE_LIST], oldHome]
  );
  return countsOf(rows.map((row: { issue: string; n: number }) => ({ issue: row.issue, n: row.n })));
}

function countsOf(entries: Array<{ issue: string; n: number }>): CostFindingCounts {
  const by_issue: Record<string, number> = {};
  let total = 0;
  for (const { issue, n } of entries) {
    by_issue[issue] = (by_issue[issue] ?? 0) + n;
    total += n;
  }
  return { total, by_issue };
}

/**
 * Regional resources stored in `region` (not S3, which is account-wide, nor anything
 * terminated). The dialog's resources_kept_in_old_region, and (PR 3c, G2b) the
 * coverage's account.previous_home_region_resources: one definition, one number.
 */
export async function regionalResourcesIn(db: AwsAccountsQueryable, organizationId: string, region: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM aws_resources
      WHERE organization_id = $1 AND region = $2 AND resource_type <> 's3' AND status IS DISTINCT FROM 'terminated'`,
    [organizationId, region]
  );
  return rows[0].n;
}

/**
 * What the change dialog shows (PR 3): the stored region list with what can be
 * chosen, whether a scan is running, and, for a target region, whether a change
 * would be accepted and what it would remove or leave behind. Reads only.
 */
export async function previewHomeRegionChange(
  organizationId: string,
  targetRegion: string | undefined,
  source: FenceConnectionSource = defaultPool
): Promise<HomeRegionPreview> {
  const account = await eligibleAccount(source, organizationId);
  const current = homeRegionOf(account);
  const awsAccountId = awsAccountIdOf(account)!;
  return onTagged(source, organizationId, async (client) => {
    const state = await readState(client, organizationId, awsAccountId);
    const preview: HomeRegionPreview = {
      current_home_region: current,
      multi_region: state.multiRegion,
      scan_in_progress: state.scanInProgress,
      regions: state.regions.map((r) => ({
        region: r.region,
        opt_in_status: r.optInStatus ?? null,
        current: r.region === current,
        refusal: !r.enabled ? 'region_not_enabled' : !r.scanEnabled ? 'region_excluded' : null,
      })),
    };
    if (targetRegion !== undefined) {
      preview.target = {
        region: targetRegion,
        refusal: refusalFor(targetRegion, current, state),
        cost_findings_leaving: await countLeaving(client, organizationId, current),
        resources_kept_in_old_region: state.multiRegion ? null : await regionalResourcesIn(client, organizationId, current),
      };
    }
    return preview;
  });
}

/**
 * Settles an open proposal or split-spend prompt; says how the change was decided:
 * proposal (the proposed region), split_choice (after a split prompt) or manual
 * (nothing open, another region, or the HR-0 columns not there yet).
 */
async function settleProposal(client: Db, organizationId: string, awsAccountRowId: string, to: string): Promise<'proposal' | 'split_choice' | 'manual'> {
  await client.query('SAVEPOINT home_region_proposal');
  try {
    const { rows } = await client.query(
      `UPDATE aws_connection_checks
          SET home_region_proposal_state = CASE
                WHEN home_region_proposal_state = 'split' THEN 'accepted'
                WHEN home_region_proposal->>'region' = $3 THEN 'accepted'
                ELSE 'superseded' END,
              home_region_decided_at = now(), updated_at = now()
        WHERE organization_id = $1 AND aws_account_id = $2 AND home_region_proposal_state IN ('proposed', 'split')
        RETURNING home_region_proposal_state AS state, home_region_proposal->>'region' IS NULL AS split`,
      [organizationId, awsAccountRowId, to]
    );
    await client.query('RELEASE SAVEPOINT home_region_proposal');
    if (rows[0]?.state !== 'accepted') return 'manual';
    return rows[0].split ? 'split_choice' : 'proposal';
  } catch (error: unknown) {
    await client.query('ROLLBACK TO SAVEPOINT home_region_proposal');
    const code = (error as { code?: unknown } | null)?.code;
    // The HR-0 columns (42703) or the table (42P01) are not there yet: there is no proposal to settle.
    if (code === '42703' || code === '42P01') {
      console.warn(`[HomeRegion] proposal columns unavailable for org ${organizationId} (${code}); the change goes on`);
      return 'manual';
    }
    throw error;
  }
}

/**
 * Changes the organization's home region to `to` (owner only: the route checks
 * the role). Throws HomeRegionChangeRefusedError for every refusal, with nothing
 * changed. See the module comment for the transaction.
 */
export async function changeHomeRegion(
  args: { organizationId: string; actorId: string; to: string; request: AuditRequestContext | null },
  source: FenceConnectionSource = defaultPool,
  { lockTimeoutMs }: { lockTimeoutMs?: number } = {}
): Promise<HomeRegionChangeResult> {
  const { organizationId, actorId, to, request } = args;
  if (!isRegionCode(to)) throw new HomeRegionChangeRefusedError('invalid_region');

  // Validation before any lock: a refusal costs no lock wait.
  const validated = await eligibleAccount(source, organizationId);
  const from = homeRegionOf(validated);
  const awsAccountId = awsAccountIdOf(validated)!;
  const before = await onTagged(source, organizationId, (client) => readState(client, organizationId, awsAccountId));
  const refused = refusalFor(to, from, before);
  if (refused) throw new HomeRegionChangeRefusedError(refused);

  try {
    return await withConnectionChange(source, organizationId, async (client) => {
      // 1. The same row as validated, still with the same home region.
      let account: AwsAccountRow | null;
      try {
        account = await findEligibleAwsAccount(client, organizationId);
      } catch (error: unknown) {
        if (isAwsAccountAmbiguous(error)) throw new HomeRegionChangeRefusedError('ambiguous');
        throw error;
      }
      if (!account || account.id !== validated.id || account.role_arn !== validated.role_arn || account.region !== validated.region) {
        throw new HomeRegionChangeRefusedError('connection_changed');
      }
      // 2. Region list and leases again, under the lock.
      const refusal = refusalFor(to, from, await readState(client, organizationId, awsAccountId));
      if (refusal) throw new HomeRegionChangeRefusedError(refusal);

      // 3. Compare-and-set on the raw stored region (NULL reads as the default home region).
      const updated = await client.query(
        `UPDATE aws_accounts SET region = $4
          WHERE id = $1 AND org_id = $2 AND status = 'active' AND region IS NOT DISTINCT FROM $3`,
        [account.id, organizationId, account.region, to]
      );
      if ((updated.rowCount ?? 0) !== 1) throw new HomeRegionChangeRefusedError('connection_changed');

      // 4. The old home region's ACTIVE home-scoped cost findings leave the totals.
      const removed = await client.query(
        `DELETE FROM cost_recommendations WHERE ${SCOPED_PREDICATE}
         RETURNING issue, resource_id, aws_region`,
        [organizationId, [...HOME_REGION_SCOPED_ISSUE_LIST], from]
      );
      const removedRows = (removed.rows as Array<{ issue: string; resource_id: string; aws_region: string }>)
        .sort((a, b) => (a.issue === b.issue ? (a.resource_id < b.resource_id ? -1 : a.resource_id > b.resource_id ? 1 : 0) : a.issue < b.issue ? -1 : 1));
      const counts = countsOf(removedRows.map((row) => ({ issue: row.issue, n: 1 })));

      // 5. An open proposal is settled.
      const decidedBy = await settleProposal(client, organizationId, account.id, to);

      // 6. The audit event: the change and the history of every finding it removed.
      await insertAuditEventInTransaction(client, {
        organizationId,
        actorId,
        action: 'aws_account.home_region_changed',
        resourceType: 'aws_account',
        resourceId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.id) ? account.id : null,
        changes: { from, to },
        metadata: {
          source: decidedBy,
          reason: 'home_region_changed',
          multi_region: before.multiRegion,
          cost_findings_removed: counts,
          removed_findings: removedRows.slice(0, AUDIT_REMOVED_FINDINGS_LIMIT).map((row) => ({ issue: row.issue, resource_id: row.resource_id, region: row.aws_region })),
          removed_findings_truncated: removedRows.length > AUDIT_REMOVED_FINDINGS_LIMIT,
        },
        request,
      });
      return { from, to, source: decidedBy, cost_findings_removed: counts };
    }, lockTimeoutMs === undefined ? {} : { lockTimeoutMs });
  } catch (error: unknown) {
    if ((error as { code?: unknown } | null)?.code === LOCK_NOT_AVAILABLE) throw new HomeRegionChangeRefusedError('busy');
    throw error;
  }
}

/** The connection's latest home region change, as PR 3 labels a former home region's data. */
export interface HomeRegionChange {
  previous_home_region: string;
  home_region_changed_at: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The latest aws_account.home_region_changed audit event of THIS connection row
 * (founder addition, Nov 16; no new column): its `from` and its time. Null when
 * the home region was never changed for this connection, when the latest event
 * does not lead to the current home region (it was edited by hand since: the
 * event no longer explains the current state), or when it cannot be read
 * (logged by name; never fails the caller). Organization and connection are
 * named explicitly; another organization's or an earlier connection's events
 * never count.
 */
export async function readHomeRegionChange(db: AwsAccountsQueryable, organizationId: string, account: AwsAccountRow): Promise<HomeRegionChange | null> {
  if (!UUID_PATTERN.test(account.id)) return null;
  try {
    const { rows } = await db.query(
      `SELECT changes->>'from' AS previous, changes->>'to' AS current, created_at
         FROM audit_logs
        WHERE organization_id = $1 AND resource_id = $2::uuid AND action = 'aws_account.home_region_changed'
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [organizationId, account.id]
    );
    const row = rows[0] as { previous: string | null; current: string | null; created_at: Date } | undefined;
    if (!row || row.current !== homeRegionOf(account) || !isRegionCode(row.previous)) return null;
    return { previous_home_region: row.previous, home_region_changed_at: row.created_at };
  } catch (error: unknown) {
    console.error(`[HomeRegion] change history unreadable for org ${organizationId}:`, error instanceof Error ? error.name : 'unknown error');
    return null;
  }
}
