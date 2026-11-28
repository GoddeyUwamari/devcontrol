/**
 * I3 reconnect (Option A, founder rulings D1-D10, i3-reconnect-stage-a.md)
 * against the real database as devcontrol, with a fake GitHub (local
 * fixtures, no network) that models the OAuth authorize + PKCE exchange:
 * a code issued for an authorize URL can be exchanged once, and only with
 * the verifier whose S256 challenge that URL carried and the registered
 * redirect_uri.
 *
 * What is proven here:
 *  - the start: only an installation on the organization's record, no
 *    GitHub call otherwise; the authorize URL's exact shape; the state
 *    stored as a hash only; the verifier never stored; removed-on-GitHub;
 *  - the claim through the reconnect entry is the existing claim: state,
 *    PKCE, /user/installations, the installer proof (or the personal
 *    account), one organization per installation;
 *  - recorded_events (D6) counts the deploys the reconnect recorded, never
 *    one held past 168 hours;
 *  - two workspaces claiming at once: one wins, the other gets 409 and
 *    nothing is released to it;
 *  - D9: a suspended installation stays suspended after the re-claim.
 */
import crypto from 'crypto';
import { claimInstallation, ClaimDeps, startInstall, startReconnect } from '../claim';
import { GitHubAppClient, GitHubClientError, GitHubInstallationDetails } from '../client';
import { ingestDelivery } from '../ingest';
import { processEvent } from '../process';
import {
  disconnectInstallation,
  insertInstallationClaim,
  listInstallations,
  listPreviousInstallations,
  releaseHeldDeliveries,
} from '../../../repositories/github-installations.repository';
import { ConnectionSource, withOrgClient, withOrgTransaction } from '../db';
import { createFixtures, enabledConfig, CLIENT_SECRET, WEBHOOK_SECRET } from './fixtures/db';
import { installationCreated, installationEvent, installationRepositories, signedDelivery, uniqueId, workflowJobCompleted } from './fixtures/payloads';
import { EXPECTED_PERMISSIONS } from '../permissions';
import { deployRuleBody, storedDeployRule } from '../deploy-rule';

const fx = createFixtures('i3-reconnect');
const logs: string[] = [];
const USER_TOKEN = 'ghu_planted_reconnect_token_do_not_log';
const INSTALL_CODE = 'plantedInstallCode123';
const CALLBACK = 'https://getdevcontrol.com/auth/github/callback';
const INSTALLER = 8124;
const JOB_RULE = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend' }));

const s256 = (verifier: string) => crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest();

interface FakeGitHub {
  githubUserId: number;
  accessible: number[];
  account?: Partial<GitHubInstallationDetails['account']>;
  repos?: Array<{ id: number; fullName: string }>;
  suspendedAt?: string | null;
  /** GET /app/installations/{id} answers 404 (uninstalled on GitHub). */
  removed?: boolean;
  failWith?: GitHubClientError;
  /** Called inside getInstallation (the concurrency test's barrier). */
  onGetInstallation?: () => Promise<void>;
  calls?: string[];
}

/** Codes the fake GitHub issued from an authorize URL -> that URL's S256 challenge (one use each). */
const issued = new Map<string, string>();

/** The user authorizes on GitHub: a fresh code bound to the authorize URL's challenge. */
function authorizeOnGitHub(authorizeUrl: string): string {
  const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
  if (!challenge) throw new Error('no code_challenge on the authorize URL');
  const code = `rc${crypto.randomBytes(12).toString('hex')}`;
  issued.set(code, challenge);
  return code;
}

