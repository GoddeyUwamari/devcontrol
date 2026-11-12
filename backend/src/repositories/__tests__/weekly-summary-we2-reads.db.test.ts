/**
 * WE-2 reads of the weekly summary (connection health, latest and last
 * completed scan, latest and last completed cost analysis, deployments ever
 * recorded) against a real database. All data is synthetic.
 *
 *   1. Each organization gets its own rows, and nothing of the other's, both
 *      on the job's held client and on the preview path (no client).
 *   2. Tenant context, not only the SQL predicate: under a non-superuser role
 *      (row level security applies) a client tagged for A sees A's rows, and
 *      reading B's id on A's tag finds nothing of B.
 *   3. The CI schema (no aws_accounts table): the connection is 'unknown', the
 *      health read is an error section, and every other read still works.
 *   4. Every cost analysis run status (WE-2 review H-1/L-3): the state it maps
 *      to and the savings line it renders. A partial run with a completion
 *      time is completed with gaps, never "didn't finish".
 *
 * aws_accounts is the shared fixture table (shared-fixture-tables.ts), so the
 * "table present" shape works in CI too; the CI shape is a throwaway schema
 * with the same tables except aws_accounts, used through search_path.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(async () => { throw new Error('AccessDenied: synthetic'); }),
    getCostTrendFetchedAt: jest.fn(async () => null),
  },
}));

import { Pool, PoolClient } from 'pg';
import { WeeklySummaryRepository, weeklySummaryPeriod, type WeeklyEvidence } from '../weekly-summary.repository';
import { composeWeeklySummary, formatInstant, formatInstantDay } from '../../services/weekly-summary-content';
import { ANALYSIS_PARTIAL_NOTE } from '../../config/weekly-email-copy';
import { fixtureEvidence } from '../../jobs/__tests__/weekly-email-fixtures';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import { pool as appPool } from '../../config/database';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const READER_ROLE = `we2_reader_${SUFFIX}`;
const CI_SCHEMA = `we2_ci_${SUFFIX}`;
const NOW = new Date();
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600e3);
const HOUR = 1;
const DAY = 24;

interface Seeded { org: string; account: string; times: string[] }
let A: Seeded;
let B: Seeded;
const orgIds: string[] = [];

async function org(label: string): Promise<string> {
  const id = (await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $1, $1, 'free', 'free') RETURNING id::text AS id`,
    [`we2-${label}-${SUFFIX}`]
  )).rows[0].id as string;
  orgIds.push(id);
  return id;
}

async function account(orgId: string, n: number): Promise<string> {
  return (await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status, connected_at)
     VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlRole', $2, 'placeholder-external-id', 'us-east-1', 'active', NOW())
     RETURNING id::text AS id`,
    [orgId, `ph-${SUFFIX}-${n}`]
  )).rows[0].id as string;
}

/** A job: started at `at`, finished 10 minutes later unless still running. */
async function job(db: Pick<PoolClient, 'query'>, orgId: string, status: string, compliance: boolean, at: Date) {
  const done = status === 'running' || status === 'pending' ? null : new Date(at.getTime() + 10 * 60e3);
  await db.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, compliance_scan_completed, started_at, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $4)`,
    [orgId, status, compliance, at, done]
  );
  return done ?? at;
}

async function run(db: Pick<PoolClient, 'query'>, orgId: string, status: string, at: Date) {
  const done = status === 'running' ? null : new Date(at.getTime() + 5 * 60e3);
  await db.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, started_at, completed_at, created_at, source)
     VALUES ($1, $2, $3, $4, $3, 'discovery')`,
    [orgId, status, at, done]
  );
  return done ?? at;
}

