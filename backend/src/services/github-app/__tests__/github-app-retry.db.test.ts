/**
 * D8a-3 against the real database, as the devcontrol role: the scheduled
 * retry and the scheduled expiry of stored GitHub App events (founder
 * rulings, d8a3-stage-a.md Addendum 1).
 *
 * Boundaries run inside one open transaction on one connection, so NOW() is
 * frozen and an event exactly 168 hours old can be stored and tested: a
 * microsecond younger, exactly 168 hours, and a microsecond older. Every
 * caller of the shared window is pinned this way (replay, held count,
 * reconnect pick-up, claim-hold expiry, the retry, the scheduled expiry).
 *
 * Behaviour runs on committed rows through the job's own entry points: the
 * event classes (transient, permanent and unknown failures, a lost COMMIT,
 * stored but never processed, holds with and without a claim, a reconnect
 * backlog past 500, over the limit, expired), the backoff and attempt cap,
 * concurrent retries, the run lock, the flag, fairness across organizations,
 * the time budget, and organization isolation.
 */
import { PoolClient } from 'pg';
import { NORMALIZER_VERSION } from '../contract';
import { deployRuleBody, storedDeployRule } from '../deploy-rule';
import { ConnectionSource, withOrgClient } from '../db';
import { ingestDelivery } from '../ingest';
import { normalizeDelivery } from '../normalize';
import { EventProcessor, processEvent, processStoredEvent } from '../process';
import { MAPPING_REPLAY, RULE_REPLAY } from '../replay';
import { expireOrganization, retryOrganization } from '../retry';
import { TRANSIENT_FAILURE_REASONS } from '../failure-class';
import {
  expireClaimHolds,
  expireStaleClaimHolds,
  expireStaleReleasedEvents,
  findReplayableEvents,
  findRetryableEvents,
  findUnprocessedEvents,
  HELD_EVENT_HOURS,
  insertPipelineEvent,
  lockRetryCandidate,
  MAX_PROCESSING_ATTEMPTS,
  NOT_CLAIMED_REASON,
  STALE_PENDING_MINUTES,
} from '../../../repositories/pipeline-events.repository';
import { listRepositoryActivity } from '../../../repositories/pipeline-repositories.repository';
import { GitHubAppEventsJob, RETRY_LOCK_KEY } from '../../../jobs/github-app-events.job';
import { CLIENT_SECRET, createFixtures, enabledConfig, WEBHOOK_SECRET } from './fixtures/db';
import { pullRequestClosed, signedDelivery, uniqueId, workflowJobCompleted } from './fixtures/payloads';

jest.setTimeout(180_000);

const fx = createFixtures('d8a3-retry');
const JOB_RULE = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend' }));
const quiet = () => undefined;

type Db = Pick<PoolClient, 'query'>;

/** Ages relative to the frozen NOW(): just inside, exactly at, just outside the 168-hour window. */
const AGE = { inside: '167:59:59.999999', exactly: '168:00:00', outside: '168:00:00.000001' } as const;

interface Connected { inst: number; repoId: number; serviceId: string }

/** An installation (claimed by `org` unless `claimed` is false) and one repository with a service and a job rule. */
async function connected(org: string, opts: { claimed?: boolean; mapped?: boolean } = {}): Promise<Connected> {
  const claimed = opts.claimed ?? true;
  const inst = fx.installationId();
  if (claimed) await fx.claim(org, inst);
  const repoId = uniqueId(910_000_000_000);
  const serviceId = await fx.service(org, `svc-${repoId}`);
  await fx.admin.query(
    `INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, default_branch, service_id, deploy_rule)
     VALUES ($1, $2, $3, $4, 'main', $5, $6::jsonb)`,
    [org, repoId, claimed ? inst : null, `acme/repo-${repoId}`, opts.mapped === false ? null : serviceId, JSON.stringify(JOB_RULE)]);
  return { inst, repoId, serviceId };
}

interface EventSpec {
  jobId?: number;
  kind?: 'workflow_job' | 'pull_request';
  status?: string;
  reason?: string | null;
  attempts?: number;
  /** received_at = NOW() - age (an interval literal). */
  age: string;
  /** processed_at = NOW() - processedAge; null (default) = never processed. */
  processedAge?: string | null;
  /** Released from github_held_deliveries by a claim: held_at = received_at. */
  released?: boolean;
  deploymentId?: string | null;
}

