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
import { holdDelivery, releaseHeldDeliveries } from '../../../repositories/github-installations.repository';
import { normalizeDelivery } from '../normalize';
import { createFixtures, enabledConfig, CLIENT_SECRET, WEBHOOK_SECRET } from './fixtures/db';
import { installationCreated, installationEvent, signedDelivery, uniqueId, workflowJobCompleted } from './fixtures/payloads';
import { EXPECTED_PERMISSIONS } from '../permissions';

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