async function deployment(db: Pick<PoolClient, 'query'>, orgId: string) {
  const service = (await db.query(
    `INSERT INTO services (name, template, owner, organization_id) VALUES ($1, 'synthetic', 'synthetic', $2) RETURNING id`,
    [`we2-svc-${SUFFIX}`, orgId]
  )).rows[0].id;
  await db.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id, deployed_at)
     VALUES ($1, 'production', 'us-east-1', 'success', 'synthetic', $2, $3)`,
    [service, orgId, ago(30 * DAY)]
  );
}

/** A: failing connection, latest scan and analysis didn't finish, older completed ones, no deployment. */
async function seedA(db: Pick<PoolClient, 'query'>, orgId: string, accountId: string | null): Promise<string[]> {
  if (accountId) {
    await db.query(
      `INSERT INTO aws_connection_checks (aws_account_id, organization_id, last_attempt_at, last_attempt_result,
         last_conclusive_at, health_state, failing_since, consecutive_role_failures)
       VALUES ($1, $2, $3, 'role_refused', $3, 'failing', $4, 2)`,
      [accountId, orgId, ago(HOUR), ago(2 * DAY)]
    );
  }
  const t = [
    await job(db, orgId, 'completed', true, ago(8 * DAY)),
    await job(db, orgId, 'failed', false, ago(3 * HOUR)),
    await run(db, orgId, 'completed', ago(8 * DAY - HOUR)),
    await run(db, orgId, 'failed', ago(3 * HOUR - 0.5)),
  ];
  return t.map(d => d.toISOString());
}

/** B: OK connection, completed latest scan, analysis running, a deployment. */
async function seedB(db: Pick<PoolClient, 'query'>, orgId: string, accountId: string | null): Promise<string[]> {
  if (accountId) {
    await db.query(
      `INSERT INTO aws_connection_checks (aws_account_id, organization_id, last_attempt_at, last_attempt_result,
         last_conclusive_at, last_ok_at, health_state)
       VALUES ($1, $2, $3, 'ok', $3, $3, 'ok')`,
      [accountId, orgId, ago(2 * HOUR)]
    );
  }
  const t = [
    await job(db, orgId, 'completed', true, ago(5 * HOUR)),
    await run(db, orgId, 'running', ago(0.1)),
  ];
  await deployment(db, orgId);
  return [...t.map(d => d.toISOString()), ago(2 * HOUR).toISOString()];
}

/** A client tagged for `orgId`, as the job holds it. */
async function taggedClient(orgId: string, setup?: string[]): Promise<PoolClient> {
  const client = await pool.connect();
  for (const sql of setup ?? []) await client.query(sql);
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  return client;
}

const we2Json = (e: WeeklyEvidence) => JSON.stringify([e.connectionHealth, e.scan, e.costAnalysis, e.deploymentHistory]);

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  const a = await org('a');
  const b = await org('b');
  const accountA = await account(a, 1);
  const accountB = await account(b, 2);
  A = { org: a, account: accountA, times: await seedA(pool, a, accountA) };
  B = { org: b, account: accountB, times: await seedB(pool, b, accountB) };

  // A non-superuser, non-owner role: row level security applies to it.
  await pool.query(`CREATE ROLE ${READER_ROLE} NOLOGIN`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${READER_ROLE}`);
  await pool.query(
    `GRANT SELECT ON aws_accounts, aws_connection_checks, resource_discovery_jobs, cost_analysis_runs, aws_scan_leases, deployments TO ${READER_ROLE}`
  );
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${CI_SCHEMA} CASCADE`);
  await pool.query(`DROP OWNED BY ${READER_ROLE}`).catch(() => undefined);
  await pool.query(`DROP ROLE IF EXISTS ${READER_ROLE}`);
  await pool.query('DELETE FROM aws_connection_checks WHERE organization_id = ANY($1)', [orgIds]);
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
  await pool.end();
  await appPool.end();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('each organization gets its own WE-2 reads (aws_accounts present)', () => {
  const repository = () => new WeeklySummaryRepository(pool);

  it("A on its held client: failing health, unfinished latest scan and analysis, the older completed ones, no deployment; nothing of B's", async () => {
    const client = await taggedClient(A.org);
    try {
      const e = await repository().gatherWeeklyEvidence(A.org, NOW, client);
      expect(e.awsConnection).toBe('connected');
      expect(e.connectionHealth).toMatchObject({ state: 'available', data: { state: 'failing', failingSince: ago(2 * DAY).toISOString() } });
      expect(e.scan?.data).toEqual({
        latest: { state: 'did_not_finish', at: A.times[1], startedAt: ago(3 * HOUR).toISOString() },
        lastCompleted: { at: A.times[0] },
      });
      expect(e.costAnalysis?.data).toMatchObject({ latest: { state: 'did_not_finish', at: A.times[3] }, lastCompleted: { at: A.times[2] } });
      expect(e.deploymentHistory.data).toEqual({ anyRecorded: false });
      for (const t of B.times) expect(we2Json(e)).not.toContain(t);

      const content = composeWeeklySummary(e, { organizationName: 'A (synthetic)', planName: await repository().getPlanName(A.org, client) });
      expect(content.header).toMatch(/^A \(synthetic\) · Visibility plan · /);
      expect(content.status!.lines.map(l => l.text)[0]).toMatch(/^AWS connection: failing since /);
      expect(content.sections.find(s => s.id === 'delivery')!.lines[0].text).toBe('No deployments have been recorded in DevControl yet.');
    } finally {
      client.release();
    }
  });

  it("B on its held client: OK health, completed scan, analysis in progress, a deployment; nothing of A's", async () => {
    const client = await taggedClient(B.org);
    try {
      const e = await repository().gatherWeeklyEvidence(B.org, NOW, client);
      expect(e.connectionHealth?.data).toMatchObject({ state: 'ok', checkedAt: B.times[2] });
      expect(e.scan?.data).toEqual({
        latest: { state: 'completed', at: B.times[0], startedAt: ago(5 * HOUR).toISOString() },
        lastCompleted: { at: B.times[0] },
      });
      expect(e.costAnalysis?.data).toMatchObject({ latest: { state: 'in_progress', at: B.times[1] }, lastCompleted: null });
      expect(e.deploymentHistory.data).toEqual({ anyRecorded: true });
      for (const t of A.times) expect(we2Json(e)).not.toContain(t);
    } finally {
      client.release();
    }
  });

  it('the preview path (no held client): each read opens its own read-only transaction tagged LOCAL for A', async () => {
    const issued: Array<{ sql: string; params: unknown }> = [];
    const connect = pool.connect.bind(pool);
    // pool.query() (callback-style connect) passes through unrecorded.
    jest.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
      if (typeof callback === 'function') return (connect as any)(callback);
      return recordedClient();
    }) as any);
    const recordedClient = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      const recording = ((sql: unknown, params?: unknown) => {
        issued.push({ sql: String(sql), params });
        return (query as any)(sql, params);
      }) as typeof client.query;
      const release = client.release.bind(client);
      client.query = recording;
      client.release = ((err?: Error | boolean) => { client.query = query; client.release = release; return release(err); }) as typeof client.release;
      return client;
    };

    const r = repository();
    const [health, scan, analysis, history] = await Promise.all([
      r.getConnectionHealthSection(A.org, NOW),
      r.getScanSection(A.org),
      r.getCostAnalysisSection(A.org),
      r.getDeploymentHistorySection(A.org),
    ]);
    expect(pool.connect).toHaveBeenCalledTimes(4);
    const tags = issued.filter(q => q.sql.includes('set_config'));
    expect(tags).toEqual(Array(4).fill({ sql: "SELECT set_config('app.current_organization_id', $1, true)", params: [A.org] }));
    expect(issued.filter(q => q.sql === 'BEGIN READ ONLY')).toHaveLength(4);
    expect(issued.filter(q => q.sql === 'COMMIT')).toHaveLength(4);
    expect(health.data?.state).toBe('failing');
    expect(scan.data?.lastCompleted).toEqual({ at: A.times[0] });
    expect(analysis.data?.lastCompleted).toEqual({ at: A.times[2] });
    expect(history.data).toEqual({ anyRecorded: false });
    for (const t of B.times) expect(JSON.stringify([health, scan, analysis, history])).not.toContain(t);
  });
});

describe('tenant context: under row level security each read sees only the tagged organization', () => {
  const asReader = () => [`SET ROLE ${READER_ROLE}`];

  it("a client tagged for A sees A's rows", async () => {
    const client = await taggedClient(A.org, asReader());
    try {
      const repository = new WeeklySummaryRepository(pool);
      const [health, scan, analysis, history] = await Promise.all([
        repository.getConnectionHealthSection(A.org, NOW, client),
        repository.getScanSection(A.org, client),
        repository.getCostAnalysisSection(A.org, client),
        repository.getDeploymentHistorySection(A.org, client),
      ]);
      expect(health.data?.state).toBe('failing');
      expect(scan.data?.lastCompleted).toEqual({ at: A.times[0] });
      expect(analysis.data?.lastCompleted).toEqual({ at: A.times[2] });
      expect(history.data).toEqual({ anyRecorded: false });
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it("asking for B on A's tag finds nothing of B: no scan, no analysis, no deployment, no health row", async () => {
    const client = await taggedClient(A.org, asReader());
    try {
      const repository = new WeeklySummaryRepository(pool);
      const [health, scan, analysis, history] = await Promise.all([
        repository.getConnectionHealthSection(B.org, NOW, client),
        repository.getScanSection(B.org, client),
        repository.getCostAnalysisSection(B.org, client),
        repository.getDeploymentHistorySection(B.org, client),
      ]);
      // aws_accounts has no row level security; aws_connection_checks does, so B's row is invisible.
      expect(health.data?.state).toBe('not_checked_yet');
      expect(scan.data).toEqual({ latest: null, lastCompleted: null });
      expect(analysis.data).toEqual({ latest: null, lastCompleted: null });
      expect(history.data).toEqual({ anyRecorded: false });
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});

describe('the CI schema: no aws_accounts table', () => {
  it("connection 'unknown', health an error section, every other read works", async () => {
    await pool.query(`CREATE SCHEMA ${CI_SCHEMA}`);
    for (const table of ['aws_connection_checks', 'resource_discovery_jobs', 'cost_analysis_runs', 'aws_scan_leases', 'deployments', 'services', 'organizations']) {
      await pool.query(`CREATE TABLE ${CI_SCHEMA}.${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
    }
    const ciOrg = (await pool.query(
      `INSERT INTO ${CI_SCHEMA}.organizations (name, slug, display_name) VALUES ('ci', 'ci', 'ci') RETURNING id::text AS id`
    )).rows[0].id as string;
    const client = await taggedClient(ciOrg, [`SET search_path TO ${CI_SCHEMA}`]);
    try {
      const times = await seedA(client, ciOrg, null);
      const repository = new WeeklySummaryRepository(pool);
      expect(await repository.getAwsConnection(ciOrg, client)).toBe('unknown');
      const [health, scan, analysis, history] = await Promise.all([
        repository.getConnectionHealthSection(ciOrg, NOW, client),
        repository.getScanSection(ciOrg, client),
        repository.getCostAnalysisSection(ciOrg, client),
        repository.getDeploymentHistorySection(ciOrg, client),
      ]);
      expect(health.state).toBe('error');
      expect(health.data).toBeNull();
      expect(scan.data).toMatchObject({ latest: { state: 'did_not_finish', at: times[1] }, lastCompleted: { at: times[0] } });
      expect(analysis.data).toMatchObject({ latest: { state: 'did_not_finish', at: times[3] }, lastCompleted: { at: times[2] } });
      expect(history.data).toEqual({ anyRecorded: false });
    } finally {
      await client.query('RESET search_path');
      client.release();
    }
  });
});

