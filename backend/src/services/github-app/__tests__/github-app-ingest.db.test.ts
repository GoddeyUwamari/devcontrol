/**
 * D8a webhook pipeline against the real database, as the devcontrol role:
 * signature failures write nothing, unknown installations are held where the
 * application cannot read them, the organization comes only from the claim,
 * duplicates collapse to one event, repositories are keyed by GitHub id,
 * events survive processing failures, database failures never answer
 * "received", cross-tenant reads see nothing, and no secret reaches a log.
 */
import { Pool, PoolClient } from 'pg';
import { ingestDelivery, WebhookDeps } from '../ingest';
import { processEvent } from '../process';
import { PipelineEventsReader } from '../../../repositories/pipeline-events.repository';
import { listRepositories } from '../../../repositories/pipeline-repositories.repository';
import { withOrgClient } from '../db';
import { createFixtures, enabledConfig, WEBHOOK_SECRET } from './fixtures/db';
import {
  PLANTED, SHA_MERGE, installationCreated, installationEvent, installationRepositories, pullRequestClosed,
  signedDelivery, uniqueId, workflowJobCompleted,
} from './fixtures/payloads';

const fx = createFixtures('d8a-ingest');
const logs: string[] = [];
const deps = (overrides: Partial<WebhookDeps> = {}): WebhookDeps => ({
  readConfig: enabledConfig,
  source: fx.app,
  processor: processEvent,
  log: (line) => logs.push(line),
  ...overrides,
});
const send = (d: ReturnType<typeof signedDelivery>, o: Partial<WebhookDeps> = {}) =>
  ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, deps(o));

async function rowsFor(deliveryId: string) {
  const events = await fx.admin.query('SELECT organization_id::text AS org, processing_status, processing_reason FROM pipeline_events WHERE delivery_id = $1', [deliveryId]);
  const held = await fx.admin.query('SELECT installation_id::text AS inst FROM github_held_deliveries WHERE delivery_id = $1', [deliveryId]);
  return { events: events.rows, held: held.rows };
}

let orgA: string;
let orgB: string;
let instA: number;
let instB: number;

beforeAll(async () => {
  await fx.grantAppReads();
  orgA = await fx.org();
  orgB = await fx.org();
  instA = fx.installationId();
  instB = fx.installationId();
  await fx.claim(orgA, instA);
  await fx.claim(orgB, instB);
});
afterAll(() => fx.close());
beforeEach(() => {
  logs.length = 0;
});

describe('signature: nothing is written on any failure', () => {
  it.each([
    ['invalid', (d: any) => ({ ...d.headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })],
    ['missing', (d: any) => { const { 'x-hub-signature-256': _s, ...h } = d.headers; return h; }],
    ['malformed', (d: any) => ({ ...d.headers, 'x-hub-signature-256': 'md5=abc' })],
  ])('%s signature -> 401, no event and no held row', async (_label, headers) => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const result = await ingestDelivery({ rawBody: d.rawBody, headers: headers(d) }, deps());
    expect(result).toEqual({ status: 401, body: { received: false, error: 'invalid_signature' } });
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });

  it('modified body under the original signature -> 401, nothing written', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const tampered = Buffer.from(d.rawBody.toString().replace('"success"', '"failure"'));
    expect((await ingestDelivery({ rawBody: tampered, headers: d.headers }, deps())).status).toBe(401);
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });

  it('a parsed (non-raw) body is refused before any check', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    expect((await ingestDelivery({ rawBody: JSON.parse(d.rawBody.toString()), headers: d.headers }, deps())).status).toBe(400);
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });

  it('feature off -> 503 and the database is never touched', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const connect = jest.fn();
    const result = await send(d, { readConfig: () => ({ enabled: false, reason: 'disabled', problems: [] }), source: { connect } as unknown as Pool });
    expect(result.status).toBe(503);
    expect(connect).not.toHaveBeenCalled();
  });

  it('signed but malformed: bad delivery id, bad JSON -> 400, nothing written; ping and unsupported -> 200, nothing written', async () => {
    const bad = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET, 'not-a-uuid');
    expect((await send(bad)).status).toBe(400);
    const crypto = await import('crypto');
    const raw = Buffer.from('{"action": "completed",');
    const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const id = crypto.randomUUID();
    expect((await ingestDelivery({ rawBody: raw, headers: { 'x-github-event': 'workflow_job', 'x-github-delivery': id, 'x-hub-signature-256': sig } }, deps())).status).toBe(400);
    expect(await rowsFor(id)).toEqual({ events: [], held: [] });
    const ping = signedDelivery('ping', { zen: 'z', hook_id: 1 }, WEBHOOK_SECRET);
    expect(await send(ping)).toEqual({ status: 200, body: { received: true, stored: false } });
    const queued = signedDelivery('workflow_job', { ...workflowJobCompleted(instA, uniqueId()), action: 'queued' }, WEBHOOK_SECRET);
    expect(await send(queued)).toEqual({ status: 200, body: { received: true, stored: false } });
    const push = signedDelivery('push', { ref: 'refs/heads/main', installation: { id: instA } }, WEBHOOK_SECRET);
    expect(await send(push)).toEqual({ status: 200, body: { received: true, stored: false } });
    for (const d of [ping, queued, push]) expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });
});

