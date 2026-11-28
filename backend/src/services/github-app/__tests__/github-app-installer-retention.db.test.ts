/**
 * I3 founder gate: installation.created events are never purged while their
 * installation could be reclaimed.
 *
 * Why it matters: the installer proof a claim needs (github_installer_of) is
 * the sender of the signed installation.created delivery, held in
 * github_held_deliveries or, once released, in the organization's
 * pipeline_events. GitHub never sends it again. Lose it and nobody can
 * reclaim an organization's installation (the reconnect, I3, depends on it).
 *
 * Two halves, so a future retention change fails loudly:
 *  1. Inventory (no database): every statement in the repository (code,
 *     migrations, scripts; tests excluded) that deletes, truncates or drops
 *     rows of pipeline_events or github_held_deliveries, pinned word for word,
 *     each with why it cannot remove a reclaimable installer record. A new or
 *     changed one fails here until it is reviewed against this gate.
 *  2. Behaviour (real database, as devcontrol): every cleanup and retention
 *     path that exists runs over installer records older than any window
 *     (the D8a-3 cleanup and retry runs, their expiry statements, the claim's
 *     own expiry, the held-delivery purge, the install-state sweep, refused
 *     claims), and afterwards each installer record is still there,
 *     github_installer_of still names the installer, and the installer can
 *     still reclaim.
 */
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { claimInstallation, ClaimDeps, startInstall, startReconnect } from '../claim';
import { GitHubAppClient, GitHubClientError } from '../client';
import { ingestDelivery } from '../ingest';
import { processEvent } from '../process';
import { GitHubAppEventsJob } from '../../../jobs/github-app-events.job';
import { deleteExpiredInstallStates, disconnectInstallation } from '../../../repositories/github-installations.repository';
import {
  expireClaimHolds,
  expireStaleClaimHolds,
  expireStaleUnprocessedEvents,
  NOT_CLAIMED_REASON,
} from '../../../repositories/pipeline-events.repository';
import { withOrgClient, withOrgTransaction } from '../db';
import { createFixtures, enabledConfig, WEBHOOK_SECRET } from './fixtures/db';
import { installationCreated, installationEvent, signedDelivery, uniqueId, workflowJobCompleted } from './fixtures/payloads';
import { EXPECTED_PERMISSIONS } from '../permissions';

// ─── 1. Inventory ────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const MIGRATION = 'database/migrations-admin/202611201200_create_github_app_ingestion.sql';
const ROLLBACK = 'database/migrations-admin/202611201200_create_github_app_ingestion_rollback.sql';

/** Tracked source files (tests excluded), comments removed. */
function trackedSources(): Array<{ file: string; text: string }> {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|mjs|cjs|sql|sh|py)$/.test(f))
    .filter((f) => !/(^|\/)__tests__\//.test(f) && !/\.test\.[jt]sx?$/.test(f) && !f.startsWith('node_modules/'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const text = file.endsWith('.sql') ? raw.replace(/--[^\n]*/g, '') : raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return { file, text };
    });
}

const ROW_REMOVAL = /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+(?:ONLY\s+)?(?:public\.)?"?(?:pipeline_events|github_held_deliveries)\b[^;`]*/gi;

/**
 * Every row removal of the two tables that hold installer records, and why it
 * keeps every reclaimable one. Changing this list means re-checking the gate.
 */
const KNOWN_REMOVALS: Array<{ file: string; statement: string; why: string }> = [
  {
    file: MIGRATION,
    statement: "DELETE FROM public.github_held_deliveries WHERE installation_id = p_installation_id AND event = 'installation' AND action = 'created'",
    why: 'github_hold_delivery, only after a held installation.deleted: the installation is gone on GitHub and its id is never reused, so it cannot be reclaimed.',
  },
  {
    file: MIGRATION,
    statement: 'DELETE FROM public.github_held_deliveries h WHERE h.installation_id = p_installation_id RETURNING h.* ) INSERT INTO public.pipeline_events '
      + '(delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, occurred_at, received_at, held_at, normalizer_version, facts, payload_sha256) '
      + 'SELECT delivery_id, owner_org, installation_id, github_repo_id, event, action, event_key, occurred_at, received_at, received_at, normalizer_version, facts, payload_sha256 '
      + 'FROM taken ON CONFLICT DO NOTHING',
    why: 'github_release_held_deliveries: moves the rows into the claiming organization\'s pipeline_events (github_installer_of reads both tables). Not a purge.',
  },
  {
    file: MIGRATION,
    statement: 'DELETE FROM public.github_held_deliveries WHERE delivery_id IN (SELECT delivery_id FROM public.github_held_deliveries '
      + "WHERE received_at < pg_catalog.now() - interval '7 days' AND NOT (event = 'installation' AND action = 'created') ORDER BY received_at LIMIT 5000)",
    why: 'github_purge_held_deliveries (7-day retention; never called today, D8a-3 ruling 1): never installation.created.',
  },
  { file: ROLLBACK, statement: 'DROP TABLE public.pipeline_events', why: 'the admin rollback removes the whole GitHub App feature, claims included.' },
  { file: ROLLBACK, statement: 'DROP TABLE public.github_held_deliveries', why: 'the admin rollback removes the whole GitHub App feature, claims included.' },
];