/** Stores one event row as a given state, on `db` (the admin pool, or a frozen connection tagged for `org`). */
async function store(db: Db, org: string, c: Connected, spec: EventSpec): Promise<string> {
  const jobId = spec.jobId ?? uniqueId();
  const normalized = spec.kind === 'pull_request'
    ? normalizeDelivery('pull_request', pullRequestClosed(c.inst, c.repoId, { prId: jobId }))
    : normalizeDelivery('workflow_job', workflowJobCompleted(c.inst, c.repoId, { jobId }));
  if (normalized.kind !== 'record') throw new Error('fixture did not normalize');
  const r = normalized.record;
  const { rows } = await db.query(
    `INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, occurred_at,
       received_at, held_at, normalizer_version, facts, processing_status, processing_reason, processing_attempts, processed_at, deployment_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW() - $8::interval, CASE WHEN $9::boolean THEN NOW() - $8::interval END,
       $10, $11::jsonb, $12, $13, $14, CASE WHEN $15::interval IS NULL THEN NULL ELSE NOW() - $15::interval END, $16::uuid)
     RETURNING id::text AS id`,
    [org, c.inst, c.repoId, r.event, r.action, r.eventKey, r.occurredAt, spec.age, spec.released === true, NORMALIZER_VERSION,
      JSON.stringify(r.facts), spec.status ?? 'pending', spec.reason ?? null, spec.attempts ?? 0, spec.processedAge ?? null,
      spec.deploymentId ?? null]);
  return rows[0].id;
}

/** Runs `fn` on one devcontrol connection tagged for `org`, inside a transaction that is always rolled back: NOW() is frozen. */
async function frozen<T>(org: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await fx.app.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

const rowOf = async (id: string) => (await fx.admin.query(
  `SELECT processing_status AS status, processing_reason AS reason, processing_attempts AS attempts, processed_at IS NULL AS unprocessed,
          deployment_id::text AS deployment_id
     FROM pipeline_events WHERE id = $1`, [id])).rows[0];
const wholeRow = async (id: string) => (await fx.admin.query('SELECT row_to_json(e)::text AS j FROM pipeline_events e WHERE id = $1', [id])).rows[0]?.j;
const deploymentCount = async (org: string, serviceId?: string) => (await fx.admin.query(
  'SELECT count(*)::int AS n FROM deployments WHERE organization_id = $1 AND ($2::uuid IS NULL OR service_id = $2::uuid)', [org, serviceId ?? null])).rows[0].n;
const eventCount = async (org: string) => (await fx.admin.query('SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1', [org])).rows[0].n;

const retry = (org: string, limit = 50, processor?: EventProcessor, log: (l: string) => void = quiet) =>
  retryOrganization(fx.app, org, { limit, processor, log });

/** A processor that always throws a Postgres-coded error (as a transient or permanent failure would). */
const throwing = (code: string): EventProcessor => async () => {
  throw Object.assign(new Error('planted failure message that must never be logged'), { code });
};

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await fx.grantDeploymentWrites();
  orgA = await fx.org();
  orgB = await fx.org();
});

afterAll(() => fx.close());

