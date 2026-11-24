/**
 * D8a installation claim (d8a-build.md §1.2, D8-N1) against the real database
 * as devcontrol, with a fake GitHub client (local fixtures, no network):
 * state bound to user + org and single use, OAuth identity, installation
 * access, installer proof, one organization per installation, held
 * deliveries released only to the claimer, and no secret in any log line.
 */
import crypto from 'crypto';
import { claimInstallation, ClaimDeps, retryClaim, startInstall } from '../claim';
import { GitHubAppClient, GitHubClientError, GitHubInstallationDetails } from '../client';
import { ingestDelivery } from '../ingest';
import { processEvent } from '../process';
import { disconnectInstallation, holdDelivery, releaseHeldDeliveries } from '../../../repositories/github-installations.repository';
import { ConnectionSource, withOrgTransaction } from '../db';
import { normalizeDelivery } from '../normalize';
import { createFixtures, enabledConfig, CLIENT_SECRET, WEBHOOK_SECRET } from './fixtures/db';
import { installationCreated, installationEvent, signedDelivery, uniqueId, workflowJobCompleted } from './fixtures/payloads';
import { EXPECTED_PERMISSIONS } from '../permissions';
import { deployRuleBody, storedDeployRule } from '../deploy-rule';

const fx = createFixtures('d8a-claim');
const logs: string[] = [];
const USER_TOKEN = 'ghu_planted_user_token_do_not_log';
const CODE = 'plantedOAuthCode123';

interface FakeGitHub {
  githubUserId: number;
  accessible: number[];
  account?: Partial<GitHubInstallationDetails['account']>;
  repos?: Array<{ id: number; fullName: string }>;
  failWith?: GitHubClientError;
}

function fakeClient(f: FakeGitHub): GitHubAppClient {
  const fail = () => { if (f.failWith) throw f.failWith; };
  return {
    exchangeCode: async (code) => { fail(); if (code !== CODE) throw new GitHubClientError('github_rejected'); return USER_TOKEN; },
    getAuthenticatedUser: async (token) => { expect(token).toBe(USER_TOKEN); return { id: f.githubUserId, login: `gh-${f.githubUserId}` }; },
    listUserInstallations: async () => f.accessible.map((id) => ({ id, account: { id: 777, login: 'acme', type: 'Organization' as const } })),
    getInstallation: async (id) => ({
      id,
      account: { id: 777, login: 'acme', type: 'Organization', ...f.account } as GitHubInstallationDetails['account'],
      repositorySelection: 'selected',
      permissions: { ...EXPECTED_PERMISSIONS },
      events: ['workflow_job'],
    }),
    listInstallationRepositories: async () => (f.repos ?? []).map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: 'main' })),
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

async function newState(org: string, user: string, f: FakeGitHub): Promise<string> {
  const started = await startInstall(org, user, deps(f));
  expect(started.status).toBe(200);
  const data = started.body.data as { install_url: string; state: string };
  expect(data.install_url).toBe(`https://github.com/apps/devcontrol-test/installations/new?state=${data.state}`);
  return data.state;
}

const owner = async (inst: number) =>
  (await fx.admin.query('SELECT organization_id::text AS org FROM github_installations WHERE installation_id = $1', [inst])).rows;

let orgA: string; let userA: string; let userA2: string;
let orgB: string; let userB: string;
const INSTALLER = 8123;

beforeAll(async () => {
  await fx.grantAppReads();
  orgA = await fx.org(); userA = await fx.user(orgA); userA2 = await fx.user(orgA, 'admin');
  orgB = await fx.org(); userB = await fx.user(orgB);
});
afterAll(() => fx.close());
beforeEach(() => { logs.length = 0; });

describe('start', () => {
  it('stores only sha256(state), bound to user and organization, 15 minutes', async () => {
    const state = await newState(orgA, userA, { githubUserId: INSTALLER, accessible: [] });
    const rows = (await fx.admin.query(
      `SELECT encode(state_hash, 'hex') AS h, organization_id::text AS org, user_id::text AS u, round(extract(epoch FROM expires_at - created_at)) AS ttl
         FROM github_install_states WHERE organization_id = $1 AND user_id = $2`, [orgA, userA])).rows;
    expect(rows).toContainEqual({ h: crypto.createHash('sha256').update(state).digest('hex'), org: orgA, u: userA, ttl: '900' });
    const all = JSON.stringify((await fx.admin.query('SELECT * FROM github_install_states WHERE organization_id = $1', [orgA])).rows);
    expect(all).not.toContain(state);
  });

  it('feature off -> 503 and nothing stored', async () => {
    const off = { ...deps({ githubUserId: 1, accessible: [] }), readConfig: () => ({ enabled: false as const, reason: 'disabled' as const, problems: [] }) };
    expect((await startInstall(orgB, userB, off)).status).toBe(503);
  });
});