describe('inventory: every row removal of pipeline_events / github_held_deliveries is known and keeps reclaimable installer records', () => {
  const sources = trackedSources();

  it('the removals in the repository are exactly the known ones (a new or changed retention path fails here)', () => {
    const found = sources.flatMap(({ file, text }) =>
      [...text.matchAll(ROW_REMOVAL)].map((m) => ({ file, statement: m[0].replace(/\s+/g, ' ').trim() })));
    expect(found).toEqual(KNOWN_REMOVALS.map(({ file, statement }) => ({ file, statement })));
  });

  it('the held-delivery purge is called by nothing but its own migration (no job, route, script or service)', () => {
    const callers = sources.filter(({ text }) => /github_purge_held_deliveries/.test(text)).map(({ file }) => file).sort();
    expect(callers).toEqual([MIGRATION, ROLLBACK].sort());
  });

  it('the installation.created hold delete runs only after a held installation.deleted', () => {
    const migration = sources.find((s) => s.file === MIGRATION)!.text.replace(/\s+/g, ' ');
    expect(migration).toContain("IF inserted = 1 AND p_event = 'installation' AND p_action = 'deleted' THEN DELETE FROM public.github_held_deliveries "
      + "WHERE installation_id = p_installation_id AND event = 'installation' AND action = 'created'; END IF;");
  });

  it('no code deletes an organization: pipeline_events cascades on organization delete, which would take its released installer records with it', () => {
    const migration = sources.find((s) => s.file === MIGRATION)!.text.replace(/\s+/g, ' ');
    // The known cascade (I3 build report, open question): today nothing deletes an organization.
    expect(migration).toMatch(/CREATE TABLE public\.pipeline_events \( id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\), delivery_id UUID NOT NULL, organization_id UUID NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE,/);
    const deleters = sources.filter(({ text }) => /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?"?organizations\b/i.test(text)).map(({ file }) => file);
    // The local stack's demo reseed only (dev/local, refused outside the local stack by seed-guard.js; its own example-saas organization).
    expect(deleters).toEqual(['dev/local/seed-icp.js']);
    expect(sources.find((s) => s.file === 'dev/local/seed-icp.js')!.text).toMatch(/DELETE FROM organizations WHERE slug = \$1', \[ORGANIZATION\.slug\]/);
  });
});

// ─── 2. Behaviour ────────────────────────────────────────────────────────────

const fx = createFixtures('i3-retention');
const quiet = () => undefined;
const INSTALLER = 8125;
const CODE = 'plantedRetentionCode1';

/** A fake GitHub; reconnect codes carry PKCE (checked loosely here: the reconnect suite checks it exactly). */
function fakeClient(githubUserId: number, accessible: number[]): GitHubAppClient {
  return {
    exchangeCode: async (code, pkce) => {
      if (code === CODE && pkce === undefined) return 'ghu_retention';
      if (code.startsWith('rc') && pkce) return 'ghu_retention';
      throw new GitHubClientError('github_rejected');
    },
    getAuthenticatedUser: async () => ({ id: githubUserId, login: `gh-${githubUserId}` }),
    listUserInstallations: async () => accessible.map((id) => ({ id, account: { id: 777, login: 'acme', type: 'Organization' as const } })),
    getInstallation: async (id) => ({
      id, account: { id: 777, login: 'acme', type: 'Organization' }, repositorySelection: 'selected',
      permissions: { ...EXPECTED_PERMISSIONS }, events: ['workflow_job'], suspendedAt: null,
    }),
    listInstallationRepositories: async () => [],
  };
}
const deps = (githubUserId: number, accessible: number[]): ClaimDeps => ({
  readConfig: enabledConfig, source: fx.app, github: () => fakeClient(githubUserId, accessible), processor: processEvent, log: quiet,
});
const deliver = (event: string, payload: unknown) => {
  const d = signedDelivery(event, payload, WEBHOOK_SECRET);
  return ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, { readConfig: enabledConfig, source: fx.app, processor: processEvent, log: quiet });
};
const installClaim = async (org: string, user: string, inst: number, githubUserId: number) => {
  const state = ((await startInstall(org, user, deps(githubUserId, [inst]))).body.data as { state: string }).state;
  return claimInstallation({ organizationId: org, userId: user, state, code: CODE, installationId: inst }, deps(githubUserId, [inst]));
};

let orgR: string; let userR: string;
let orgS: string; let userS: string;
let heldOnly: number;   // never claimed: its installation.created is held
let released: number;   // claimed by R, then disconnected: its installation.created is in R's pipeline_events

/** Every installer record, as rows, and what github_installer_of says. */
async function installerRecords() {
  const held = (await fx.admin.query(
    `SELECT installation_id::text AS i, facts -> 'sender' ->> 'id' AS sender FROM github_held_deliveries
      WHERE installation_id = ANY($1::bigint[]) AND event = 'installation' AND action = 'created' ORDER BY 1`, [[heldOnly, released]])).rows;
  const stored = (await fx.admin.query(
    `SELECT installation_id::text AS i, organization_id::text AS org, facts -> 'sender' ->> 'id' AS sender FROM pipeline_events
      WHERE installation_id = ANY($1::bigint[]) AND event = 'installation' AND action = 'created' ORDER BY 1`, [[heldOnly, released]])).rows;
  const installerOf = async (inst: number) => (await fx.app.query('SELECT github_installer_of($1::bigint)::text AS i', [inst])).rows[0].i;
  return { held, stored, installers: [await installerOf(heldOnly), await installerOf(released)] };
}

let expected: Awaited<ReturnType<typeof installerRecords>>;

/** A job run, retried while another test file's run holds the job's lock (shared database). */
async function runJob(kind: 'cleanup' | 'retry', readConfig = enabledConfig) {
  const job = new GitHubAppEventsJob({ source: fx.app, readConfig, listOrganizations: async () => [orgR, orgS], log: quiet });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = kind === 'cleanup' ? await job.runCleanup() : await job.runRetry();
    if (result.ran) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the ${kind} run never got its lock`);
}

beforeAll(async () => {
  await fx.grantAppReads();
  await fx.grantDeploymentWrites();
  orgR = await fx.org(); userR = await fx.user(orgR);
  orgS = await fx.org(); userS = await fx.user(orgS);

  heldOnly = fx.installationId();
  expect((await deliver('installation', installationCreated(heldOnly, INSTALLER))).status).toBe(202);
  expect((await deliver('workflow_job', workflowJobCompleted(heldOnly, uniqueId()))).status).toBe(202);

  released = fx.installationId();
  expect((await deliver('installation', installationCreated(released, INSTALLER))).status).toBe(202);
  expect((await installClaim(orgR, userR, released, INSTALLER)).body.data).toMatchObject({ status: 'connected' });
  expect(await withOrgTransaction(fx.app, orgR, (c) => disconnectInstallation(c, orgR, released))).toEqual({ repositories: 0 });

  // Older than every window: 30 days.
  await fx.admin.query(`UPDATE github_held_deliveries SET received_at = NOW() - interval '30 days' WHERE installation_id = $1`, [heldOnly]);
  // The released record, aged too, and left as an unprocessed claim hold (the shape every expiry statement selects).
  await fx.admin.query(
    `UPDATE pipeline_events SET received_at = NOW() - interval '30 days', processing_status = 'pending', processing_reason = $2, processed_at = NULL
      WHERE organization_id = $1 AND installation_id = $3 AND event = 'installation' AND action = 'created'`, [orgR, NOT_CLAIMED_REASON, released]);

  expected = await installerRecords();
  expect(expected).toEqual({
    held: [{ i: String(heldOnly), sender: String(INSTALLER) }],
    stored: [{ i: String(released), org: orgR, sender: String(INSTALLER) }],
    installers: [String(INSTALLER), String(INSTALLER)],
  });
});
afterAll(() => fx.close());

describe('behaviour: every existing cleanup and retention path keeps installer records', () => {
  afterEach(async () => {
    expect(await installerRecords()).toEqual(expected);
  });

  it('D8a-3 cleanup run (flag on, and flag off: the cleanup runs either way)', async () => {
    expect(await runJob('cleanup')).toMatchObject({ ran: true, summary: { errors: 0 } });
    expect(await runJob('cleanup', () => ({ enabled: false, reason: 'disabled', problems: [] }))).toMatchObject({ ran: true });
    // Not vacuous: the cleanup did act on the aged claim hold. It marks; it never deletes.
    expect((await fx.admin.query(
      `SELECT processing_status, processing_reason FROM pipeline_events WHERE organization_id = $1 AND installation_id = $2 AND event = 'installation'`,
      [orgR, released])).rows).toEqual([{ processing_status: 'ignored', processing_reason: 'hold_expired' }]);
  });

  it('D8a-3 retry run', async () => {
    expect(await runJob('retry')).toMatchObject({ ran: true, summary: { errors: 0 } });
  });

  it('the expiry statements themselves, and the claim\'s own expiry', async () => {
    for (const org of [orgR, orgS]) {
      await withOrgClient(fx.app, org, async (c) => {
        await expireStaleClaimHolds(c, org, 1);
        await expireStaleUnprocessedEvents(c, org, 1);
        await expireClaimHolds(c, org, released);
        await expireClaimHolds(c, org, heldOnly);
      });
    }
  });

  it('the held-delivery purge (as the application role), however often it runs; other old held events do go', async () => {
    for (let i = 0; i < 3; i += 1) await fx.app.query('SELECT github_purge_held_deliveries()');
    expect((await fx.admin.query('SELECT event FROM github_held_deliveries WHERE installation_id = $1 ORDER BY event', [heldOnly])).rows)
      .toEqual([{ event: 'installation' }]);
  });

  it('the install-state sweep, a held installation.deleted of another installation, and disconnecting again', async () => {
    for (const org of [orgR, orgS]) await withOrgClient(fx.app, org, (c) => deleteExpiredInstallStates(c, org));
    const other = fx.installationId();
    await deliver('installation', installationCreated(other, INSTALLER));
    expect((await deliver('installation', installationEvent(other, 'deleted'))).status).toBe(202);
    expect(await withOrgTransaction(fx.app, orgR, (c) => disconnectInstallation(c, orgR, released))).toBeNull();
  });

  it('refused claims (not accessible, not the installer, GitHub down) and a refused reconnect start', async () => {
    for (const inst of [heldOnly, released]) {
      expect((await installClaim(orgS, userS, inst, 6668)).status).toBe(403);
      const notListed = ((await startInstall(orgS, userS, deps(INSTALLER, []))).body.data as { state: string }).state;
      expect((await claimInstallation({ organizationId: orgS, userId: userS, state: notListed, code: CODE, installationId: inst }, deps(INSTALLER, []))).status).toBe(403);
      const down: ClaimDeps = { ...deps(INSTALLER, [inst]), github: () => ({ ...fakeClient(INSTALLER, [inst]), getInstallation: async () => { throw new GitHubClientError('github_unavailable'); } }) };
      const s = ((await startInstall(orgS, userS, down)).body.data as { state: string }).state;
      expect((await claimInstallation({ organizationId: orgS, userId: userS, state: s, code: CODE, installationId: inst }, down)).status).toBe(502);
    }
    expect((await startReconnect(orgS, userS, released, deps(INSTALLER, [released]))).status).toBe(404);
  });
});

describe('after all of it, the installer still reclaims both', () => {
  it('the held one by a first install, the released one by a reconnect of the organization that had it', async () => {
    expect((await installClaim(orgS, userS, heldOnly, INSTALLER)).body.data).toMatchObject({ status: 'connected' });
    const started = await startReconnect(orgR, userR, released, deps(INSTALLER, [released]));
    expect(started.status).toBe(200);
    const data = started.body.data as { state: string; code_verifier: string };
    const result = await claimInstallation(
      { organizationId: orgR, userId: userR, state: data.state, code: `rc${crypto.randomBytes(6).toString('hex')}`, installationId: released, codeVerifier: data.code_verifier },
      deps(INSTALLER, [released]));
    expect(result.body.data).toMatchObject({ status: 'connected' });
    expect((await fx.admin.query(
      'SELECT installation_id::text AS i, organization_id::text AS org FROM github_installations WHERE installation_id = ANY($1::bigint[]) ORDER BY 1',
      [[heldOnly, released]])).rows).toEqual([{ i: String(heldOnly), org: orgS }, { i: String(released), org: orgR }].sort((a, b) => a.i.localeCompare(b.i)));
  });
});
