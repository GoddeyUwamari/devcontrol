/**
 * Installation claim (d8a-build.md §1.2, founder ruling D8-N1): a GitHub App
 * installation is tied to exactly one DevControl organization, by the GitHub
 * user who installed it, who must also be an owner or admin of that
 * organization (the route checks the role and refuses the demo workspace).
 *
 *  start  -> random state; only sha256(state) stored, bound to user + org, 15 min, single use
 *  claim  -> consume state -> OAuth code -> GitHub user -> the installation must be
 *            in /user/installations -> that user must be the installer (sender of the
 *            signed installation.created delivery, or the personal account itself)
 *            -> one transaction: claim row (global primary key) + release held deliveries
 *  retry  -> same user + state, while installation.created is still on its way;
 *            the last allowed retry that still finds none refuses with
 *            INSTALL_EVENT_MISSING (it was never received, or was lost)
 *
 * The organization always comes from the authenticated request, never from
 * the body. No token, code or state value is stored or logged.
 */
import crypto from 'crypto';
import { GitHubAppConfig, GitHubAppConfigResult, readGitHubAppConfig } from '../../config/github-app';
import {
  consumeInstallState,
  createInstallState,
  deleteExpiredInstallStates,
  insertInstallationClaim,
  installerOf,
  recordVerifiedIdentity,
  releaseHeldDeliveries,
  takeClaimRetry,
} from '../../repositories/github-installations.repository';
import { expireClaimHolds, findUnprocessedEvents } from '../../repositories/pipeline-events.repository';
import { upsertRepository } from '../../repositories/pipeline-repositories.repository';
import { GitHubAppClient, GitHubClientError, createFetchGitHubAppClient } from './client';
import { ConnectionSource, defaultSource, withOrgClient, withOrgTransaction, withUntaggedClient } from './db';
import { permissionsStateOf } from './permissions';
import { EventProcessor, processEvent, processStoredEvent } from './process';

export interface ClaimDeps {
  readConfig: () => GitHubAppConfigResult;
  source: ConnectionSource;
  github: (config: GitHubAppConfig) => GitHubAppClient;
  processor: EventProcessor;
  log: (line: string) => void;
}

const defaultClaimDeps: ClaimDeps = {
  readConfig: () => readGitHubAppConfig(),
  source: defaultSource,
  github: (config) => createFetchGitHubAppClient(config),
  processor: processEvent,
  log: (line) => console.log(line),
};

interface ClaimResult {
  status: number;
  body: Record<string, unknown>;
}

export const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashState(state: string): Buffer {
  return crypto.createHash('sha256').update(state, 'utf8').digest();
}

const NOT_CONFIGURED: ClaimResult = { status: 503, body: { success: false, error: 'github_app_not_configured' } };
const INVALID_STATE: ClaimResult = { status: 400, body: { success: false, error: 'invalid_state' } };
/**
 * No installation.created for the installation, and no retry left to wait
 * for it (d8a-build.md §15, review S-2). GitHub does not resend a failed
 * delivery by itself; the founder's wording.
 */
const INSTALL_EVENT_MISSING: ClaimResult = {
  status: 409,
  body: {
    success: false,
    error: 'install_event_not_received',
    message: "We didn't receive the install event from GitHub. Uninstall the DevControl app from your GitHub settings, reinstall it, then try again.",
  },
};

export async function startInstall(organizationId: string, userId: string, deps: ClaimDeps = defaultClaimDeps): Promise<ClaimResult> {
  const config = deps.readConfig();
  if (!config.enabled) return NOT_CONFIGURED;
  const state = crypto.randomBytes(32).toString('base64url');
  await withOrgClient(deps.source, organizationId, async (client) => {
    await deleteExpiredInstallStates(client, organizationId);
    await createInstallState(client, organizationId, userId, hashState(state));
  });
  const installUrl = `https://github.com/apps/${encodeURIComponent(config.config.slug)}/installations/new?state=${state}`;
  return { status: 200, body: { success: true, data: { install_url: installUrl, state, expires_in_minutes: 15 } } };
}

interface ClaimInput {
  organizationId: string;
  userId: string;
  state: string;
  code?: string;
  installationId?: number;
  setupAction?: 'install' | 'update' | 'request';
}

export async function claimInstallation(input: ClaimInput, deps: ClaimDeps = defaultClaimDeps): Promise<ClaimResult> {
  const config = deps.readConfig();
  if (!config.enabled) return NOT_CONFIGURED;
  const { organizationId, userId } = input;
  const stateHash = hashState(input.state);
  const consumed = await withOrgClient(deps.source, organizationId, (c) => consumeInstallState(c, organizationId, userId, stateHash));
  if (!consumed) return logged(deps, input.installationId, INVALID_STATE, 'invalid_state');

  if (input.setupAction === 'request') {
    return logged(deps, undefined, { status: 200, body: { success: true, data: { status: 'pending_github_approval' } } }, 'pending_github_approval');
  }
  if (!input.code || !input.installationId) {
    return logged(deps, input.installationId, { status: 400, body: { success: false, error: 'missing_code_or_installation' } }, 'missing_input');
  }
  const installationId = input.installationId;
  const github = deps.github(config.config);
  try {
    const userToken = await github.exchangeCode(input.code);
    const githubUser = await github.getAuthenticatedUser(userToken);
    const accessible = await github.listUserInstallations(userToken);
    if (!accessible.some((i) => i.id === installationId)) {
      return logged(deps, installationId, { status: 403, body: { success: false, error: 'installation_not_accessible' } }, 'not_accessible');
    }
    return await completeClaim(deps, github, { organizationId, userId, stateHash, githubUserId: githubUser.id, installationId, firstAttempt: true, lastRetry: false });
  } catch (error) {
    return githubFailure(deps, installationId, error);
  }
}