describe('cost analysis run states: mapped state and the savings line (WE-2 review H-1, L-3)', () => {
  /** A run of `status` started at `at`; finished 5 minutes later unless running or `completed` says otherwise. */
  async function analysisRun(orgId: string, status: string, at: Date, o: { completed?: Date | null; leaseAcquired?: Date } = {}) {
    const completed = o.completed !== undefined ? o.completed : status === 'running' ? null : new Date(at.getTime() + 5 * 60e3);
    await pool.query(
      `INSERT INTO cost_analysis_runs (organization_id, status, started_at, completed_at, created_at, source, lease_acquired_at)
       VALUES ($1, $2, $3, $4, $3, 'discovery', $5)`,
      [orgId, status, at, completed, o.leaseAcquired ?? null]
    );
    return (completed ?? at).toISOString();
  }
  async function lease(orgId: string, live: boolean) {
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, '123456789012', 'discovery', 'we2-synthetic', $2, $2, $3)`,
      [orgId, ago(2 * HOUR), live ? new Date(Date.now() + 10 * 60e3) : ago(HOUR)]
    );
  }
  /** The analysis read on a client tagged for the org, and the savings lines it renders on C2's other evidence. */
  async function readAndRender(orgId: string) {
    const client = await taggedClient(orgId);
    try {
      const analysis = await new WeeklySummaryRepository(pool).getCostAnalysisSection(orgId, client);
      // C2's other evidence, on this run's week (so "this week's" is judged against NOW).
      const c2 = { ...(await fixtureEvidence('C2')), period: weeklySummaryPeriod(NOW) };
      const savings = composeWeeklySummary({ ...c2, costAnalysis: analysis }, { organizationName: 'S (synthetic)' })
        .sections.find(s => s.id === 'savings')!.lines.map(l => l.text).filter(Boolean);
      return { analysis, savings };
    } finally {
      client.release();
    }
  }
  const HEADLINE = 'Estimated savings: $845/month across 3 open findings. This is a DevControl estimate, not realized savings.';
  const DIDNT_FINISH = /didn't finish/;

  it('completed: completed, dated by its completion', async () => {
    const o = await org('st-completed');
    const done = await analysisRun(o, 'completed', ago(3 * HOUR));
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toMatchObject({ latest: { state: 'completed', at: done }, lastCompleted: { at: done } });
    expect(analysis.data?.lastCompleted).not.toHaveProperty('partial');
    expect(savings).toEqual([HEADLINE, `From the cost analysis completed ${formatInstant(done)}.`]);
  });

  it('partial: completed with gaps, dated by its own completion with the partial sentence', async () => {
    const o = await org('st-partial');
    const done = await analysisRun(o, 'partial', ago(3 * HOUR));
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toEqual({
      latest: { state: 'partial', at: done, startedAt: ago(3 * HOUR).toISOString() },
      lastCompleted: { at: done, partial: true },
    });
    expect(savings).toEqual([HEADLINE, `From the cost analysis completed ${formatInstant(done)}. ${ANALYSIS_PARTIAL_NOTE}`]);
  });

  it('partial after an older completed run: dated by the partial run, not the older one', async () => {
    const o = await org('st-partial-older');
    const older = await analysisRun(o, 'completed', ago(8 * DAY));
    const done = await analysisRun(o, 'partial', ago(3 * HOUR));
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toMatchObject({ latest: { state: 'partial', at: done }, lastCompleted: { at: done, partial: true } });
    expect(savings).toEqual([HEADLINE, `From the cost analysis completed ${formatInstant(done)}. ${ANALYSIS_PARTIAL_NOTE}`]);
    expect(savings.join('\n')).not.toContain(formatInstantDay(older));
  });

  it('every run partial, none completed: never "didn\'t finish"', async () => {
    const o = await org('st-all-partial');
    await analysisRun(o, 'partial', ago(15 * DAY));
    await analysisRun(o, 'partial', ago(8 * DAY));
    const done = await analysisRun(o, 'partial', ago(3 * HOUR));
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toMatchObject({ latest: { state: 'partial', at: done }, lastCompleted: { at: done, partial: true } });
    expect(savings).toEqual([HEADLINE, `From the cost analysis completed ${formatInstant(done)}. ${ANALYSIS_PARTIAL_NOTE}`]);
    expect(savings.join('\n')).not.toMatch(DIDNT_FINISH);
  });

  it('partial with no completion time: did not finish, and it is not the last completed run', async () => {
    const o = await org('st-partial-open');
    await analysisRun(o, 'partial', ago(3 * HOUR), { completed: null });
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toMatchObject({ latest: { state: 'did_not_finish' }, lastCompleted: null });
    expect(savings).toEqual([HEADLINE, "The last cost analysis didn't finish."]);
  });

  it.each([
    ['failed', 'failed', {}],
    ['interrupted', 'interrupted', {}],
    ['running whose lease expired (interrupted at read)', 'running', { leaseAcquired: ago(2 * HOUR), lease: false }],
    ['running that never took the lease, queued past the timeout (interrupted at read)', 'running', {}],
  ] as const)('%s after an older completed run: did not finish, dated by the older run', async (_label, status, o) => {
    const org_ = await org(`st-${status}-${Math.random().toString(36).slice(2, 6)}`);
    const older = await analysisRun(org_, 'completed', ago(8 * DAY));
    const opts = 'leaseAcquired' in o ? { leaseAcquired: o.leaseAcquired } : {};
    await analysisRun(org_, status, ago(3 * HOUR), opts);
    if ('lease' in o) await lease(org_, o.lease);
    const { analysis, savings } = await readAndRender(org_);
    expect(analysis.data).toMatchObject({ latest: { state: 'did_not_finish' }, lastCompleted: { at: older } });
    expect(savings).toEqual([HEADLINE, `From the last completed cost analysis, ${formatInstantDay(older)}. This week's analysis didn't finish.`]);
    expect(savings.join('\n')).not.toContain(ANALYSIS_PARTIAL_NOTE);
  });

  it('failed after a partial run: did not finish, dated by the partial run with the partial sentence', async () => {
    const o = await org('st-failed-after-partial');
    const partial = await analysisRun(o, 'partial', ago(8 * DAY));
    await analysisRun(o, 'failed', ago(3 * HOUR));
    const { analysis, savings } = await readAndRender(o);
    expect(analysis.data).toMatchObject({ latest: { state: 'did_not_finish' }, lastCompleted: { at: partial, partial: true } });
    expect(savings).toEqual([
      HEADLINE,
      `From the last completed cost analysis, ${formatInstantDay(partial)}. This week's analysis didn't finish. ${ANALYSIS_PARTIAL_NOTE}`,
    ]);
  });

  it.each([
    ['running with a live lease', { leaseAcquired: ago(0.2), lease: true }],
    ['running, queued for the lease within the timeout', { recent: true }],
  ] as const)('%s: in progress', async (_label, o) => {
    const org_ = await org(`st-running-${Math.random().toString(36).slice(2, 6)}`);
    const older = await analysisRun(org_, 'completed', ago(8 * DAY));
    await analysisRun(org_, 'running', 'recent' in o ? ago(0.05) : ago(0.2), 'leaseAcquired' in o ? { leaseAcquired: o.leaseAcquired } : {});
    if ('lease' in o) await lease(org_, o.lease);
    const { analysis, savings } = await readAndRender(org_);
    expect(analysis.data).toMatchObject({ latest: { state: 'in_progress' }, lastCompleted: { at: older } });
    expect(savings).toEqual([HEADLINE, `From the last completed cost analysis, ${formatInstantDay(older)}. A new analysis is in progress.`]);
  });
});