describe('organization from the installation claim only', () => {
  it('unknown installation -> held (202) where the application role cannot read it; a redelivery stays one row', async () => {
    const unknown = fx.installationId();
    const d = signedDelivery('workflow_job', workflowJobCompleted(unknown, uniqueId()), WEBHOOK_SECRET);
    expect(await send(d)).toEqual({ status: 202, body: { received: true, stored: 'held', duplicate: false } });
    expect(await send(d)).toEqual({ status: 200, body: { received: true, stored: 'held', duplicate: true } });
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [{ inst: String(unknown) }] });
    const c = await fx.app.connect();
    try {
      await expect(c.query('SELECT 1 FROM github_held_deliveries')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query(`INSERT INTO github_held_deliveries (delivery_id, installation_id, event, action, normalizer_version, facts)
        VALUES (gen_random_uuid(), 1, 'workflow_job', 'completed', 1, '{}')`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      c.release();
    }
  });

  it('a claimed installation stores for its organization; an organization id in the payload is ignored', async () => {
    const payload = { ...workflowJobCompleted(instA, uniqueId()), organization_id: orgB };
    const d = signedDelivery('workflow_job', payload, WEBHOOK_SECRET);
    expect(await send(d)).toEqual({ status: 200, body: { received: true, stored: true, duplicate: false } });
    const { events } = await rowsFor(d.deliveryId);
    // D8a-2: the repository was just created unmapped, so no deployment is recorded.
    expect(events).toEqual([{ org: orgA, processing_status: 'unmapped', processing_reason: 'repository_not_mapped' }]);
    const facts = (await fx.admin.query('SELECT facts::text AS f FROM pipeline_events WHERE delivery_id = $1', [d.deliveryId])).rows[0].f;
    expect(facts).not.toContain(orgB);
    expect(facts).not.toContain(PLANTED.foreignOrg);
  });

  it('duplicate delivery -> one event; the same job under a new delivery id -> still one event', async () => {
    const payload = workflowJobCompleted(instA, uniqueId());
    const d = signedDelivery('workflow_job', payload, WEBHOOK_SECRET);
    expect((await send(d)).body).toMatchObject({ stored: true, duplicate: false });
    expect((await send(d)).body).toMatchObject({ stored: true, duplicate: true });
    const again = signedDelivery('workflow_job', payload, WEBHOOK_SECRET);
    expect((await send(again)).body).toMatchObject({ stored: true, duplicate: true });
    const n = await fx.admin.query(`SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1 AND facts ->> 'job_id' = $2`,
      [orgA, String(payload.workflow_job.id)]);
    expect(n.rows[0].n).toBe(1);
  });

  it('concurrent identical deliveries -> exactly one event', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const results = await Promise.all([send(d), send(d), send(d)]);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect((await rowsFor(d.deliveryId)).events).toHaveLength(1);
  });
});