function fakeClient(f: FakeGitHub): GitHubAppClient {
  const calls = f.calls ?? [];
  const fail = () => { if (f.failWith) throw f.failWith; };
  return {
    exchangeCode: async (code, pkce) => {
      calls.push('exchangeCode');
      fail();
      const challenge = issued.get(code);
      if (challenge === undefined) {
        // The first-install flow's code: no PKCE on that path.
        if (code !== INSTALL_CODE || pkce !== undefined) throw new GitHubClientError('github_rejected');
        return USER_TOKEN;
      }
      issued.delete(code);
      if (!pkce || pkce.redirectUri !== CALLBACK || s256(pkce.codeVerifier) !== challenge) throw new GitHubClientError('github_rejected');
      return USER_TOKEN;
    },
    getAuthenticatedUser: async (token) => {
      calls.push('getAuthenticatedUser');
      expect(token).toBe(USER_TOKEN);
      return { id: f.githubUserId, login: `gh-${f.githubUserId}` };
    },
    listUserInstallations: async () => {
      calls.push('listUserInstallations');
      return f.accessible.map((id) => ({ id, account: { id: 777, login: 'acme', type: 'Organization' as const } }));
    },
    getInstallation: async (id) => {
      calls.push('getInstallation');
      fail();
      if (f.removed) throw new GitHubClientError('github_rejected', 404);
      if (f.onGetInstallation) await f.onGetInstallation();
      return {
        id,
        account: { id: 777, login: 'acme', type: 'Organization', ...f.account } as GitHubInstallationDetails['account'],
        repositorySelection: 'selected',
        permissions: { ...EXPECTED_PERMISSIONS },
        events: ['workflow_job'],
        suspendedAt: f.suspendedAt ?? null,
      };
    },
    listInstallationRepositories: async () => {
      calls.push('listInstallationRepositories');
      return (f.repos ?? []).map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: 'main' }));
    },
  };
}

const deps = (f: FakeGitHub): ClaimDeps => ({
  readConfig: enabledConfig,
  source: fx.app,
  github: () => fakeClient(f),
  processor: processEvent,
  log: (line) => logs.push(line),
});

const ingestDeps = { readConfig: enabledConfig, source: fx.app, processor: processEvent, log: (l: string) => logs.push(l) };
const deliver = (event: string, payload: unknown) => {
  const d = signedDelivery(event, payload, WEBHOOK_SECRET);
  return ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, ingestDeps);
};

const owner = async (inst: number) =>
  (await fx.admin.query('SELECT organization_id::text AS org FROM github_installations WHERE installation_id = $1', [inst])).rows;
const heldCount = async (inst: number) =>
  (await fx.admin.query('SELECT count(*)::int AS n FROM github_held_deliveries WHERE installation_id = $1', [inst])).rows[0].n as number;