describe('the shared 168-hour window: before, at and after the boundary on every caller (ruling 7)', () => {
  it('is an explicit 168 hours', () => {
    expect(HELD_EVENT_HOURS).toBe(168);
  });

  it('retry (failed, transient): 168 h - 1 µs and exactly 168 h are picked; 168 h + 1 µs is not', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const ids = {
        inside: await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: AGE.inside, processedAge: '2 hours' }),
        exactly: await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: AGE.exactly, processedAge: '2 hours' }),
        outside: await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: AGE.outside, processedAge: '2 hours' }),
      };
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      expect(picked).toEqual(expect.arrayContaining([ids.inside, ids.exactly]));
      expect(picked).not.toContain(ids.outside);
    });
  });

  it('retry (stored, never processed): the same boundary', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const ids = {
        inside: await store(client, orgA, c, { age: AGE.inside }),
        exactly: await store(client, orgA, c, { age: AGE.exactly }),
        outside: await store(client, orgA, c, { age: AGE.outside }),
      };
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      expect(picked).toEqual(expect.arrayContaining([ids.inside, ids.exactly]));
      expect(picked).not.toContain(ids.outside);
    });
  });

  it('replay and the held count: the same boundary (unmapped events of a repository with no service)', async () => {
    const c = await connected(orgA, { mapped: false });
    await frozen(orgA, async (client) => {
      for (const age of Object.values(AGE)) await store(client, orgA, c, { status: 'unmapped', reason: 'repository_not_mapped', age, processedAge: '1 hour' });
      const replayed = await findReplayableEvents(client, orgA, c.repoId, MAPPING_REPLAY);
      expect(replayed.events).toHaveLength(2);
      const activity = (await listRepositoryActivity(client, orgA, { mapping: MAPPING_REPLAY, rule: RULE_REPLAY })).get(String(c.repoId));
      expect(activity?.heldForMapping).toBe(2);
    });
  });

  it('reconnect pick-up: the same boundary (released, never processed)', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const ids = Object.fromEntries(await Promise.all(Object.entries(AGE).map(async ([k, age]) =>
        [k, await store(client, orgA, c, { age, released: true })])));
      const picked = (await findUnprocessedEvents(client, orgA, c.inst)).map((e) => e.id).sort();
      expect(picked).toEqual([ids.inside, ids.exactly].sort());
    });
  });

  it('claim-hold expiry at a claim and the scheduled claim-hold expiry: only 168 h + 1 µs expires, identically', async () => {
    const c = await connected(orgA);
    for (const expire of [
      (client: PoolClient) => expireClaimHolds(client, orgA, c.inst),
      (client: PoolClient) => expireStaleClaimHolds(client, orgA),
    ]) {
      await frozen(orgA, async (client) => {
        const ids = Object.fromEntries(await Promise.all(Object.entries(AGE).map(async ([k, age]) =>
          [k, await store(client, orgA, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age })])));
        expect(await expire(client)).toBe(1);
        const status = async (id: string) => (await client.query(
          'SELECT processing_status AS s, processing_reason AS r FROM pipeline_events WHERE organization_id = $1 AND id = $2', [orgA, id])).rows[0];
        expect(await status(ids.outside)).toEqual({ s: 'ignored', r: 'hold_expired' });
        expect(await status(ids.exactly)).toEqual({ s: 'pending', r: NOT_CLAIMED_REASON });
        expect(await status(ids.inside)).toEqual({ s: 'pending', r: NOT_CLAIMED_REASON });
      });
    }
  });

  it('the scheduled expiry of released events: the same boundary', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      for (const age of Object.values(AGE)) await store(client, orgA, c, { age, released: true });
      expect(await expireStaleReleasedEvents(client, orgA)).toBe(1);
    });
  });

  it('measures received_at, not occurred_at, held_at or processed_at', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      // occurred_at is the job's completion time (2026-11-20 in the fixture); processed_at and held_at are set far off.
      const id = await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '1 hour', processedAge: '400 hours', released: true });
      await client.query("UPDATE pipeline_events SET occurred_at = NOW() - interval '400 hours', held_at = NOW() - interval '400 hours' WHERE organization_id = $1 AND id = $2", [orgA, id]);
      expect((await findRetryableEvents(client, orgA, 50)).map((e) => e.id)).toContain(id);
    });
  });

  it('is the same length in a daylight-saving session TimeZone (hours, not days)', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      await client.query("SET LOCAL TimeZone = 'America/New_York'");
      const exactly = await store(client, orgA, c, { age: AGE.exactly });
      const outside = await store(client, orgA, c, { age: AGE.outside });
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      expect(picked).toContain(exactly);
      expect(picked).not.toContain(outside);
      // Why hours: across the 2026-11-01 change in that zone, 7 days back is 169 hours, 168 hours back is 168.
      const { rows } = await client.query(`SELECT extract(epoch FROM ('2026-11-05 12:00+00'::timestamptz - ('2026-11-05 12:00+00'::timestamptz - make_interval(days => 7)))) / 3600 AS by_days,
                                                  extract(epoch FROM ('2026-11-05 12:00+00'::timestamptz - ('2026-11-05 12:00+00'::timestamptz - make_interval(hours => 168)))) / 3600 AS by_hours`);
      expect(Number(rows[0].by_days)).toBe(169);
      expect(Number(rows[0].by_hours)).toBe(168);
    });
  });
});

describe('what the retry picks: transient failures, backoff, attempts (ruling 4)', () => {
  it('backoff 1/2/4/8 h after attempts 1/2/3/4, exactly: one minute short is not picked, one minute past is', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const cases: Array<{ attempts: number; hours: number; id?: string; early?: string }> = [
        { attempts: 1, hours: 1 }, { attempts: 2, hours: 2 }, { attempts: 3, hours: 4 }, { attempts: 4, hours: 8 },
      ];
      for (const k of cases) {
        k.id = await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: k.attempts, age: '9 hours', processedAge: `${k.hours * 60 + 1} minutes` });
        k.early = await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: k.attempts, age: '9 hours', processedAge: `${k.hours * 60 - 1} minutes` });
      }
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      for (const k of cases) {
        expect(picked).toContain(k.id);
        expect(picked).not.toContain(k.early);
      }
    });
  });

  it('never picks a failure after 5 attempts, a permanent code, processing_error or an unknown code (fail closed)', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const never = [
        await store(client, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: MAX_PROCESSING_ATTEMPTS, age: '20 hours', processedAge: '9 hours' }),
        await store(client, orgA, c, { status: 'failed', reason: 'db_23514', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'failed', reason: 'db_23503', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'failed', reason: 'processing_error', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'failed', reason: 'db_xx000', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
      ];
      const transient = [];
      for (const reason of TRANSIENT_FAILURE_REASONS) {
        transient.push(await store(client, orgA, c, { status: 'failed', reason, attempts: MAX_PROCESSING_ATTEMPTS - 1, age: '20 hours', processedAge: '9 hours' }));
      }
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      for (const id of never) expect(picked).not.toContain(id);
      for (const id of transient) expect(picked).toContain(id);
    });
  });

  it('a stored, never-processed event is picked once it is older than 15 minutes, not before', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const old = await store(client, orgA, c, { age: `${STALE_PENDING_MINUTES} minutes 1 second` });
      const young = await store(client, orgA, c, { age: `${STALE_PENDING_MINUTES - 1} minutes 59 seconds` });
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      expect(STALE_PENDING_MINUTES).toBe(15);
      expect(picked).toContain(old);
      expect(picked).not.toContain(young);
    });
  });

  it('never picks over_limit, unmapped, ignored, processed or expired events, nor events that are not deployment candidates', async () => {
    const c = await connected(orgA);
    await frozen(orgA, async (client) => {
      const never = [
        await store(client, orgA, c, { status: 'over_limit', reason: 'monthly_deployment_limit', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'unmapped', reason: 'repository_not_mapped', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'ignored', reason: 'not_deploy_job', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'processed', reason: null, attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { status: 'ignored', reason: 'hold_expired', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { kind: 'pull_request', age: '3 hours' }),
        await store(client, orgA, c, { kind: 'pull_request', status: 'failed', reason: 'db_40p01', attempts: 1, age: '3 hours', processedAge: '2 hours' }),
        await store(client, orgA, c, { reason: 'deploy_detection_pending', age: '3 hours' }),
      ];
      const picked = (await findRetryableEvents(client, orgA, 50)).map((e) => e.id);
      for (const id of never) expect(picked).not.toContain(id);
    });
  });
});