describe('repositories keyed by GitHub repository id', () => {
  it('rename, a late older event, transfer between installations, removal: one row, history kept', async () => {
    const repoId = uniqueId();
    const instA2 = fx.installationId();
    await fx.claim(orgA, instA2);
    const job = (name: string, inst: number, at: string) => {
      const p = workflowJobCompleted(inst, repoId, { fullName: name });
      p.workflow_job.completed_at = at;
      return signedDelivery('workflow_job', p, WEBHOOK_SECRET);
    };
    await send(job('acme/old-name', instA, '2026-11-20T10:00:00Z'));
    await send(job('acme/new-name', instA, '2026-11-20T11:00:00Z'));
    await send(job('acme/old-name', instA, '2026-11-20T10:30:00Z')); // late, older: must not revert the rename
    let repos = (await withOrgClient(fx.app, orgA, (c) => listRepositories(c, orgA))).filter((r) => r.github_repo_id === String(repoId));
    expect(repos).toEqual([expect.objectContaining({ full_name: 'acme/new-name', installation_id: String(instA), access_state: 'accessible', service_id: null })]);

    await send(job('neworg/new-name', instA2, '2026-11-20T12:00:00Z')); // transferred to another account (installation) of the same org
    await send(signedDelivery('installation_repositories', installationRepositories(instA2, [], [{ id: repoId, full_name: 'neworg/new-name' }]), WEBHOOK_SECRET));
    repos = (await withOrgClient(fx.app, orgA, (c) => listRepositories(c, orgA))).filter((r) => r.github_repo_id === String(repoId));
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ full_name: 'neworg/new-name', installation_id: String(instA2), access_state: 'removed' });
    const history = await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1 AND github_repo_id = $2', [orgA, repoId]);
    expect(history.rows[0].n).toBe(4);
  });

  it('installation_repositories added creates unmapped rows; no service is ever created', async () => {
    const servicesBefore = (await fx.admin.query('SELECT count(*)::int AS n FROM services WHERE organization_id = $1', [orgA])).rows[0].n;
    const repoId = uniqueId();
    await send(signedDelivery('installation_repositories', installationRepositories(instA, [{ id: repoId, full_name: 'acme/added' }], []), WEBHOOK_SECRET));
    const repos = await withOrgClient(fx.app, orgA, (c) => listRepositories(c, orgA));
    expect(repos.find((r) => r.github_repo_id === String(repoId))).toMatchObject({ full_name: 'acme/added', service_id: null });
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM services WHERE organization_id = $1', [orgA])).rows[0].n).toBe(servicesBefore);
  });
});

describe('the D6/D7 fields are persisted and readable without HTTP', () => {
  it('merged PR by merge commit (D6) and job steps / started_at / run_attempt (D7)', async () => {
    const repoId = uniqueId();
    const pr = pullRequestClosed(instA, repoId, { prId: uniqueId() });
    await send(signedDelivery('pull_request', pr, WEBHOOK_SECRET));
    const job = workflowJobCompleted(instA, repoId);
    await send(signedDelivery('workflow_job', job, WEBHOOK_SECRET));
    const reader = new PipelineEventsReader(fx.app);
    const merged = await reader.findMergedPullRequests(orgA, repoId, [SHA_MERGE]);
    expect(merged).toHaveLength(1);
    expect(merged[0].facts).toMatchObject({ merged: true, merged_at: '2026-11-20T09:58:00.000Z', merge_commit_sha: SHA_MERGE, number: 42 });
    expect(merged[0]).toMatchObject({ organizationId: orgA, githubRepoId: String(repoId), processingStatus: 'processed' });
    const jobs = await reader.findWorkflowJobs(orgA, [job.workflow_job.id]);
    expect(jobs[0].facts).toMatchObject({ run_attempt: 2, started_at: '2026-11-20T10:00:05.000Z' });
    expect(jobs[0].facts.steps[1]).toMatchObject({ name: 'Smoke test new deploy', conclusion: 'failure' });
    // Another organization's reader sees none of it.
    expect(await reader.findMergedPullRequests(orgB, repoId, [SHA_MERGE])).toEqual([]);
    expect(await reader.findWorkflowJobs(orgB, [job.workflow_job.id])).toEqual([]);
  });
});