const eventCount = async (org: string, inst: number) =>
  (await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1 AND installation_id = $2', [org, inst])).rows[0].n as number;
const linkedRepos = async (org: string, inst: number) =>
  (await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_repositories WHERE organization_id = $1 AND installation_id = $2', [org, inst])).rows[0].n as number;
const stateRows = async (org: string) =>
  (await fx.admin.query('SELECT count(*)::int AS n FROM github_install_states WHERE organization_id = $1', [org])).rows[0].n as number;
const deploymentsFor = async (org: string, serviceId: string) =>
  (await fx.admin.query('SELECT count(*)::int AS n FROM deployments WHERE organization_id = $1 AND service_id = $2', [org, serviceId])).rows[0].n as number;

type StartData = { authorize_url: string; state: string; code_verifier: string; expires_in_minutes: number; installation_id: string; account_login: string; suspended: boolean };

async function start(org: string, user: string, inst: number, f: FakeGitHub): Promise<StartData> {
  const started = await startReconnect(org, user, inst, deps(f));
  expect(started.status).toBe(200);
  return started.body.data as StartData;
}

/** The whole reconnect: start, authorize on GitHub, claim with the parked code and the tab's verifier. */
async function reconnect(org: string, user: string, inst: number, f: FakeGitHub) {
  const data = await start(org, user, inst, f);
  const code = authorizeOnGitHub(data.authorize_url);
  return claimInstallation({ organizationId: org, userId: user, state: data.state, code, installationId: inst, codeVerifier: data.code_verifier }, deps(f));
}

/** The first-install flow (unchanged): install URL state + the install-time OAuth code. */
async function firstInstallClaim(org: string, user: string, inst: number, f: FakeGitHub) {
  const started = await startInstall(org, user, deps(f));
  const state = (started.body.data as { state: string }).state;
  return claimInstallation({ organizationId: org, userId: user, state, code: INSTALL_CODE, installationId: inst }, deps(f));
}

/**
 * An organization that connected an installation (installation.created stored for it), mapped its
 * repository to a service with a deploy rule, and disconnected it: what the Reconnect card is for.
 */
async function previouslyConnected(org: string, user: string, label: string, over: Partial<FakeGitHub> = {}) {
  const inst = fx.installationId();
  const repoId = uniqueId();
  const fullName = `acme/${label}`;
  await deliver('installation', installationCreated(inst, INSTALLER, [{ id: repoId, full_name: fullName }]));
  const f: FakeGitHub = { githubUserId: INSTALLER, accessible: [inst], repos: [{ id: repoId, fullName }], ...over };
  expect((await firstInstallClaim(org, user, inst, f)).body.data).toMatchObject({ status: 'connected' });
  const serviceId = await fx.service(org, `${label}-${inst}`);
  await fx.admin.query('UPDATE pipeline_repositories SET service_id = $1, deploy_rule = $2::jsonb WHERE organization_id = $3 AND github_repo_id = $4',
    [serviceId, JSON.stringify(JOB_RULE), org, repoId]);
  expect(await withOrgTransaction(fx.app, org, (c) => disconnectInstallation(c, org, inst))).toEqual({ repositories: 1 });
  return { inst, repoId, serviceId, f };
}

const newerJob = (inst: number, repoId: number, jobId = uniqueId()) =>
  workflowJobCompleted(inst, repoId, { jobId, completedAt: new Date(Date.now() + 60_000).toISOString() });

let orgA: string; let userA: string; let userA2: string;
let orgB: string; let userB: string;

beforeAll(async () => {
  await fx.grantAppReads();
  await fx.grantDeploymentWrites();
  orgA = await fx.org(); userA = await fx.user(orgA); userA2 = await fx.user(orgA, 'admin');
  orgB = await fx.org(); userB = await fx.user(orgB);
});
afterAll(() => fx.close());
beforeEach(() => { logs.length = 0; });

describe('reconnect start', () => {
  it('builds the authorize URL exactly (registered callback, state, S256 challenge, select_account); stores only sha256(state), 15 minutes; never the verifier', async () => {
    const c = await previouslyConnected(orgA, userA, 'start-shape');
    const data = await start(orgA, userA, c.inst, c.f);
    expect(data).toMatchObject({ expires_in_minutes: 15, installation_id: String(c.inst), account_login: 'acme', suspended: false });
    expect(data.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.code_verifier).not.toBe(data.state);
    expect(data.authorize_url).toBe(
      'https://github.com/login/oauth/authorize?client_id=Iv1.placeholder0000'
      + '&redirect_uri=https%3A%2F%2Fgetdevcontrol.com%2Fauth%2Fgithub%2Fcallback'
      + `&state=${data.state}&code_challenge=${s256(data.code_verifier)}&code_challenge_method=S256&prompt=select_account`);
    const rows = (await fx.admin.query(
      `SELECT encode(state_hash, 'hex') AS h, user_id::text AS u, round(extract(epoch FROM expires_at - created_at)) AS ttl, consumed_at
         FROM github_install_states WHERE organization_id = $1 AND state_hash = $2`, [orgA, sha256(data.state)])).rows;
    expect(rows).toEqual([{ h: sha256(data.state).toString('hex'), u: userA, ttl: '900', consumed_at: null }]);
    const everything = JSON.stringify((await fx.admin.query('SELECT * FROM github_install_states WHERE organization_id = $1', [orgA])).rows);
    expect(everything).not.toContain(data.state);
    expect(everything).not.toContain(data.code_verifier);
    expect(everything).not.toContain(s256(data.code_verifier));
    expect(logs.filter((l) => l.startsWith('[github-app] reconnect '))).toEqual([`[github-app] reconnect installation=${c.inst} outcome=started status=200`]);
  });

  it('an installation not on this organization\'s record -> 404, no GitHub call, no state', async () => {
    const theirs = await previouslyConnected(orgB, userB, 'start-not-mine');
    const calls: string[] = [];
    const f = { ...theirs.f, calls };
    const before = await stateRows(orgA);
    // Another organization's previous installation, and an id never seen: both 404.
    for (const inst of [theirs.inst, fx.installationId()]) {
      expect(await startReconnect(orgA, userA, inst, deps(f))).toEqual({ status: 404, body: { success: false, error: 'not_found' } });
    }
    expect(calls).toEqual([]);
    expect(await stateRows(orgA)).toBe(before);
    // The owning organization may.
    expect((await startReconnect(orgB, userB, theirs.inst, deps(f))).status).toBe(200);
  });

  it('an installation this organization holds right now is not "previous" -> 404', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    expect((await firstInstallClaim(orgA, userA, inst, f)).status).toBe(200);
    expect((await withOrgClient(fx.app, orgA, (c) => listPreviousInstallations(c, orgA))).map((p) => p.installation_id)).not.toContain(String(inst));
    expect((await startReconnect(orgA, userA, inst, deps(f))).status).toBe(404);
  });

  it('uninstalled on GitHub (404) -> 409 installation_removed_on_github with the account, no state, no OAuth', async () => {
    const c = await previouslyConnected(orgA, userA, 'start-removed');
    const before = await stateRows(orgA);
    expect(await startReconnect(orgA, userA, c.inst, deps({ ...c.f, removed: true }))).toEqual({
      status: 409, body: { success: false, error: 'installation_removed_on_github', data: { account_login: 'acme' } },
    });
    expect(await stateRows(orgA)).toBe(before);
  });

  it('GitHub down or refusing at the start -> 502 / 403, no state', async () => {
    const c = await previouslyConnected(orgA, userA, 'start-down');
    const before = await stateRows(orgA);
    expect(await startReconnect(orgA, userA, c.inst, deps({ ...c.f, failWith: new GitHubClientError('github_unavailable') })))
      .toEqual({ status: 502, body: { success: false, error: 'github_unavailable' } });
    expect(await startReconnect(orgA, userA, c.inst, deps({ ...c.f, failWith: new GitHubClientError('github_rejected', 401) })))
      .toEqual({ status: 403, body: { success: false, error: 'github_authorization_failed' } });
    expect(await stateRows(orgA)).toBe(before);
  });

  it('suspended on GitHub: the start goes on and says so', async () => {
    const c = await previouslyConnected(orgA, userA, 'start-suspended');
    expect(await start(orgA, userA, c.inst, { ...c.f, suspendedAt: '2026-11-20T00:00:00.000Z' })).toMatchObject({ suspended: true });
  });

  it('feature off -> 503 before any database or GitHub call', async () => {
    const calls: string[] = [];
    const refusing: ConnectionSource = { connect: () => { throw new Error('no database while off'); } };
    const off: ClaimDeps = { ...deps({ githubUserId: 1, accessible: [], calls }), source: refusing, readConfig: () => ({ enabled: false, reason: 'disabled', problems: [] }) };
    expect(await startReconnect(orgA, userA, 42, off)).toEqual({ status: 503, body: { success: false, error: 'github_app_not_configured' } });
    expect(calls).toEqual([]);
  });
});

describe('reconnect claim (the existing claim core through the reconnect entry)', () => {
  it('happy path: claim restored, held events released to this organization only, recorded_events = deploys recorded, a held deploy older than 168 h not recorded', async () => {
    const c = await previouslyConnected(orgA, userA, 'happy');
    // Delivered while disconnected: held, no organization. One fresh deploy, one held 8 days (past the window).
    const jobs = { fresh: uniqueId(), old: uniqueId() };
    for (const jobId of Object.values(jobs)) expect((await deliver('workflow_job', newerJob(c.inst, c.repoId, jobId))).status).toBe(202);
    // A non-deploy event held too: released and processed, but no deploy, so not in recorded_events (D6).
    expect((await deliver('installation_repositories', installationRepositories(c.inst, [{ id: uniqueId(), full_name: 'acme/added-while-away' }], []))).status).toBe(202);
    await fx.admin.query(`UPDATE github_held_deliveries SET received_at = NOW() - interval '8 days' WHERE installation_id = $1 AND facts ->> 'job_id' = $2`,
      [c.inst, String(jobs.old)]);
    expect(await heldCount(c.inst)).toBe(3);
    expect(await deploymentsFor(orgA, c.serviceId)).toBe(0);

    const result = await reconnect(orgA, userA, c.inst, c.f);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      status: 'connected',
      installation: { installation_id: String(c.inst), account_login: 'acme', account_type: 'Organization', repository_selection: 'selected', permissions_state: 'expected' },
      repositories: 1,
      released_events: 3,
      recorded_events: 1,
    });
    expect(await owner(c.inst)).toEqual([{ org: orgA }]);
    expect(await heldCount(c.inst)).toBe(0);
    // The mapped repository, re-linked with its service and rule, and the one GitHub added while disconnected (unmapped).
    expect(await linkedRepos(orgA, c.inst)).toBe(2);
    expect(await deploymentsFor(orgA, c.serviceId)).toBe(1);
    const byJob = async (jobId: number) => (await fx.admin.query(
      `SELECT organization_id::text AS org, processing_status AS status, deployment_id IS NOT NULL AS recorded
         FROM pipeline_events WHERE installation_id = $1 AND facts ->> 'job_id' = $2`, [c.inst, String(jobId)])).rows;
    expect(await byJob(jobs.fresh)).toEqual([{ org: orgA, status: 'processed', recorded: true }]);
    expect(await byJob(jobs.old)).toEqual([{ org: orgA, status: 'pending', recorded: false }]);
    expect((await fx.admin.query(`SELECT processing_status FROM pipeline_events WHERE installation_id = $1 AND event = 'installation_repositories'`, [c.inst])).rows)
      .toEqual([{ processing_status: 'processed' }]);
    // Nothing of this installation is in any other organization.
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE installation_id = $1 AND organization_id <> $2', [c.inst, orgA])).rows[0].n).toBe(0);
    // Once connected it is no longer "previous".
    expect((await withOrgClient(fx.app, orgA, (cl) => listPreviousInstallations(cl, orgA))).map((p) => p.installation_id)).not.toContain(String(c.inst));
  });

  it('PKCE: the claim without the verifier, or with another one, is refused by GitHub (403), nothing claimed or released; the state is spent', async () => {
    const c = await previouslyConnected(orgA, userA, 'pkce');
    expect((await deliver('workflow_job', newerJob(c.inst, c.repoId))).status).toBe(202);
    for (const verifier of [undefined, crypto.randomBytes(32).toString('base64url')]) {
      const data = await start(orgA, userA, c.inst, c.f);
      const code = authorizeOnGitHub(data.authorize_url);
      const claim = (state: string) => claimInstallation({ organizationId: orgA, userId: userA, state, code, installationId: c.inst, codeVerifier: verifier }, deps(c.f));
      expect(await claim(data.state)).toEqual({ status: 403, body: { success: false, error: 'github_authorization_failed' } });
      expect(await owner(c.inst)).toEqual([]);
      expect(await heldCount(c.inst)).toBe(1);
      // Single use: the same state again (even with the right verifier) is invalid.
      expect(await claimInstallation({ organizationId: orgA, userId: userA, state: data.state, code, installationId: c.inst, codeVerifier: data.code_verifier }, deps(c.f)))
        .toEqual({ status: 400, body: { success: false, error: 'invalid_state' } });
    }
    expect((await reconnect(orgA, userA, c.inst, c.f)).status).toBe(200);
  });

  it('state: expired, reused, another user\'s, another organization\'s, unknown -> 400 invalid_state before any GitHub call', async () => {
    const c = await previouslyConnected(orgA, userA, 'state');
    const calls: string[] = [];
    const f = { ...c.f, calls };
    const invalid = { status: 400, body: { success: false, error: 'invalid_state' } };
    const claimWith = async (org: string, user: string, data: StartData) =>
      claimInstallation({ organizationId: org, userId: user, state: data.state, code: authorizeOnGitHub(data.authorize_url), installationId: c.inst, codeVerifier: data.code_verifier }, deps(f));

    expect(await claimWith(orgA, userA2, await start(orgA, userA, c.inst, c.f))).toEqual(invalid); // another user of the org
    expect(await claimWith(orgB, userB, await start(orgA, userA, c.inst, c.f))).toEqual(invalid); // another organization
    const unknown = { ...(await start(orgA, userA, c.inst, c.f)), state: crypto.randomBytes(32).toString('base64url') };
    expect(await claimWith(orgA, userA, unknown)).toEqual(invalid);
    const expired = await start(orgA, userA, c.inst, c.f);
    await fx.admin.query(
      `UPDATE github_install_states SET created_at = NOW() - interval '30 minutes', expires_at = NOW() - interval '15 minutes' WHERE state_hash = $1`,
      [sha256(expired.state)]);
    expect(await claimWith(orgA, userA, expired)).toEqual(invalid);
    expect(calls).toEqual([]);
    expect(await owner(c.inst)).toEqual([]);

    const once = await start(orgA, userA, c.inst, c.f);
    expect((await claimWith(orgA, userA, once)).status).toBe(200);
    expect(await claimWith(orgA, userA, once)).toEqual(invalid); // reused
  });

  it('not in /user/installations -> 403 installation_not_accessible; listed but not the installer -> 403 not_installer; nothing claimed or released', async () => {
    const c = await previouslyConnected(orgA, userA, 'authority');
    expect((await deliver('workflow_job', newerJob(c.inst, c.repoId))).status).toBe(202);
    logs.length = 0;
    // The installer, but GitHub no longer lists the installation for them.
    expect(await reconnect(orgA, userA, c.inst, { ...c.f, accessible: [fx.installationId()] }))
      .toEqual({ status: 403, body: { success: false, error: 'installation_not_accessible' } });
    // Another GitHub user who can see it (e.g. read access to one repository) but did not install it.
    expect(await reconnect(orgA, userA, c.inst, { ...c.f, githubUserId: 6667 }))
      .toEqual({ status: 403, body: { success: false, error: 'not_installer' } });
    expect(await owner(c.inst)).toEqual([]);
    expect(await heldCount(c.inst)).toBe(1);
    expect(logs.filter((l) => l.startsWith('[github-app] claim ')).map((l) => l.replace(/installation=\d+/, 'installation=<i>'))).toEqual([
      '[github-app] claim installation=<i> outcome=not_accessible status=403',
      '[github-app] claim installation=<i> outcome=not_installer status=403',
    ]);
  });

  it('a personal account whose stored installation.created names no installer: its own user reconnects; another GitHub user does not', async () => {
    const inst = fx.installationId();
    const created: { installation: { account: unknown }; sender?: unknown } = installationCreated(inst, 1);
    created.installation.account = { id: 4322, login: 'solo', type: 'User' };
    delete created.sender;
    await deliver('installation', created);
    const solo: FakeGitHub = { githubUserId: 4322, accessible: [inst], account: { id: 4322, login: 'solo', type: 'User' } };
    expect((await firstInstallClaim(orgB, userB, inst, solo)).status).toBe(200);
    expect(await withOrgTransaction(fx.app, orgB, (cl) => disconnectInstallation(cl, orgB, inst))).toEqual({ repositories: 0 });
    expect((await fx.app.query('SELECT github_installer_of($1::bigint)::text AS i', [inst])).rows[0].i).toBeNull();
    expect((await withOrgClient(fx.app, orgB, (cl) => listPreviousInstallations(cl, orgB))))
      .toContainEqual({ installation_id: String(inst), account_login: 'solo', account_type: 'User' });

    const stranger = await reconnect(orgB, userB, inst, { ...solo, githubUserId: 5556 });
    expect(stranger.status).toBe(202); // no installer on record and not the account itself: never connected
    expect(await owner(inst)).toEqual([]);
    expect((await reconnect(orgB, userB, inst, solo)).body.data).toMatchObject({ status: 'connected' });
    expect(await owner(inst)).toEqual([{ org: orgB }]);
  });

  it('GitHub down during the claim -> 502, nothing claimed or released', async () => {
    const c = await previouslyConnected(orgA, userA, 'claim-down');
    expect((await deliver('workflow_job', newerJob(c.inst, c.repoId))).status).toBe(202);
    const data = await start(orgA, userA, c.inst, c.f);
    const code = authorizeOnGitHub(data.authorize_url);
    const down = { ...c.f, failWith: new GitHubClientError('github_unavailable') };
    expect(await claimInstallation({ organizationId: orgA, userId: userA, state: data.state, code, installationId: c.inst, codeVerifier: data.code_verifier }, deps(down)))
      .toEqual({ status: 502, body: { success: false, error: 'github_unavailable' } });
    expect(await owner(c.inst)).toEqual([]);
    expect(await heldCount(c.inst)).toBe(1);
  });

  it('D9: an installation suspended on GitHub is stored suspended at the re-claim (never shown healthy); a later unsuspended re-claim stores none', async () => {
    const c = await previouslyConnected(orgA, userA, 'suspended');
    const at = '2026-11-20T08:30:00.000Z';
    expect((await reconnect(orgA, userA, c.inst, { ...c.f, suspendedAt: at })).body.data).toMatchObject({ status: 'connected' });
    // What GET / lists (listInstallations; read as the superuser here: the CI database grants devcontrol no read of users).
    const listed = await withOrgClient(fx.admin, orgA, (cl) => listInstallations(cl, orgA));
    expect(listed.find((i) => i.installation_id === String(c.inst))?.suspended_at?.toISOString()).toBe(at);

    expect(await withOrgTransaction(fx.app, orgA, (cl) => disconnectInstallation(cl, orgA, c.inst))).toEqual({ repositories: 1 });
    expect((await reconnect(orgA, userA, c.inst, { ...c.f, suspendedAt: null })).body.data).toMatchObject({ status: 'connected' });
    expect((await fx.admin.query('SELECT suspended_at FROM github_installations WHERE installation_id = $1', [c.inst])).rows).toEqual([{ suspended_at: null }]);
  });

  it('D9 on the first-install path too: a suspended installation is stored suspended', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const at = '2026-11-21T00:00:00.000Z';
    expect((await firstInstallClaim(orgB, userB, inst, { githubUserId: INSTALLER, accessible: [inst], suspendedAt: at })).status).toBe(200);
    expect((await fx.admin.query('SELECT suspended_at FROM github_installations WHERE installation_id = $1', [inst])).rows[0].suspended_at.toISOString()).toBe(at);
  });

  it('a suspend received while it was claimed stays visible after disconnect + reconnect (the S-gap)', async () => {
    const c = await previouslyConnected(orgA, userA, 'suspend-then-reconnect');
    expect((await reconnect(orgA, userA, c.inst, c.f)).status).toBe(200);
    expect((await deliver('installation', installationEvent(c.inst, 'suspend'))).status).toBe(200);
    expect((await fx.admin.query('SELECT suspended_at IS NOT NULL AS s FROM github_installations WHERE installation_id = $1', [c.inst])).rows).toEqual([{ s: true }]);
    expect(await withOrgTransaction(fx.app, orgA, (cl) => disconnectInstallation(cl, orgA, c.inst))).toEqual({ repositories: 1 });
    // GitHub still reports it suspended; the old row (and its suspended_at) is gone.
    expect((await reconnect(orgA, userA, c.inst, { ...c.f, suspendedAt: '2026-11-22T00:00:00.000Z' })).status).toBe(200);
    expect((await fx.admin.query('SELECT suspended_at IS NOT NULL AS s FROM github_installations WHERE installation_id = $1', [c.inst])).rows).toEqual([{ s: true }]);
  });

  it('no token, code, state, verifier or secret in any log line', async () => {
    const c = await previouslyConnected(orgA, userA, 'logs');
    const data = await start(orgA, userA, c.inst, c.f);
    const code = authorizeOnGitHub(data.authorize_url);
    await claimInstallation({ organizationId: orgA, userId: userA, state: data.state, code, installationId: c.inst, codeVerifier: data.code_verifier }, deps(c.f));
    const all = logs.join('\n');
    expect(logs.some((l) => l.includes('outcome=connected'))).toBe(true);
    for (const forbidden of [USER_TOKEN, code, data.state, data.code_verifier, s256(data.code_verifier), CLIENT_SECRET, WEBHOOK_SECRET, 'authorize']) {
      expect(all).not.toContain(forbidden);
    }
  });
});

