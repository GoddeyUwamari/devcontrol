/**
 * github_installations (claims) and github_install_states (install-flow
 * states), plus the calls to the SECURITY DEFINER functions of admin
 * migration 202611201200_create_github_app_ingestion.
 *
 * Tenant tables: row level security forced, every statement names
 * organization_id. The definer functions are the only paths past RLS, each
 * minimal (d8a-build.md §1.3). Never store or log a token, an OAuth code or
 * a state value: only sha256(state) reaches the database.
 */
import { PoolClient } from 'pg';
import { NormalizedDelivery } from '../services/github-app/contract';

// ─── Definer functions ────────────────────────────────────────────────────────

/** installation id -> the claiming organization, or null when unclaimed. */
export async function installationOrganization(client: PoolClient, installationId: number): Promise<string | null> {
  const { rows } = await client.query<{ org: string | null }>('SELECT github_installation_org($1::bigint) AS org', [installationId]);
  return rows[0]?.org ?? null;
}

type HoldOutcome = 'held' | 'duplicate' | 'claimed';

/** Holds a delivery of an unclaimed installation ('claimed' = it was claimed meanwhile; store it for the org). */
export async function holdDelivery(
  client: PoolClient,
  deliveryId: string,
  record: NormalizedDelivery,
  normalizerVersion: number,
  payloadSha256: string
): Promise<HoldOutcome> {
  const { rows } = await client.query<{ outcome: HoldOutcome }>(
    `SELECT github_hold_delivery($1::uuid, $2::bigint, $3, $4, $5::bigint, $6, $7::timestamptz, $8::smallint, $9::jsonb, $10) AS outcome`,
    [deliveryId, record.installationId, record.event, record.action, record.githubRepoId, record.eventKey, record.occurredAt,
      normalizerVersion, JSON.stringify(record.facts), payloadSha256]
  );
  const outcome = rows[0]?.outcome;
  if (outcome !== 'held' && outcome !== 'duplicate' && outcome !== 'claimed') throw new Error('unexpected hold outcome');
  return outcome;
}

/** The GitHub user id that created the installation, from its signed installation.created delivery, or null. */
export async function installerOf(client: PoolClient, installationId: number): Promise<number | null> {
  const { rows } = await client.query<{ installer: string | null }>('SELECT github_installer_of($1::bigint)::text AS installer', [installationId]);
  const installer = rows[0]?.installer;
  return installer ? Number(installer) : null;
}

/** On a connection tagged for the claiming organization, inside the claim transaction. */
export async function releaseHeldDeliveries(client: PoolClient, installationId: number): Promise<number> {
  const { rows } = await client.query<{ moved: number }>('SELECT github_release_held_deliveries($1::bigint) AS moved', [installationId]);
  return Number(rows[0]?.moved ?? 0);
}

// ─── Install states ───────────────────────────────────────────────────────────

const INSTALL_STATE_TTL_MINUTES = 15;
const MAX_CLAIM_RETRIES = 10;

export async function createInstallState(client: PoolClient, organizationId: string, userId: string, stateHash: Buffer): Promise<void> {
  await client.query(
    `INSERT INTO github_install_states (state_hash, organization_id, user_id, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [stateHash, organizationId, userId, INSTALL_STATE_TTL_MINUTES]
  );
}

/** Housekeeping on each new install start: this organization's states expired over a day ago. */
export async function deleteExpiredInstallStates(client: PoolClient, organizationId: string): Promise<void> {
  await client.query(
    `DELETE FROM github_install_states WHERE organization_id = $1 AND expires_at < NOW() - interval '1 day'`,
    [organizationId]
  );
}

/**
 * Single use: marks the state consumed only when it is this user's, in this
 * organization, unconsumed and unexpired. False for every other case alike.
 */
export async function consumeInstallState(
  client: PoolClient,
  organizationId: string,
  userId: string,
  stateHash: Buffer
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE github_install_states SET consumed_at = NOW()
      WHERE organization_id = $1 AND user_id = $2 AND state_hash = $3
        AND consumed_at IS NULL AND expires_at > NOW()`,
    [organizationId, userId, stateHash]
  );
  return rowCount === 1;
}