describe('failures', () => {
  it('database unavailable -> 503 {received:false}, never "received"', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const down = { connect: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); } } as unknown as Pool;
    expect(await send(d, { source: down })).toEqual({ status: 503, body: { received: false, error: 'not_recorded' } });
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });

  it('the event insert fails -> 503, no row', async () => {
    const d = signedDelivery('workflow_job', workflowJobCompleted(instA, uniqueId()), WEBHOOK_SECRET);
    const failingInsert = {
      connect: async () => {
        const client = await fx.app.connect();
        const original = client.query;
        const release = client.release;
        (client as any).query = (text: unknown, ...rest: unknown[]) => {
          if (typeof text === 'string' && text.includes('INSERT INTO pipeline_events')) return Promise.reject(Object.assign(new Error('x'), { code: '53300' }));
          return (original as any).call(client, text, ...rest);
        };
        // Restore before the connection goes back to the pool.
        (client as any).release = (err?: Error) => {
          (client as any).query = original;
          (client as any).release = release;
          return release.call(client, err);
        };
        return client;
      },
    } as unknown as Pool;
    expect(await send(d, { source: failingInsert })).toEqual({ status: 503, body: { received: false, error: 'not_recorded' } });
    expect(await rowsFor(d.deliveryId)).toEqual({ events: [], held: [] });
  });

  it('processing fails -> 200, the event is kept and marked failed with a code', async () => {
    const d = signedDelivery('pull_request', pullRequestClosed(instA, uniqueId()), WEBHOOK_SECRET);
    const boom = async (_c: PoolClient) => { throw Object.assign(new Error('secret-looking detail'), { code: '23514' }); };
    expect(await send(d, { processor: boom })).toEqual({ status: 200, body: { received: true, stored: true, duplicate: false } });
    expect((await rowsFor(d.deliveryId)).events).toEqual([{ org: orgA, processing_status: 'failed', processing_reason: 'db_23514' }]);
  });

  it('installation lifecycle: suspend, unsuspend, deleted', async () => {
    const inst = fx.installationId();
    await fx.claim(orgA, inst);
    const state = async () => (await fx.admin.query('SELECT suspended_at IS NOT NULL AS s, deleted_at IS NOT NULL AS d FROM github_installations WHERE installation_id = $1', [inst])).rows[0];
    await send(signedDelivery('installation', installationEvent(inst, 'suspend'), WEBHOOK_SECRET));
    expect(await state()).toEqual({ s: true, d: false });
    await send(signedDelivery('installation', installationEvent(inst, 'unsuspend'), WEBHOOK_SECRET));
    expect(await state()).toEqual({ s: false, d: false });
    await send(signedDelivery('installation', installationEvent(inst, 'deleted'), WEBHOOK_SECRET));
    expect(await state()).toEqual({ s: false, d: true });
  });
});

describe('tenant isolation as devcontrol', () => {
  it('tagged for A: B\'s events and repositories are invisible and cannot be written; untagged sees nothing', async () => {
    await send(signedDelivery('pull_request', pullRequestClosed(instB, uniqueId()), WEBHOOK_SECRET));
    const c = await fx.app.connect();
    try {
      await c.query("SELECT set_config('app.current_organization_id', $1, false)", [orgA]);
      expect((await c.query('SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1', [orgB])).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM pipeline_repositories WHERE organization_id = $1', [orgB])).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM github_installations WHERE organization_id = $1', [orgB])).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id <> $1', [orgA])).rows[0].n).toBe(0);
      await expect(c.query(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, 1, 'x/y')`, [orgB]))
        .rejects.toMatchObject({ code: '42501' });
      expect((await c.query(`UPDATE pipeline_events SET processing_status = 'ignored' WHERE organization_id = $1`, [orgB])).rowCount).toBe(0);
      await c.query("SELECT set_config('app.current_organization_id', '', false)");
      expect((await c.query('SELECT count(*)::int AS n FROM pipeline_events')).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM pipeline_repositories')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
});

describe('logging', () => {
  it('one line per delivery with codes only: never the secret, signature, body or a planted value', async () => {
    const payload = pullRequestClosed(instA, uniqueId());
    const d = signedDelivery('pull_request', payload, WEBHOOK_SECRET);
    await send(d);
    await ingestDelivery({ rawBody: d.rawBody, headers: { ...d.headers, 'x-hub-signature-256': 'sha256=' + '1'.repeat(64) } }, deps());
    const all = logs.join('\n');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(new RegExp(`^\\[github-app\\] delivery=${d.deliveryId} event=pull_request action=closed installation=${instA} processing=processed outcome=stored status=200 ms=\\d+$`));
    expect(logs[1]).toMatch(/^\[github-app\] outcome=invalid_signature status=401 ms=\d+$/);
    for (const forbidden of [WEBHOOK_SECRET, d.headers['x-hub-signature-256'], '1'.repeat(64), PLANTED.prBody, PLANTED.email, 'Revert']) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('installation.created for an unclaimed installation is held (installer proof for the claim)', async () => {
    const inst = fx.installationId();
    const d = signedDelivery('installation', installationCreated(inst, 8123), WEBHOOK_SECRET);
    expect((await send(d)).status).toBe(202);
    const c = await fx.app.connect();
    try {
      expect((await c.query('SELECT github_installer_of($1::bigint)::text AS i', [inst])).rows[0].i).toBe('8123');
    } finally {
      c.release();
    }
  });
});