/**
 * Required by the founder (Stage A §4.2 test gap): two different workspaces
 * claiming the same installation at the same time. The global primary key
 * decides; the loser gets 409, and nothing is released or recorded for it.
 */
describe('two workspaces claiming one installation at once', () => {
  /** An installer who is owner of two workspaces; X had the installation before (Reconnect), Y uses Connect. */
  async function contested(label: string) {
    const orgX = await fx.org(); const userX = await fx.user(orgX);
    const orgY = await fx.org(); const userY = await fx.user(orgY);
    const c = await previouslyConnected(orgX, userX, label);
    for (let i = 0; i < 2; i += 1) expect((await deliver('workflow_job', newerJob(c.inst, c.repoId))).status).toBe(202);
    return { orgX, userX, orgY, userY, ...c };
  }

  /** Both requests pass every check before either inserts: each waits in getInstallation for the other. */
  function barrier(parties: number) {
    let arrived = 0;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    return async () => {
      arrived += 1;
      if (arrived >= parties) open();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('barrier timeout')), 15_000); });
      try {
        await Promise.race([gate, timeout]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  it.each([1, 2, 3])('round %i: exactly one 200, the other 409; held events go to the winner only; the loser gets no event, repository link or deployment', async (round) => {
    const k = await contested(`race-${round}`);
    const eventsBefore = { [k.orgX]: await eventCount(k.orgX, k.inst), [k.orgY]: await eventCount(k.orgY, k.inst) };
    expect(eventsBefore[k.orgY]).toBe(0);
    const wait = barrier(2);
    const f: FakeGitHub = { ...k.f, onGetInstallation: wait };

    const reconnectStart = await start(k.orgX, k.userX, k.inst, k.f); // the start's own GitHub read is not part of the race
    const code = authorizeOnGitHub(reconnectStart.authorize_url);
    const installState = ((await startInstall(k.orgY, k.userY, deps(f))).body.data as { state: string }).state;
    const [x, y] = await Promise.all([
      claimInstallation({ organizationId: k.orgX, userId: k.userX, state: reconnectStart.state, code, installationId: k.inst, codeVerifier: reconnectStart.code_verifier }, deps(f)),
      claimInstallation({ organizationId: k.orgY, userId: k.userY, state: installState, code: INSTALL_CODE, installationId: k.inst }, deps(f)),
    ]);

    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const [winner, loser, lost] = x.status === 200 ? [k.orgX, k.orgY, y] : [k.orgY, k.orgX, x];
    expect(lost).toEqual({ status: 409, body: { success: false, error: 'installation_claimed_elsewhere' } });
    expect((x.status === 200 ? x : y).body.data).toMatchObject({ status: 'connected', released_events: 2 });
    expect(await owner(k.inst)).toEqual([{ org: winner }]);
    expect(await heldCount(k.inst)).toBe(0);
    expect(await eventCount(winner, k.inst)).toBe(eventsBefore[winner] + 2);
    expect(await eventCount(loser, k.inst)).toBe(eventsBefore[loser]);
    expect(await linkedRepos(loser, k.inst)).toBe(0);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM deployments WHERE organization_id = $1', [loser])).rows[0].n).toBe(0);
  });

  it('deterministic: the loser\'s insert waits on the winner\'s uncommitted claim, then answers 409 with nothing released', async () => {
    const k = await contested('race-ordered');
    const side = await fx.app.connect();
    let pending: ReturnType<typeof claimInstallation> | null = null;
    try {
      // X's claim transaction: claim row + release, not committed yet.
      await side.query("SELECT set_config('app.current_organization_id', $1, false)", [k.orgX]);
      const pid = (await side.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      await side.query('BEGIN');
      expect(await insertInstallationClaim(side, k.orgX, {
        installationId: k.inst, accountId: 777, accountLogin: 'acme', accountType: 'Organization', repositorySelection: 'selected',
        permissions: { ...EXPECTED_PERMISSIONS }, events: [], permissionsState: 'expected', installerGithubUserId: INSTALLER,
        claimedByUserId: k.userX, claimedByGithubUserId: INSTALLER, suspendedAt: null,
      })).toBe('inserted');
      expect(await releaseHeldDeliveries(side, k.inst)).toBe(2);

      // Y passes every check, then its INSERT waits on X's uncommitted key.
      const installState = ((await startInstall(k.orgY, k.userY, deps(k.f))).body.data as { state: string }).state;
      pending = claimInstallation({ organizationId: k.orgY, userId: k.userY, state: installState, code: INSTALL_CODE, installationId: k.inst }, deps(k.f));
      const deadline = Date.now() + 60_000;
      for (;;) {
        const waiting = (await fx.admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).rows[0].n;
        if (waiting > 0) break;
        if (Date.now() > deadline) throw new Error('the second claim never waited for the first');
        await new Promise((r) => setTimeout(r, 25));
      }
      await side.query('COMMIT');
    } catch (error) {
      await side.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      side.release();
    }
    expect(await pending!).toEqual({ status: 409, body: { success: false, error: 'installation_claimed_elsewhere' } });
    expect(await owner(k.inst)).toEqual([{ org: k.orgX }]);
    expect(await eventCount(k.orgY, k.inst)).toBe(0);
    expect(await linkedRepos(k.orgY, k.inst)).toBe(0);
    expect(await heldCount(k.inst)).toBe(0);
  });
});