describe('claim', () => {
  it('the installer claims: connected, held deliveries released and processed, repositories listed (unmapped)', async () => {
    const inst = fx.installationId();
    const repoId = uniqueId();
    await deliver('installation', installationCreated(inst, INSTALLER, [{ id: repoId, full_name: 'acme/held-repo' }]));
    const job = workflowJobCompleted(inst, repoId);
    expect((await deliver('workflow_job', job)).status).toBe(202); // held: unclaimed
    const f = { githubUserId: INSTALLER, accessible: [inst], repos: [{ id: repoId, fullName: 'acme/held-repo' }, { id: uniqueId(), fullName: 'acme/other' }] };
    const state = await newState(orgA, userA, f);
    const result = await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f));
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ status: 'connected', repositories: 2, released_events: 2,
      installation: { installation_id: String(inst), account_login: 'acme', permissions_state: 'expected' } });
    expect(await owner(inst)).toEqual([{ org: orgA }]);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM github_held_deliveries WHERE installation_id = $1', [inst])).rows[0].n).toBe(0);
    const events = (await fx.admin.query(
      `SELECT event, organization_id::text AS org, held_at IS NOT NULL AS was_held, processing_status FROM pipeline_events WHERE installation_id = $1 ORDER BY event`, [inst])).rows;
    expect(events).toEqual([
      { event: 'installation', org: orgA, was_held: true, processing_status: 'processed' },
      // D8a-2: released into an unmapped repository -> kept, no deployment row.
      { event: 'workflow_job', org: orgA, was_held: true, processing_status: 'unmapped' },
    ]);
    const repos = (await fx.admin.query('SELECT full_name, service_id FROM pipeline_repositories WHERE organization_id = $1 AND installation_id = $2 ORDER BY full_name', [orgA, inst])).rows;
    expect(repos).toEqual([{ full_name: 'acme/held-repo', service_id: null }, { full_name: 'acme/other', service_id: null }]);
    // A delivery after the claim goes straight to the organization; the hold function reports 'claimed'.
    const record = normalizeDelivery('workflow_job', workflowJobCompleted(inst, repoId));
    if (record.kind !== 'record') throw new Error('expected a record');
    const c = await fx.app.connect();
    try {
      expect(await holdDelivery(c, crypto.randomUUID(), record.record, 1, 'a'.repeat(64))).toBe('claimed');
    } finally {
      c.release();
    }
    // Claiming again: idempotent.
    const again = await claimInstallation({ organizationId: orgA, userId: userA, state: await newState(orgA, userA, f), code: CODE, installationId: inst }, deps(f));
    expect(again.body.data).toMatchObject({ status: 'already_connected' });

    // Organization B (even with the same GitHub user) cannot take A's installation: 409, A unchanged.
    const stateB = await newState(orgB, userB, f);
    const stolen = await claimInstallation({ organizationId: orgB, userId: userB, state: stateB, code: CODE, installationId: inst }, deps(f));
    expect(stolen).toEqual({ status: 409, body: { success: false, error: 'installation_claimed_elsewhere' } });
    expect(await owner(inst)).toEqual([{ org: orgA }]);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_repositories WHERE organization_id = $1', [orgB])).rows[0].n).toBe(0);
  });

  it('a forged installation id the GitHub user cannot access -> 403, nothing claimed', async () => {
    const victim = fx.installationId();
    await deliver('installation', installationCreated(victim, INSTALLER));
    const f = { githubUserId: 5555, accessible: [fx.installationId()] };
    const state = await newState(orgB, userB, f);
    expect(await claimInstallation({ organizationId: orgB, userId: userB, state, code: CODE, installationId: victim }, deps(f)))
      .toEqual({ status: 403, body: { success: false, error: 'installation_not_accessible' } });
    expect(await owner(victim)).toEqual([]);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM github_held_deliveries WHERE installation_id = $1', [victim])).rows[0].n).toBe(1);
  });

  it('a GitHub user who can access the installation but did not install it -> 403 not_installer', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const member = { githubUserId: 6666, accessible: [inst] };
    const state = await newState(orgB, userB, member);
    expect(await claimInstallation({ organizationId: orgB, userId: userB, state, code: CODE, installationId: inst }, deps(member)))
      .toEqual({ status: 403, body: { success: false, error: 'not_installer' } });
    expect(await owner(inst)).toEqual([]);
  });

  it('state: reused, expired, another user\'s, another organization\'s, unknown -> 400 invalid_state', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const claim = (org: string, user: string, state: string) =>
      claimInstallation({ organizationId: org, userId: user, state, code: CODE, installationId: inst }, deps(f));
    const invalid = { status: 400, body: { success: false, error: 'invalid_state' } };

    const otherUsers = await newState(orgA, userA, f);
    expect(await claim(orgA, userA2, otherUsers)).toEqual(invalid);
    const otherOrgs = await newState(orgA, userA, f);
    expect(await claim(orgB, userB, otherOrgs)).toEqual(invalid);
    expect(await claim(orgA, userA, crypto.randomBytes(32).toString('base64url'))).toEqual(invalid);
    const expired = await newState(orgA, userA, f);
    await fx.admin.query(
      `UPDATE github_install_states SET created_at = NOW() - interval '30 minutes', expires_at = NOW() - interval '15 minutes' WHERE state_hash = $1`,
      [crypto.createHash('sha256').update(expired).digest()]);
    expect(await claim(orgA, userA, expired)).toEqual(invalid);
    expect(await owner(inst)).toEqual([]);
    // The first use of a valid state works; a second use of the same state does not.
    const once = await newState(orgA, userA, f);
    expect((await claim(orgA, userA, once)).status).toBe(200);
    expect(await claim(orgA, userA, once)).toEqual(invalid);
  });

  it('installation.created not received yet -> 202 waiting; a retry after it arrives connects', async () => {
    const inst = fx.installationId();
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const state = await newState(orgA, userA, f);
    const first = await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f));
    expect(first).toEqual({ status: 202, body: { success: true, data: { status: 'waiting_for_github' } } });
    expect(await retryClaim({ organizationId: orgA, userId: userA, state }, deps(f))).toMatchObject({ status: 202 });
    // Another user of the organization cannot use the retry.
    expect((await retryClaim({ organizationId: orgA, userId: userA2, state }, deps(f))).status).toBe(400);
    await deliver('installation', installationCreated(inst, INSTALLER));
    const retried = await retryClaim({ organizationId: orgA, userId: userA, state }, deps(f));
    expect(retried.status).toBe(200);
    expect(await owner(inst)).toEqual([{ org: orgA }]);
  });

  it('installation.created never arrives: retries wait (202), the last allowed retry refuses with the reinstall message, nothing is claimed', async () => {
    const inst = fx.installationId();
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const state = await newState(orgA, userA, f);
    expect((await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f))).status).toBe(202);
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof retryClaim>> | undefined;
    for (let i = 0; i < 10; i++) {
      last = await retryClaim({ organizationId: orgA, userId: userA, state }, deps(f));
      statuses.push(last.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 202, 202, 202, 202, 409]);
    expect(last).toEqual({
      status: 409,
      body: {
        success: false,
        error: 'install_event_not_received',
        message: "We didn't receive the install event from GitHub. Uninstall the DevControl app from your GitHub settings, reinstall it, then try again.",
      },
    });
    expect(logs).toContain(`[github-app] claim installation=${inst} outcome=install_event_missing status=409`);
    // No retry is left after the refusal.
    expect((await retryClaim({ organizationId: orgA, userId: userA, state }, deps(f))).status).toBe(400);
    expect(await owner(inst)).toEqual([]);
  });

  it('the purge keeps a held installation.created past 7 days (the installer can still claim); other held events are purged', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    await deliver('workflow_job', workflowJobCompleted(inst, uniqueId()));
    await fx.admin.query(`UPDATE github_held_deliveries SET received_at = now() - interval '8 days' WHERE installation_id = $1`, [inst]);
    // Called as the application role, as the D8a-2 purge job will.
    await fx.app.query('SELECT github_purge_held_deliveries()');
    const held = async () => (await fx.admin.query(
      'SELECT event, action FROM github_held_deliveries WHERE installation_id = $1 ORDER BY event', [inst])).rows;
    expect(await held()).toEqual([{ event: 'installation', action: 'created' }]);

    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const state = await newState(orgB, userB, f);
    const result = await claimInstallation({ organizationId: orgB, userId: userB, state, code: CODE, installationId: inst }, deps(f));
    expect(result.status).toBe(200);
    expect(await owner(inst)).toEqual([{ org: orgB }]);
    expect(await held()).toEqual([]);
  });

  it('a held installation.deleted removes the held installation.created (other held events are left to the 7-day purge)', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    await deliver('workflow_job', workflowJobCompleted(inst, uniqueId()));
    const deleted = await deliver('installation', installationEvent(inst, 'deleted'));
    expect(deleted.status).toBe(202);
    const held = (await fx.admin.query(
      'SELECT event, action FROM github_held_deliveries WHERE installation_id = $1 ORDER BY event, action', [inst])).rows;
    expect(held).toEqual([{ event: 'installation', action: 'deleted' }, { event: 'workflow_job', action: 'completed' }]);
    expect((await fx.app.query('SELECT github_installer_of($1::bigint)::text AS i', [inst])).rows[0].i).toBeNull();
  });

  it('a retry whose installer turns out to be someone else -> 403, and a never-verified state cannot be retried', async () => {
    const inst = fx.installationId();
    const f = { githubUserId: 7777, accessible: [inst] };
    const state = await newState(orgB, userB, f);
    expect((await claimInstallation({ organizationId: orgB, userId: userB, state, code: CODE, installationId: inst }, deps(f))).status).toBe(202);
    await deliver('installation', installationCreated(inst, INSTALLER));
    expect((await retryClaim({ organizationId: orgB, userId: userB, state }, deps(f))).status).toBe(403);
    const fresh = await newState(orgB, userB, f);
    expect((await retryClaim({ organizationId: orgB, userId: userB, state: fresh }, deps(f))).status).toBe(400);
    expect(await owner(inst)).toEqual([]);
  });

  it('a personal account installed by its own user connects without the held installation.created', async () => {
    const inst = fx.installationId();
    const f = { githubUserId: 4321, accessible: [inst], account: { id: 4321, login: 'solo', type: 'User' as const } };
    const state = await newState(orgB, userB, f);
    const result = await claimInstallation({ organizationId: orgB, userId: userB, state, code: CODE, installationId: inst }, deps(f));
    expect(result.status).toBe(200);
    expect((await fx.admin.query('SELECT installer_github_user_id::text AS i, account_type FROM github_installations WHERE installation_id = $1', [inst])).rows)
      .toEqual([{ i: '4321', account_type: 'User' }]);
  });

  it('setup_action=request -> pending_github_approval and the state is spent; GitHub down -> 502', async () => {
    const f = { githubUserId: INSTALLER, accessible: [] };
    const state = await newState(orgA, userA, f);
    expect(await claimInstallation({ organizationId: orgA, userId: userA, state, setupAction: 'request' }, deps(f)))
      .toEqual({ status: 200, body: { success: true, data: { status: 'pending_github_approval' } } });
    expect((await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: 1 }, deps(f))).status).toBe(400);
    const down = { ...f, failWith: new GitHubClientError('github_unavailable') };
    const s2 = await newState(orgA, userA, down);
    expect(await claimInstallation({ organizationId: orgA, userId: userA, state: s2, code: CODE, installationId: fx.installationId() }, deps(down)))
      .toEqual({ status: 502, body: { success: false, error: 'github_unavailable' } });
  });

  it('two concurrent claims of one installation by one organization -> exactly one claim row', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const [s1, s2] = [await newState(orgA, userA, f), await newState(orgA, userA, f)];
    const results = await Promise.all([s1, s2].map((state) =>
      claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f))));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => (r.body.data as any).status).sort()).toEqual(['already_connected', 'connected']);
    expect(await owner(inst)).toEqual([{ org: orgA }]);
  });

  it('held deliveries are released only to the organization that holds the claim', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const c = await fx.app.connect();
    try {
      await c.query("SELECT set_config('app.current_organization_id', $1, false)", [orgB]);
      expect(await releaseHeldDeliveries(c, inst)).toBe(0); // unclaimed
      await c.query("SELECT set_config('app.current_organization_id', '', false)");
      expect(await releaseHeldDeliveries(c, inst)).toBe(0); // untagged
    } finally {
      c.release();
    }
    await fx.claim(orgA, inst);
    const c2 = await fx.app.connect();
    try {
      await c2.query("SELECT set_config('app.current_organization_id', $1, false)", [orgB]);
      expect(await releaseHeldDeliveries(c2, inst)).toBe(0); // A's claim
      await c2.query("SELECT set_config('app.current_organization_id', $1, false)", [orgA]);
      expect(await releaseHeldDeliveries(c2, inst)).toBe(1);
    } finally {
      c2.release();
    }
  });

  it('D8b disconnect: repositories keep their service and rule, events stay, deliveries are held again; another organization cannot disconnect it; a new claim re-links', async () => {
    const inst = fx.installationId();
    const repoId = uniqueId();
    await deliver('installation', installationCreated(inst, INSTALLER, [{ id: repoId, full_name: 'acme/kept-repo' }]));
    const f = { githubUserId: INSTALLER, accessible: [inst], repos: [{ id: repoId, fullName: 'acme/kept-repo' }] };
    const first = await claimInstallation({ organizationId: orgA, userId: userA, state: await newState(orgA, userA, f), code: CODE, installationId: inst }, deps(f));
    expect(first.body.data).toMatchObject({ status: 'connected', repositories: 1 });
    const serviceId = await fx.service(orgA, `kept-${inst}`);
    const rule = { v: 1, mode: 'none' };
    await fx.admin.query('UPDATE pipeline_repositories SET service_id = $1, deploy_rule = $2::jsonb WHERE organization_id = $3 AND github_repo_id = $4',
      [serviceId, JSON.stringify(rule), orgA, repoId]);
    const eventsBefore = (await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE installation_id = $1', [inst])).rows[0].n;
    expect(eventsBefore).toBeGreaterThan(0);
    const repoRow = async () => (await fx.admin.query(
      'SELECT installation_id::text AS installation_id, service_id::text AS service_id, deploy_rule FROM pipeline_repositories WHERE organization_id = $1 AND github_repo_id = $2',
      [orgA, repoId])).rows;

    // Another organization, through RLS as devcontrol: nothing to disconnect, A unchanged.
    expect(await withOrgTransaction(fx.app, orgB, (c) => disconnectInstallation(c, orgB, inst))).toBeNull();
    expect(await owner(inst)).toEqual([{ org: orgA }]);
    expect(await repoRow()).toEqual([{ installation_id: String(inst), service_id: serviceId, deploy_rule: rule }]);

    // A disconnects.
    expect(await withOrgTransaction(fx.app, orgA, (c) => disconnectInstallation(c, orgA, inst))).toEqual({ repositories: 1 });
    expect(await owner(inst)).toEqual([]);
    expect(await repoRow()).toEqual([{ installation_id: null, service_id: serviceId, deploy_rule: rule }]);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE installation_id = $1', [inst])).rows[0].n).toBe(eventsBefore);
    // Again: already gone.
    expect(await withOrgTransaction(fx.app, orgA, (c) => disconnectInstallation(c, orgA, inst))).toBeNull();
    // GitHub still sends: the delivery is held (no organization), not stored for A.
    expect((await deliver('workflow_job', workflowJobCompleted(inst, repoId))).status).toBe(202);
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE installation_id = $1', [inst])).rows[0].n).toBe(eventsBefore);

    // Connecting again: the installer proof still holds (installation.created is kept in pipeline_events),
    // and the repository is re-linked with its service and rule.
    const again = await claimInstallation({ organizationId: orgA, userId: userA, state: await newState(orgA, userA, f), code: CODE, installationId: inst }, deps(f));
    expect(again.body.data).toMatchObject({ status: 'connected', repositories: 1, released_events: 1 });
    expect(await repoRow()).toEqual([{ installation_id: String(inst), service_id: serviceId, deploy_rule: rule }]);
  });

  it('no token, OAuth code, state, secret or GitHub body in any claim log line', async () => {
    const inst = fx.installationId();
    await deliver('installation', installationCreated(inst, INSTALLER));
    const f = { githubUserId: INSTALLER, accessible: [inst] };
    const state = await newState(orgA, userA, f);
    await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f));
    await claimInstallation({ organizationId: orgA, userId: userA, state, code: CODE, installationId: inst }, deps(f));
    const all = logs.join('\n');
    expect(logs.some((l) => l.includes('outcome=connected'))).toBe(true);
    for (const forbidden of [USER_TOKEN, CODE, state, CLIENT_SECRET, WEBHOOK_SECRET]) expect(all).not.toContain(forbidden);
  });
});