/** Remembers the GitHub identity proven by the OAuth code, for retries while installation.created is on its way. */
export async function recordVerifiedIdentity(
  client: PoolClient,
  organizationId: string,
  userId: string,
  stateHash: Buffer,
  githubUserId: number,
  installationId: number
): Promise<void> {
  await client.query(
    `UPDATE github_install_states
        SET verified_github_user_id = $4, verified_installation_id = $5, verified_at = NOW()
      WHERE organization_id = $1 AND user_id = $2 AND state_hash = $3 AND consumed_at IS NOT NULL AND verified_at IS NULL`,
    [organizationId, userId, stateHash, githubUserId, installationId]
  );
}

/** A retry of a verified, unexpired claim by the same user: counts the try and returns the proven identity. */
export async function takeClaimRetry(
  client: PoolClient,
  organizationId: string,
  userId: string,
  stateHash: Buffer
): Promise<{ githubUserId: number; installationId: number; lastRetry: boolean } | null> {
  const { rows } = await client.query<{ github_user_id: string; installation_id: string; retry_count: number }>(
    `UPDATE github_install_states SET retry_count = retry_count + 1
      WHERE organization_id = $1 AND user_id = $2 AND state_hash = $3
        AND verified_at IS NOT NULL AND expires_at > NOW() AND retry_count < $4
      RETURNING verified_github_user_id::text AS github_user_id, verified_installation_id::text AS installation_id, retry_count`,
    [organizationId, userId, stateHash, MAX_CLAIM_RETRIES]
  );
  if (rows.length !== 1) return null;
  return {
    githubUserId: Number(rows[0].github_user_id),
    installationId: Number(rows[0].installation_id),
    // This retry used the last one: there is no later retry to wait for.
    lastRetry: Number(rows[0].retry_count) >= MAX_CLAIM_RETRIES,
  };
}

// ─── Installations ────────────────────────────────────────────────────────────

interface InstallationClaim {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization' | 'Enterprise';
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  events: string[];
  permissionsState: 'expected' | 'mismatch';
  installerGithubUserId: number;
  claimedByUserId: string;
  claimedByGithubUserId: number;
}

interface InstallationRow {
  installation_id: string;
  account_login: string;
  account_type: string;
  repository_selection: string;
  permissions_state: string;
  /** What GitHub reports the installation was granted (D8b: the mismatch banner names the differences). */
  permissions: Record<string, string>;
  claimed_at: Date;
  /** The DevControl user who claimed it (D8b summary card); null once that user is deleted or has no name. */
  claimed_by_name: string | null;
  suspended_at: Date | null;
  deleted_at: Date | null;
}

const INSTALLATION_COLUMNS = `gi.installation_id::text AS installation_id, gi.account_login, gi.account_type, gi.repository_selection,
                              gi.permissions_state, gi.permissions, gi.claimed_at, NULLIF(btrim(u.full_name), '') AS claimed_by_name,
                              gi.suspended_at, gi.deleted_at`;

/**
 * Inserts the claim. The primary key is global, so an installation another
 * organization holds conflicts here even though RLS hides that row:
 * 'claimed_elsewhere'. A row this organization already holds: 'already'.
 */
export async function insertInstallationClaim(
  client: PoolClient,
  organizationId: string,
  claim: InstallationClaim
): Promise<'inserted' | 'already' | 'claimed_elsewhere'> {
  const inserted = await client.query(
    `INSERT INTO github_installations
       (installation_id, organization_id, account_id, account_login, account_type, repository_selection, permissions, events,
        permissions_state, installer_github_user_id, claimed_by_user_id, claimed_by_github_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
     ON CONFLICT (installation_id) DO NOTHING`,
    [claim.installationId, organizationId, claim.accountId, claim.accountLogin, claim.accountType, claim.repositorySelection,
      JSON.stringify(claim.permissions), JSON.stringify(claim.events), claim.permissionsState, claim.installerGithubUserId,
      claim.claimedByUserId, claim.claimedByGithubUserId]
  );
  if (inserted.rowCount === 1) return 'inserted';
  const own = await client.query(
    'SELECT 1 FROM github_installations WHERE organization_id = $1 AND installation_id = $2',
    [organizationId, claim.installationId]
  );
  return own.rowCount === 1 ? 'already' : 'claimed_elsewhere';
}