export async function retryClaim(
  input: { organizationId: string; userId: string; state: string },
  deps: ClaimDeps = defaultClaimDeps
): Promise<ClaimResult> {
  const config = deps.readConfig();
  if (!config.enabled) return NOT_CONFIGURED;
  const { organizationId, userId } = input;
  const stateHash = hashState(input.state);
  const verified = await withOrgClient(deps.source, organizationId, (c) => takeClaimRetry(c, organizationId, userId, stateHash));
  if (!verified) return logged(deps, undefined, INVALID_STATE, 'invalid_retry');
  const github = deps.github(config.config);
  try {
    return await completeClaim(deps, github, { organizationId, userId, stateHash, ...verified, firstAttempt: false });
  } catch (error) {
    return githubFailure(deps, verified.installationId, error);
  }
}

async function completeClaim(
  deps: ClaimDeps,
  github: GitHubAppClient,
  c: { organizationId: string; userId: string; stateHash: Buffer; githubUserId: number; installationId: number; firstAttempt: boolean; lastRetry: boolean }
): Promise<ClaimResult> {
  const { organizationId, installationId, githubUserId } = c;
  const details = await github.getInstallation(installationId);
  const installer = await withUntaggedClient(deps.source, (client) => installerOf(client, installationId));
  const personalAccount = details.account.type === 'User' && details.account.id === githubUserId;
  const isInstaller = installer === githubUserId || (installer === null && personalAccount);
  if (!isInstaller) {
    if (installer === null) {
      if (c.lastRetry) return logged(deps, installationId, INSTALL_EVENT_MISSING, 'install_event_missing');
      if (c.firstAttempt) {
        await withOrgClient(deps.source, organizationId, (client) =>
          recordVerifiedIdentity(client, organizationId, c.userId, c.stateHash, githubUserId, installationId));
      }
      return logged(deps, installationId, { status: 202, body: { success: true, data: { status: 'waiting_for_github' } } }, 'waiting_for_installer');
    }
    return logged(deps, installationId, { status: 403, body: { success: false, error: 'not_installer' } }, 'not_installer');
  }

  const permissionsState = permissionsStateOf(details.permissions);
  const claim = await withOrgTransaction(deps.source, organizationId, async (client) => {
    const result = await insertInstallationClaim(client, organizationId, {
      installationId,
      accountId: details.account.id,
      accountLogin: details.account.login,
      accountType: details.account.type,
      repositorySelection: details.repositorySelection,
      permissions: details.permissions,
      events: details.events,
      permissionsState,
      installerGithubUserId: installer ?? githubUserId,
      claimedByUserId: c.userId,
      claimedByGithubUserId: githubUserId,
    });
    const released = result === 'claimed_elsewhere' ? 0 : await releaseHeldDeliveries(client, installationId);
    return { result, released };
  });
  if (claim.result === 'claimed_elsewhere') {
    return logged(deps, installationId, { status: 409, body: { success: false, error: 'installation_claimed_elsewhere' } }, 'claimed_elsewhere');
  }

  // After the commit: repository list (best effort; events fill it in too), then held events.
  let repositories = 0;
  try {
    const repos = await github.listInstallationRepositories(installationId);
    const at = new Date().toISOString();
    await withOrgTransaction(deps.source, organizationId, async (client) => {
      for (const repo of repos) {
        await upsertRepository(client, organizationId, { githubRepoId: repo.id, installationId, fullName: repo.fullName, defaultBranch: repo.defaultBranch, at });
      }
    });
    repositories = repos.length;
  } catch (error) {
    deps.log(`[github-app] claim installation=${installationId} outcome=repository_list_failed code=${errorCode(error)}`);
  }
  // Events held for lack of a claim (stored, then disconnected; D8b-1 fix S-1) are recorded now,
  // unless they were held longer than a held delivery is kept (7 days).
  const pending = await withOrgClient(deps.source, organizationId, async (client) => {
    await expireClaimHolds(client, organizationId, installationId);
    return findUnprocessedEvents(client, organizationId, installationId);
  });
  for (const event of pending) await processStoredEvent(deps.source, organizationId, event, deps.processor);

  return logged(deps, installationId, {
    status: 200,
    body: {
      success: true,
      data: {
        status: claim.result === 'inserted' ? 'connected' : 'already_connected',
        installation: {
          installation_id: String(installationId),
          account_login: details.account.login,
          account_type: details.account.type,
          repository_selection: details.repositorySelection,
          permissions_state: permissionsState,
        },
        repositories,
        released_events: claim.released,
      },
    },
  }, claim.result === 'inserted' ? 'connected' : 'already_connected');
}

function errorCode(error: unknown): string {
  if (error instanceof GitHubClientError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code.toLowerCase() : 'error';
}

function githubFailure(deps: ClaimDeps, installationId: number | undefined, error: unknown): ClaimResult {
  if (error instanceof GitHubClientError) {
    const status = error.code === 'github_rejected' ? 403 : 502;
    const body = { success: false, error: error.code === 'github_rejected' ? 'github_authorization_failed' : 'github_unavailable' };
    return logged(deps, installationId, { status, body }, error.code);
  }
  throw error;
}

function logged(deps: ClaimDeps, installationId: number | undefined, result: ClaimResult, outcome: string): ClaimResult {
  deps.log(`[github-app] claim installation=${installationId ?? '-'} outcome=${outcome} status=${result.status}`);
  return result;
}