/**
 * D8b-1 fix S-1: a webhook stored for the organization while its disconnect
 * is under way (or just committed) is held, never failed: processing locks
 * the claim (FOR KEY SHARE) against the disconnect's FOR UPDATE, finds it
 * gone, and leaves the event pending / installation_not_claimed. The
 * organization's next claim within 7 days records it; after 7 days it ends
 * ignored / hold_expired, as a held delivery that old is purged.
 */
describe('D8b-1 fix S-1: an event in flight while its installation is disconnected', () => {
  const JOB_RULE = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend' }));

  beforeAll(() => fx.grantDeploymentWrites());

  /** A's installation, claimed, its repository mapped to a service with a job rule (so a deploy job records a deployment). */
  async function connected(label: string) {
    const inst = fx.installationId();
    const repoId = uniqueId();
    await deliver('installation', installationCreated(inst, INSTALLER, [{ id: repoId, full_name: `acme/${label}` }]));
    const f = { githubUserId: INSTALLER, accessible: [inst], repos: [{ id: repoId, fullName: `acme/${label}` }] };
    const claimed = await claimInstallation({ organizationId: orgA, userId: userA, state: await newState(orgA, userA, f), code: CODE, installationId: inst }, deps(f));
    expect(claimed.body.data).toMatchObject({ status: 'connected' });
    const serviceId = await fx.service(orgA, `${label}-${inst}`);
    await fx.admin.query('UPDATE pipeline_repositories SET service_id = $1, deploy_rule = $2::jsonb WHERE organization_id = $3 AND github_repo_id = $4',
      [serviceId, JSON.stringify(JOB_RULE), orgA, repoId]);
    return { inst, repoId, f, serviceId };
  }

  /** A deploy job newer than anything the repository has seen, so processing re-points the repository at the installation. */
  const newerJob = (inst: number, repoId: number) => workflowJobCompleted(inst, repoId, { completedAt: new Date(Date.now() + 60_000).toISOString() });

  const jobEvents = async (inst: number) => (await fx.admin.query(
    `SELECT organization_id::text AS org, processing_status AS status, processing_reason AS reason, processed_at IS NULL AS unprocessed,
            deployment_id IS NOT NULL AS recorded
       FROM pipeline_events WHERE installation_id = $1 AND event = 'workflow_job'`, [inst])).rows;
  const deploymentsFor = async (serviceId: string) =>
    (await fx.admin.query('SELECT count(*)::int AS n FROM deployments WHERE organization_id = $1 AND service_id = $2', [orgA, serviceId])).rows[0].n;
  const linkedTo = async (repoId: number) => (await fx.admin.query(
    'SELECT installation_id::text AS installation_id FROM pipeline_repositories WHERE organization_id = $1 AND github_repo_id = $2', [orgA, repoId])).rows[0].installation_id;

  const deliverWith = (source: ConnectionSource, event: string, payload: unknown) => {
    const d = signedDelivery(event, payload, WEBHOOK_SECRET);
    return ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, { ...ingestDeps, source });
  };

  async function reclaim(c: Awaited<ReturnType<typeof connected>>) {
    return claimInstallation({ organizationId: orgA, userId: userA, state: await newState(orgA, userA, c.f), code: CODE, installationId: c.inst }, deps(c.f));
  }

  // orgA is set in beforeAll, so this is read at run time.
  const heldEvent = () => ({ org: orgA, status: 'pending', reason: 'installation_not_claimed', unprocessed: true, recorded: false });

  it('disconnect under way: processing waits for it, then holds the event (never failed db_23503); connecting again records it', async () => {
    const c = await connected('race-under-way');
    // The disconnect runs first and stays open: claim locked FOR UPDATE, repository detached, claim deleted, not committed.
    const side = await fx.app.connect();
    let delivery: Promise<{ status: number }> | null = null;
    try {
      await side.query("SELECT set_config('app.current_organization_id', $1, false)", [orgA]);
      const pid = (await side.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      await side.query('BEGIN');
      expect(await disconnectInstallation(side, orgA, c.inst)).toEqual({ repositories: 1 });

      // The delivery still resolves A (the delete is not committed), stores the event, and its processing blocks on the disconnect.
      delivery = deliverWith(fx.app, 'workflow_job', newerJob(c.inst, c.repoId));
      const deadline = Date.now() + 60_000;
      for (;;) {
        const waiting = (await fx.admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).rows[0].n;
        if (waiting > 0) break;
        if (Date.now() > deadline) throw new Error('the delivery never waited for the disconnect');
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(await jobEvents(c.inst)).toEqual([{ ...heldEvent(), reason: null }]);
      await side.query('COMMIT');
    } catch (error) {
      await side.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      side.release();
    }

    expect((await delivery!).status).toBe(200);
    expect(await jobEvents(c.inst)).toEqual([heldEvent()]);
    expect(await deploymentsFor(c.serviceId)).toBe(0);
    expect(await linkedTo(c.repoId)).toBeNull();

    const again = await reclaim(c);
    expect(again.body.data).toMatchObject({ status: 'connected' });
    expect(await jobEvents(c.inst)).toEqual([{ org: orgA, status: 'processed', reason: null, unprocessed: false, recorded: true }]);
    expect(await deploymentsFor(c.serviceId)).toBe(1);
    expect(await linkedTo(c.repoId)).toBe(String(c.inst));
  });

  it('disconnect committed between storing and processing: the event is held; connecting again records it', async () => {
    const c = await connected('race-committed');
    // ingest's third connection is the processing one: the disconnect commits just before it.
    let connects = 0;
    const source: ConnectionSource = {
      connect: async () => {
        connects += 1;
        if (connects === 3) {
          expect(await jobEvents(c.inst)).toHaveLength(1);
          expect(await withOrgTransaction(fx.app, orgA, (cl) => disconnectInstallation(cl, orgA, c.inst))).toEqual({ repositories: 1 });
        }
        return fx.app.connect();
      },
    };
    expect((await deliverWith(source, 'workflow_job', newerJob(c.inst, c.repoId))).status).toBe(200);
    expect(connects).toBeGreaterThanOrEqual(3);
    expect(await jobEvents(c.inst)).toEqual([heldEvent()]);
    expect(await deploymentsFor(c.serviceId)).toBe(0);

    expect((await reclaim(c)).body.data).toMatchObject({ status: 'connected' });
    expect(await jobEvents(c.inst)).toEqual([{ org: orgA, status: 'processed', reason: null, unprocessed: false, recorded: true }]);
    expect(await deploymentsFor(c.serviceId)).toBe(1);
  });

  it('held longer than 7 days: connecting again does not record it (ignored / hold_expired), like a purged held delivery', async () => {
    const c = await connected('race-expired');
    let connects = 0;
    const source: ConnectionSource = {
      connect: async () => {
        connects += 1;
        if (connects === 3) await withOrgTransaction(fx.app, orgA, (cl) => disconnectInstallation(cl, orgA, c.inst));
        return fx.app.connect();
      },
    };
    expect((await deliverWith(source, 'workflow_job', newerJob(c.inst, c.repoId))).status).toBe(200);
    expect(await jobEvents(c.inst)).toEqual([heldEvent()]);
    await fx.admin.query(`UPDATE pipeline_events SET received_at = NOW() - interval '7 days 1 minute' WHERE installation_id = $1 AND event = 'workflow_job'`, [c.inst]);

    expect((await reclaim(c)).body.data).toMatchObject({ status: 'connected' });
    expect(await jobEvents(c.inst)).toEqual([{ org: orgA, status: 'ignored', reason: 'hold_expired', unprocessed: false, recorded: false }]);
    expect(await deploymentsFor(c.serviceId)).toBe(0);
  });
});