export async function listInstallations(client: PoolClient, organizationId: string): Promise<InstallationRow[]> {
  const { rows } = await client.query<InstallationRow>(
    `SELECT ${INSTALLATION_COLUMNS}
       FROM github_installations gi
       LEFT JOIN users u ON u.id = gi.claimed_by_user_id
      WHERE gi.organization_id = $1
      ORDER BY gi.claimed_at, gi.installation_id`,
    [organizationId]
  );
  return rows;
}

/**
 * Disconnect (D8b, D8-N11): removes this organization's claim on one
 * installation. Run inside a transaction (withOrgTransaction):
 *
 *  1. lock the claim row (FOR UPDATE). Not this organization's -> null, nothing changed;
 *  2. detach its repositories (installation_id NULL). Their service, deploy
 *     rule and events stay, so a later claim re-links them as they were;
 *  3. delete the claim.
 *
 * Deployment rows and pipeline_events are never touched. The lock in step 1
 * also holds off a concurrent webhook that would re-point a repository at
 * the installation: its foreign-key check waits for this transaction and
 * then fails, and that event is marked failed, never lost. New deliveries
 * for the installation are held again (no organization), as before a claim.
 */
export async function disconnectInstallation(
  client: PoolClient,
  organizationId: string,
  installationId: number
): Promise<{ repositories: number } | null> {
  const own = await client.query(
    'SELECT 1 FROM github_installations WHERE organization_id = $1 AND installation_id = $2 FOR UPDATE',
    [organizationId, installationId]
  );
  if (own.rowCount !== 1) return null;
  const detached = await client.query(
    `UPDATE pipeline_repositories SET installation_id = NULL, updated_at = NOW()
      WHERE organization_id = $1 AND installation_id = $2`,
    [organizationId, installationId]
  );
  await client.query('DELETE FROM github_installations WHERE organization_id = $1 AND installation_id = $2', [organizationId, installationId]);
  return { repositories: detached.rowCount ?? 0 };
}

type InstallationLifecycle =
  | { kind: 'deleted'; at: string }
  | { kind: 'suspend'; at: string }
  | { kind: 'unsuspend' }
  | { kind: 'details'; accountLogin: string | null; repositorySelection: 'all' | 'selected' | null; permissions: Record<string, string>; events: string[]; permissionsState: 'expected' | 'mismatch' };

/** Applies an installation lifecycle event to this organization's claim row. */
export async function applyInstallationLifecycle(
  client: PoolClient,
  organizationId: string,
  installationId: number,
  change: InstallationLifecycle
): Promise<number> {
  let result;
  switch (change.kind) {
    case 'deleted':
      result = await client.query(
        `UPDATE github_installations SET deleted_at = COALESCE(deleted_at, $3::timestamptz), updated_at = NOW()
          WHERE organization_id = $1 AND installation_id = $2`,
        [organizationId, installationId, change.at]);
      break;
    case 'suspend':
      result = await client.query(
        `UPDATE github_installations SET suspended_at = $3::timestamptz, updated_at = NOW()
          WHERE organization_id = $1 AND installation_id = $2`,
        [organizationId, installationId, change.at]);
      break;
    case 'unsuspend':
      result = await client.query(
        `UPDATE github_installations SET suspended_at = NULL, updated_at = NOW()
          WHERE organization_id = $1 AND installation_id = $2`,
        [organizationId, installationId]);
      break;
    case 'details':
      result = await client.query(
        `UPDATE github_installations
            SET account_login = COALESCE($3, account_login), repository_selection = COALESCE($4, repository_selection),
                permissions = $5::jsonb, events = $6::jsonb, permissions_state = $7, updated_at = NOW()
          WHERE organization_id = $1 AND installation_id = $2`,
        [organizationId, installationId, change.accountLogin, change.repositorySelection, JSON.stringify(change.permissions),
          JSON.stringify(change.events), change.permissionsState]);
      break;
  }
  return result.rowCount ?? 0;
}