describe('retry outcomes on committed rows', () => {
  it('a transient failure is recorded on retry: one deployment row, the event processed and linked', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_57p01', attempts: 1, age: '2 hours', processedAge: '61 minutes' });
    const counts = await retry(orgA);
    expect(counts).toMatchObject({ considered: 1, recorded: 1 });
    expect(await rowOf(id)).toMatchObject({ status: 'processed', reason: null, attempts: 2, deployment_id: expect.any(String) });
    expect(await deploymentCount(orgA, c.serviceId)).toBe(1);
    expect((await retry(orgA)).considered).toBe(0);
  });

  it('a permanent failure is left exactly as it was', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_22p02', attempts: 1, age: '3 hours', processedAge: '2 hours' });
    const before = await wholeRow(id);
    await retry(orgA);
    expect(await wholeRow(id)).toBe(before);
    expect(await deploymentCount(orgA, c.serviceId)).toBe(0);
  });

  it('gives up after the 5th attempt: stays failed with its code, is logged once (codes only), and is never picked again', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 4, age: '10 hours', processedAge: '9 hours' });
    const lines: string[] = [];
    const counts = await retry(orgA, 50, throwing('40P01'), (l) => lines.push(l));
    expect(counts).toMatchObject({ considered: 1, gaveUp: 1, failed: 0 });
    expect(await rowOf(id)).toMatchObject({ status: 'failed', reason: 'db_40p01', attempts: 5 });
    expect(lines.filter((l) => l.includes('gave_up') && l.includes(id))).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/planted failure message/);
    await fx.admin.query("UPDATE pipeline_events SET processed_at = NOW() - interval '9 hours' WHERE id = $1", [id]);
    expect((await retry(orgA, 50, throwing('40P01'))).considered).toBe(0);
  });

  it('a transient failure that fails again stays retryable; a permanent one is terminal', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '3 hours', processedAge: '2 hours' });
    expect(await retry(orgA, 50, throwing('55P03'))).toMatchObject({ failed: 1, gaveUp: 0 });
    expect(await rowOf(id)).toMatchObject({ status: 'failed', reason: 'db_55p03', attempts: 2 });
    await fx.admin.query("UPDATE pipeline_events SET processed_at = NOW() - interval '3 hours' WHERE id = $1", [id]);
    expect(await retry(orgA, 50, throwing('23514'))).toMatchObject({ gaveUp: 1 });
    await fx.admin.query("UPDATE pipeline_events SET processed_at = NOW() - interval '9 hours' WHERE id = $1", [id]);
    expect((await retry(orgA)).considered).toBe(0);
  });

  it('a lost COMMIT (the transaction committed, its acknowledgement did not arrive) ends already_recorded, never a second row', async () => {
    const c = await connected(orgA);
    const jobId = uniqueId();
    const id = await store(fx.admin, orgA, c, { jobId, age: '20 minutes' });
    // The COMMIT reaches the server, then the client sees the connection drop (an error with no SQLSTATE).
    const losingCommit: ConnectionSource = {
      connect: async () => {
        const real = await fx.app.connect();
        return {
          query: async (...args: unknown[]) => {
            if (args[0] === 'COMMIT') {
              await real.query('COMMIT');
              throw new Error('Connection terminated unexpectedly');
            }
            return (real.query as (...a: unknown[]) => unknown)(...args);
          },
          release: (e?: Error | boolean) => real.release(e),
        } as unknown as PoolClient;
      },
    };
    const [event] = await withOrgClient(fx.app, orgA, (client) => findUnprocessedEvents(client, orgA, c.inst));
    expect(await processStoredEvent(losingCommit, orgA, event)).toEqual({ status: 'failed', reason: 'processing_error' });
    expect(await rowOf(id)).toMatchObject({ status: 'failed', reason: 'processing_error', deployment_id: expect.any(String) });
    expect(await deploymentCount(orgA, c.serviceId)).toBe(1);

    // processing_error is permanent, but the link proves the commit: picked after its backoff, whatever its attempt count.
    await fx.admin.query("UPDATE pipeline_events SET processed_at = NOW() - interval '8 hours 1 minute', processing_attempts = 9 WHERE id = $1", [id]);
    expect(await retry(orgA)).toMatchObject({ considered: 1, settled: 1, recorded: 0 });
    expect(await rowOf(id)).toMatchObject({ status: 'processed', reason: 'already_recorded' });
    expect(await deploymentCount(orgA, c.serviceId)).toBe(1);
    expect((await fx.admin.query(`SELECT count(*)::int AS n FROM deployments WHERE organization_id = $1 AND metadata ->> 'github_job_id' = $2`,
      [orgA, String(jobId)])).rows[0].n).toBe(1);
  });

  it('stored but never processed (a crash), then redelivered by GitHub: the redelivery is a duplicate; the retry records it once', async () => {
    const c = await connected(orgA);
    const payload = workflowJobCompleted(c.inst, c.repoId);
    const d = signedDelivery('workflow_job', payload, WEBHOOK_SECRET);
    const n = normalizeDelivery('workflow_job', payload);
    if (n.kind !== 'record') throw new Error('fixture');
    // Stored, then the process "dies" before processing.
    const stored = await withOrgClient(fx.app, orgA, (client) => insertPipelineEvent(client, orgA, d.deliveryId, n.record, 'f'.repeat(64)));
    const deps = { readConfig: enabledConfig, source: fx.app, processor: processEvent, log: quiet };
    const again = await ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, deps);
    expect(again.body).toMatchObject({ duplicate: true });
    expect(await rowOf(stored.id)).toMatchObject({ status: 'pending', unprocessed: true });
    expect((await retry(orgA)).considered).toBe(0); // under 15 minutes old
    await fx.admin.query("UPDATE pipeline_events SET received_at = NOW() - interval '16 minutes' WHERE id = $1", [stored.id]);
    expect(await retry(orgA)).toMatchObject({ considered: 1, recorded: 1 });
    expect(await retry(orgA)).toMatchObject({ considered: 0 });
    expect(await deploymentCount(orgA, c.serviceId)).toBe(1);
  });

  it('a hold whose installation is not claimed is left alone; once this organization claims it again, the retry records it', async () => {
    const c = await connected(orgA, { claimed: false });
    const id = await store(fx.admin, orgA, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '2 hours' });
    const before = await wholeRow(id);
    expect((await retry(orgA)).considered).toBe(0);
    expect(await wholeRow(id)).toBe(before);
    await fx.claim(orgA, c.inst);
    expect(await retry(orgA)).toMatchObject({ considered: 1, recorded: 1 });
    expect(await deploymentCount(orgA, c.serviceId)).toBe(1);
  });

  it('a hold whose installation another organization now claims is not this organization\'s to retry', async () => {
    const c = await connected(orgA, { claimed: false });
    await fx.claim(orgB, c.inst);
    const id = await store(fx.admin, orgA, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '2 hours' });
    const before = await wholeRow(id);
    expect((await retry(orgA)).considered).toBe(0);
    expect(await wholeRow(id)).toBe(before);
  });

  it('reconnect backlog past 500: the claim pick-up processes 500, the retry records the rest in bounded batches', async () => {
    const org = await fx.org();
    await fx.admin.query('UPDATE organizations SET max_deployments_per_month = -1 WHERE id = $1', [org]);
    const c = await connected(org);
    await fx.admin.query(
      `INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, received_at, held_at,
         normalizer_version, facts)
       SELECT gen_random_uuid(), $1, $2, $3, 'workflow_job', 'completed', 'workflow_job:' || j || ':completed', NOW() - interval '1 hour',
              NOW() - interval '1 hour', 1, jsonb_set($4::jsonb, '{job_id}', to_jsonb(j))
         FROM generate_series($5::bigint, $5::bigint + 504) j`,
      [org, c.inst, c.repoId, JSON.stringify((normalizeDelivery('workflow_job', workflowJobCompleted(c.inst, c.repoId)) as { record: { facts: unknown } }).record.facts),
        uniqueId(950_000_000_000)]);
    const firstPass = await withOrgClient(fx.app, org, (client) => findUnprocessedEvents(client, org, c.inst));
    expect(firstPass).toHaveLength(500);
    for (const ev of firstPass) await processStoredEvent(fx.app, org, ev);
    expect(await deploymentCount(org)).toBe(500);
    expect(await retry(org, 3)).toMatchObject({ considered: 3, recorded: 3 });
    expect(await retry(org, 50)).toMatchObject({ considered: 2, recorded: 2 });
    expect(await deploymentCount(org)).toBe(505);
  });

  it('over the limit: a retried event ends over_limit and is never picked again', async () => {
    const org = await fx.org();
    // One deployment a month, already used in the fixture job's month.
    await fx.admin.query('UPDATE organizations SET subscription_tier = $2, max_deployments_per_month = $3 WHERE id = $1', [org, 'free', 1]);
    const c = await connected(org);
    await fx.admin.query(`INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
      VALUES ($1, 'production', 'us-east-1', 'success', 'seed', '2026-11-20T09:00:00Z', $2)`, [c.serviceId, org]);
    const id = await store(fx.admin, org, c, { status: 'failed', reason: 'db_40001', attempts: 1, age: '2 hours', processedAge: '61 minutes' });
    expect(await retry(org)).toMatchObject({ considered: 1, settled: 1 });
    expect(await rowOf(id)).toMatchObject({ status: 'over_limit', reason: 'monthly_deployment_limit' });
    await fx.admin.query("UPDATE pipeline_events SET processed_at = NOW() - interval '9 hours' WHERE id = $1", [id]);
    expect((await retry(org)).considered).toBe(0);
    expect(await deploymentCount(org)).toBe(1);
  });

  it('organization isolation: a retry of A never reads or changes B\'s rows, even for the same installation and job ids', async () => {
    const a = await connected(orgA);
    const bRepo = { ...a, serviceId: await fx.service(orgB, `svc-b-${a.repoId}`) };
    await fx.admin.query(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, service_id, deploy_rule)
      VALUES ($1, $2, NULL, 'b/repo', $3, $4::jsonb)`, [orgB, a.repoId, bRepo.serviceId, JSON.stringify(JOB_RULE)]);
    const jobId = uniqueId();
    const bId = await store(fx.admin, orgB, bRepo, { jobId, status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    await store(fx.admin, orgA, a, { jobId, status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    const before = await wholeRow(bId);
    await retry(orgA);
    expect(await wholeRow(bId)).toBe(before);
    expect(await deploymentCount(orgB)).toBe(0);
    expect((await fx.admin.query(`SELECT organization_id::text AS org FROM deployments WHERE metadata ->> 'github_job_id' = $1`, [String(jobId)])).rows)
      .toEqual([{ org: orgA }]);
  });
});

describe('the row lock and re-check (ruling 4)', () => {
  it('two concurrent retries of the same organization process each event exactly once', async () => {
    const org = await fx.org();
    const c = await connected(org);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' }));
    }
    const [x, y] = await Promise.all([retry(org), retry(org)]);
    expect(x.recorded + y.recorded).toBe(6);
    expect(x.skipped + y.skipped).toBe(x.considered + y.considered - 6);
    for (const id of ids) expect(await rowOf(id)).toMatchObject({ status: 'processed', attempts: 2 });
    expect(await deploymentCount(org)).toBe(6);
  });

  it('re-checks state: an event processed since it was picked is skipped and left alone', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    const [candidate] = (await withOrgClient(fx.app, orgA, (client) => findRetryableEvents(client, orgA, 50))).filter((e) => e.id === id);
    await fx.admin.query("UPDATE pipeline_events SET processing_status = 'ignored', processing_reason = 'not_deploy_job' WHERE id = $1", [id]);
    expect(await frozen(orgA, (client) => lockRetryCandidate(client, orgA, candidate))).toBe(false);
  });

  it('a guard that cannot take the row lock skips the event without marking it failed', async () => {
    const c = await connected(orgA);
    const id = await store(fx.admin, orgA, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    const holder = await fx.admin.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM pipeline_events WHERE id = $1 FOR UPDATE', [id]);
      expect(await retry(orgA)).toMatchObject({ considered: 1, skipped: 1, failed: 0 });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(await rowOf(id)).toMatchObject({ status: 'failed', reason: 'db_40p01', attempts: 1 });
  });
});

describe('the scheduled expiry (S2, rulings 1 and 6): marks, never deletes', () => {
  it('a workspace that never reconnects: holds past the window expire; younger holds, recorded and other final statuses are untouched', async () => {
    const org = await fx.org();
    const c = await connected(org, { claimed: false });
    const ids = {
      oldHold: await store(fx.admin, org, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '8 days' }),
      oldHoldPr: await store(fx.admin, org, c, { kind: 'pull_request', reason: NOT_CLAIMED_REASON, attempts: 1, age: '8 days' }),
      youngHold: await store(fx.admin, org, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '6 days' }),
      oldReleased: await store(fx.admin, org, c, { age: '8 days', released: true }),
      oldReleasedPr: await store(fx.admin, org, c, { kind: 'pull_request', age: '8 days', released: true }),
      oldLive: await store(fx.admin, org, c, { age: '8 days' }),
      oldProcessed: await store(fx.admin, org, c, { status: 'processed', age: '8 days', processedAge: '8 days', released: true }),
      oldUnmapped: await store(fx.admin, org, c, { status: 'unmapped', reason: 'repository_not_mapped', age: '8 days', processedAge: '8 days' }),
      oldFailed: await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 5, age: '8 days', processedAge: '7 days' }),
      oldOverLimit: await store(fx.admin, org, c, { status: 'over_limit', reason: 'monthly_deployment_limit', age: '8 days', processedAge: '8 days' }),
    };
    const untouched = ['youngHold', 'oldReleasedPr', 'oldLive', 'oldProcessed', 'oldUnmapped', 'oldFailed', 'oldOverLimit'] as const;
    const before = Object.fromEntries(await Promise.all(untouched.map(async (k) => [k, await wholeRow(ids[k])])));
    const rows = await eventCount(org);

    expect(await expireOrganization(fx.app, org)).toEqual({ claimHolds: 2, released: 1 });
    for (const k of ['oldHold', 'oldHoldPr', 'oldReleased'] as const) {
      expect(await rowOf(ids[k])).toMatchObject({ status: 'ignored', reason: 'hold_expired', unprocessed: false, deployment_id: null });
    }
    for (const k of untouched) expect(await wholeRow(ids[k])).toBe(before[k]);
    expect(await eventCount(org)).toBe(rows);
    expect(await deploymentCount(org)).toBe(0);
    // A second run finds nothing more.
    expect(await expireOrganization(fx.app, org)).toEqual({ claimHolds: 0, released: 0 });

    // Reconnecting after expiry records nothing expired: neither the claim pick-up nor the retry takes it.
    await fx.claim(org, c.inst);
    const picked = (await withOrgClient(fx.app, org, (client) => findUnprocessedEvents(client, org, c.inst))).map((e) => e.id);
    expect(picked).not.toContain(ids.oldHold);
    const retried = (await withOrgClient(fx.app, org, (client) => findRetryableEvents(client, org, 50))).map((e) => e.id);
    expect(retried).not.toContain(ids.oldHold);
    expect(retried).not.toContain(ids.oldReleased);
  });

  it('works in bounded batches: with a batch of 2, 3 holds are all marked (two statements)', async () => {
    const org = await fx.org();
    const c = await connected(org, { claimed: false });
    for (let i = 0; i < 3; i += 1) await store(fx.admin, org, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '9 days' });
    expect(await expireOrganization(fx.app, org, 2)).toEqual({ claimHolds: 3, released: 0 });
  });
});

describe('the job (ruling 2: flag; ruling 9: concurrency and interruption)', () => {
  const disabled = () => ({ enabled: false as const, reason: 'disabled' as const, problems: [] });
  const incomplete = () => ({ enabled: false as const, reason: 'incomplete' as const, problems: ['GITHUB_APP_PRIVATE_KEY is not set'] });
  /** Sessions holding the retry run's advisory lock (classid/objid are the key's high and low 32 bits). */
  const lockHolders = async () => (await fx.admin.query(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted
        AND objid = (hashtextextended($1, 0) & 4294967295)::bigint::oid
        AND classid = ((hashtextextended($1, 0) >> 32) & 4294967295)::bigint::oid`, [RETRY_LOCK_KEY])).rows[0].n;
  const countingSource = () => {
    let connects = 0;
    return { source: { connect: () => { connects += 1; return fx.app.connect(); } } as ConnectionSource, connects: () => connects };
  };

  it.each([['off', disabled], ['incomplete', incomplete]])('flag %s: the retry touches no table and records nothing', async (_label, readConfig) => {
    const org = await fx.org();
    const c = await connected(org);
    const id = await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    const before = await wholeRow(id);
    const counting = countingSource();
    const lines: string[] = [];
    const job = new GitHubAppEventsJob({ source: counting.source, readConfig, listOrganizations: async () => [org], log: (l) => lines.push(l) });
    expect(await job.runRetry()).toEqual({ ran: false, reason: 'feature_off' });
    expect(counting.connects()).toBe(0);
    expect(lines).toEqual(['[github-app-events] retry skipped reason=feature_off']);
    expect(await wholeRow(id)).toBe(before);
    expect(await deploymentCount(org)).toBe(0);
  });

  it('flag off: the cleanup still marks expired holds, and writes no deployment row', async () => {
    const org = await fx.org();
    const c = await connected(org, { claimed: false });
    const id = await store(fx.admin, org, c, { reason: NOT_CLAIMED_REASON, attempts: 1, age: '8 days' });
    const job = new GitHubAppEventsJob({ source: fx.app, readConfig: disabled, listOrganizations: async () => [org], log: quiet });
    const result = await job.runCleanup();
    expect(result).toMatchObject({ ran: true, summary: { claimHolds: 1, released: 0, organizations: 1, errors: 0 } });
    expect(await rowOf(id)).toMatchObject({ status: 'ignored', reason: 'hold_expired' });
    expect(await deploymentCount(org)).toBe(0);
  });

  it('flag on: the retry runs, and its log lines carry codes and counts only', async () => {
    const org = await fx.org();
    const c = await connected(org);
    await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 4, age: '10 hours', processedAge: '9 hours' });
    const lines: string[] = [];
    const job = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, listOrganizations: async () => [org], log: (l) => lines.push(l),
      processor: async (client, o, ev) => (ev.facts.kind === 'workflow_job' && lines.length === 0 ? throwing('40P01')(client, o, ev) : processEvent(client, o, ev)) });
    const result = await job.runRetry();
    expect(result).toMatchObject({ ran: true, summary: { considered: 2, organizations: 1 } });
    const text = lines.join('\n');
    for (const secret of [WEBHOOK_SECRET, CLIENT_SECRET, 'planted failure message', 'deploy-backend', 'acme/', 'PRIVATE KEY']) expect(text).not.toContain(secret);
    expect(text).toMatch(/retry done organizations=1 considered=2/);
  });

  it('a second runner skips while the lock is held; an overlapping run in the same process skips too', async () => {
    const org = await fx.org();
    const holder = await fx.admin.connect();
    try {
      expect((await holder.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS l', [RETRY_LOCK_KEY])).rows[0].l).toBe(true);
      expect(await lockHolders()).toBe(1);
      const job = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, listOrganizations: async () => [org], log: quiet });
      expect(await job.runRetry()).toEqual({ ran: false, reason: 'lock_held' });
    } finally {
      await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [RETRY_LOCK_KEY]);
      holder.release();
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const job = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, log: quiet, listOrganizations: async () => { await gate; return [org]; } });
    const first = job.runRetry();
    await new Promise((r) => setTimeout(r, 200));
    expect(await job.runRetry()).toEqual({ ran: false, reason: 'already_running' });
    release();
    expect(await first).toMatchObject({ ran: true });
  });

  it('a run that throws still releases its lock (the next run gets it, and no session keeps it)', async () => {
    const failing = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, log: quiet,
      listOrganizations: async () => { throw Object.assign(new Error('listing failed'), { code: '57P01' }); } });
    await expect(failing.runRetry()).rejects.toThrow('listing failed');
    expect(await lockHolders()).toBe(0);
    const next = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, listOrganizations: async () => [], log: quiet });
    expect(await next.runRetry()).toMatchObject({ ran: true });
  });

  it('fairness: per-organization and per-run caps, and each run starts after the last organization the previous one finished', async () => {
    const orgs = (await Promise.all([fx.org(), fx.org(), fx.org()])).sort();
    for (const org of orgs) {
      const c = await connected(org);
      for (let i = 0; i < 5; i += 1) await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    }
    const perOrgLines: string[] = [];
    const job = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, listOrganizations: async () => orgs, perOrg: 2, perRun: 3,
      log: (l) => { if (/retry org=/.test(l)) perOrgLines.push(l); } });
    const visited = async () => {
      perOrgLines.length = 0;
      const r = await job.runRetry();
      return { r, seen: perOrgLines.map((l) => `${orgs.indexOf(l.match(/org=([0-9a-f-]+)/)![1])}:${l.match(/considered=(\d+)/)![1]}`) };
    };
    const run1 = await visited();
    expect(run1.seen).toEqual(['0:2', '1:1']);
    expect(run1.r).toMatchObject({ ran: true, summary: { considered: 3, stoppedEarly: true } });
    const run2 = await visited();
    expect(run2.seen).toEqual(['2:2', '0:1']);
    const run3 = await visited();
    expect(run3.seen).toEqual(['1:2', '2:1']);
  });

  it('time budget: a run past its budget stops, and the organization it cut short is first next time', async () => {
    const orgs = (await Promise.all([fx.org(), fx.org()])).sort();
    for (const [i, org] of orgs.entries()) {
      const c = await connected(org);
      for (let k = 0; k < 3 - i; k += 1) await store(fx.admin, org, c, { status: 'failed', reason: 'db_40p01', attempts: 1, age: '2 hours', processedAge: '2 hours' });
    }
    // Each event takes 6 "ms" of a 10 ms budget: a run gets two events done.
    let clock = 0;
    const job = new GitHubAppEventsJob({ source: fx.app, readConfig: enabledConfig, listOrganizations: async () => orgs, budgetMs: 10, log: quiet,
      now: () => clock,
      processor: async (client, o, ev) => { clock += 6; return processEvent(client, o, ev); } });
    const pending = async (org: string) => (await fx.admin.query(
      "SELECT count(*)::int AS n FROM pipeline_events WHERE organization_id = $1 AND processing_status = 'failed'", [org])).rows[0].n;
    // Run 1: two of the first organization's three; cut short.
    expect(await job.runRetry()).toMatchObject({ ran: true, summary: { considered: 2, stoppedEarly: true } });
    expect([await pending(orgs[0]), await pending(orgs[1])]).toEqual([1, 2]);
    // Run 2 starts with the organization run 1 cut short, then the next one, and is cut short in it.
    clock = 0;
    expect(await job.runRetry()).toMatchObject({ ran: true, summary: { considered: 2, stoppedEarly: true } });
    expect([await pending(orgs[0]), await pending(orgs[1])]).toEqual([0, 1]);
    clock = 0;
    expect(await job.runRetry()).toMatchObject({ ran: true, summary: { considered: 1 } });
    expect([await pending(orgs[0]), await pending(orgs[1])]).toEqual([0, 0]);
  });
});
