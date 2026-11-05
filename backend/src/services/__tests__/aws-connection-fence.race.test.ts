/**
 * AWS connect PR B: every AWS-derived write belongs to ONE connection.
 *
 * Live Postgres (CI bootstrap schema). Connection A is an aws_accounts row;
 * "B becomes active" is the change PR C's disconnect + reconnect will make,
 * done here the way the app does it: one transaction under the organization's
 * connection lock taken EXCLUSIVE (withConnectionChange) that deletes A's row
 * and inserts B's. B always has the SAME AWS account, role ARN and home region
 * as A (the hardest case): only the row id differs.
 *
 * Covered:
 *   - identities: two row ids, identical account/role/region, differ;
 *   - the A->B race across every affected table: a worker that started under A
 *     writes nothing after B is active, and B's rows, run status, observations
 *     and Security Hub state are unchanged by A's attempts;
 *   - overlapping workers: two scans, scheduled + manual, retry after failure,
 *     same-account reconnect while the stale worker still holds the lease;
 *   - atomicity: the check and its writes are one transaction; a change waits
 *     for an in-flight fenced write (lock-wait numbers are logged);
 *   - lock order: no deadlock against PR C's "exclusive lock, then the lease
 *     rows FOR UPDATE".
 * Placeholders only.
 */
import { Pool, PoolClient } from 'pg';
import { awsConnectionIdentity } from '../../repositories/aws-accounts.repository';
import {
  AWS_CONNECTION_LOCK_KEY_SQL,
  ConnectionChangedError,
  currentConnectionIdentity,
  lockConnectionExclusive,
  withConnectionChange,
  withConnectionFence,
} from '../aws-connection-fence';
import { HeldLease, LeaseHeartbeat, LeaseLostError, acquireJobLease, acquireScanLease, fence, releaseLease, withFencedTransaction } from '../scan-lease';
import { DISCOVERY_JOB_NAME, SCAN_KIND_DISCOVERY, leaseTargetFor, onTaggedConnection } from '../scan-session';
import { recordRegionList } from '../../repositories/multi-region-foundation.repository';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { CostAnalysisRunsRepository } from '../../repositories/cost-analysis-runs.repository';
import { Soc2EvidenceRepository } from '../../repositories/soc2-evidence.repository';
import { SecurityHubFindingsRepository } from '../../repositories/security-hub-findings.repository';
import { SecurityHubStateRepository } from '../../repositories/security-hub-state.repository';
import { recordObservations } from '../../repositories/observability-observations.repository';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 12,
});
const createdOrgIds: string[] = [];

const ACCOUNT = '123456789012';
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/devcontrol-readonly`;
const REGION = 'us-east-1';
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** aws_accounts.account_id is UNIQUE in the fixture: one placeholder value per organization (never a 12-digit id). */
const accountColumn = (org: string) => `ph-${org.replace(/-/g, '').slice(0, 29)}`;

async function insertOrg(): Promise<string> {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Connection Fence Org ${s}`, `connection-fence-org-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

const INSERT_ACCOUNT = `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status, connected_at)
                       VALUES ($1, $2, $3, 'placeholder-external-id', $4, 'active', NOW())
                       RETURNING id, account_id, role_arn, region`;

/** Connects A: the connect route's own transaction shape. Returns A's identity. */
async function connectA(org: string): Promise<string> {
  const { rows } = await withConnectionChange(pool, org, (c) => c.query(INSERT_ACCOUNT, [org, ROLE_ARN, accountColumn(org), REGION]));
  return awsConnectionIdentity(rows[0]);
}

/** B becomes active: A's row replaced by a new one with the same account, role ARN and region. Returns B's identity. */
async function replaceWithB(org: string): Promise<string> {
  const { rows } = await withConnectionChange(pool, org, async (c) => {
    await c.query(`DELETE FROM aws_accounts WHERE org_id = $1`, [org]);
    return c.query(INSERT_ACCOUNT, [org, ROLE_ARN, accountColumn(org), REGION]);
  });
  return awsConnectionIdentity(rows[0]);
}

const scanLease = (org: string, connection: string, holder = 'worker') =>
  onTaggedConnection(pool, org, (c) => acquireScanLease(c, { organizationId: org, awsAccountId: ACCOUNT, scanKind: SCAN_KIND_DISCOVERY, connection }, holder));
const jobLease = (org: string, connection: string | null) =>
  onTaggedConnection(pool, org, (c) => acquireJobLease(c, { organizationId: org, jobName: DISCOVERY_JOB_NAME, connection }, 'cron'));
const release = (lease: HeldLease) => onTaggedConnection(pool, lease.key.organizationId, (c) => releaseLease(c, lease));

/** `fn` on a tagged connection of its own. */
async function tagged<T>(org: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return onTaggedConnection(pool, org, fn);
}

async function insertResource(org: string, name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
     VALUES ($1, $2, $3, $3, 'ec2', $4, 'running') RETURNING id`,
    [org, `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/${name}`, name, REGION]
  );
  return rows[0].id;
}

function shFinding(id: string) {
  const now = new Date().toISOString();
  return {
    findingId: `arn:aws:securityhub:${REGION}:${ACCOUNT}:finding/${id}`,
    productArn: `arn:aws:securityhub:${REGION}::product/aws/securityhub`,
    region: REGION, title: 'placeholder finding', severity: 'high', complianceStatus: 'FAILED', recordState: 'ACTIVE',
    workflowStatus: 'NEW', securityControlId: 'IAM.5', associatedStandardIds: [], relatedRequirements: [],
    resourceType: 'AwsIamUser', resourceId: 'AIDAEXAMPLE', securityHubCreatedAt: now, securityHubUpdatedAt: now, lastSeenAt: now,
  } as any;
}

/** Every table a worker of this organization could write AWS-derived data to, with a fingerprint of its rows. */
const AFFECTED_TABLES = [
  'aws_resources', 'aws_account_regions', 'cost_recommendations', 'cost_finding_detections', 'cost_analysis_runs',
  'security_hub_findings', 'organization_security_hub_state', 'resource_telemetry_observations', 'observability_collection_scopes',
  'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'resource_discovery_jobs',
] as const;

async function snapshot(org: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of AFFECTED_TABLES) {
    const exists = (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table])).rows[0].ok;
    if (!exists) continue;
    const { rows } = await pool.query(`SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t::text), '')) AS h, count(*)::int AS n FROM ${table} t WHERE organization_id = $1`, [org]);
    out[table] = `${rows[0].n}:${rows[0].h}`;
  }
  return out;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('identity: the row id comes first', () => {
  it('two connection rows with identical account, role ARN and region have different identities; a stale lease from the first writes nothing after the second is active', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;
    const b = await replaceWithB(org);

    expect(JSON.parse(a).slice(1)).toEqual(JSON.parse(b).slice(1));
    expect(a).not.toBe(b);

    await expect(tagged(org, (c) => withFencedTransaction(c, leaseA, async () => {
      await c.query(`INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
                     VALUES ($1, 'arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0', 'stale', 'stale', 'ec2', 'us-east-1', 'running')`, [org]);
    }))).rejects.toMatchObject({ reason: 'account_changed' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM aws_resources WHERE organization_id = $1`, [org])).rows[0].n).toBe(0);
    await release(leaseA);
  });
});

describe('the A->B race across every affected table', () => {
  it('a worker that started under A commits nothing after B is active; B\'s rows, run status, observations and Security Hub state are unchanged', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    // Worker A starts: its identity, its scan lease, the cron's job lease, its own run row.
    const leaseA = (await scanLease(org, a, 'worker-a'))!;
    const jobA = (await jobLease(org, a))!;
    const runA = await new CostAnalysisRunsRepository().create(org, { leaseAcquiredAt: leaseA.acquiredAt });

    // B becomes active, and B's own state exists (written by B's workers, under B).
    const b = await replaceWithB(org);
    const resourceB = await insertResource(org, 'i-0123456789abcdef0');
    await pool.query(`INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'eu-west-1', true)`, [org, ACCOUNT]);
    const runB = await new CostAnalysisRunsRepository().create(org, { leaseAcquiredAt: new Date() });
    await pool.query(`UPDATE cost_analysis_runs SET status = 'completed', completed_at = NOW() WHERE id = $1`, [runB.id]);
    await new SecurityHubStateRepository().recordSyncResult(org, b, {
      capability: { status: 'ENABLED', checkedAt: new Date().toISOString(), error: null } as any,
      enabledStandards: [], syncStatus: 'COMPLETED', syncError: null, pagesProcessed: 1, findingsCount: 0,
    });
    const writtenByB = await recordObservations(pool, { organizationId: org, awsAccountId: ACCOUNT, region: REGION, connection: b },
      [{ resourceDbId: resourceB, lastDatapointAt: new Date('2026-10-28T09:55:00.000Z'), lastSuccessfulCheckAt: null }], 'complete', new Date('2026-10-28T10:00:00.000Z'));
    expect(writtenByB.persisted).toBe(true);
    const before = await snapshot(org);

    // Worker A, finishing after the change, tries every writer it has.
    const refused: string[] = [];
    const attempt = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        if (error instanceof LeaseLostError || error instanceof ConnectionChangedError) refused.push(name);
        else throw error;
      }
    };
    await attempt('discovery upsert (aws_resources)', () => tagged(org, (c) => withFencedTransaction(c, leaseA, () =>
      c.query(`INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
               VALUES ($1, 'arn:aws:ec2:us-east-1:123456789012:instance/i-from-a', 'i-from-a', 'i-from-a', 'ec2', 'us-east-1', 'running')`, [org]))));
    await attempt('region list', () => tagged(org, (c) => recordRegionList(c, leaseA, [{ region: 'ap-south-1', optInStatus: null, enabled: true }])));
    const finding = { resource_id: 'i-from-a', resource_name: 'x', resource_type: 'EC2', issue: 'Idle Instance', description: 'x', potential_savings: 1, severity: 'LOW', aws_region: REGION, metadata: {} } as any;
    await attempt('cost reconcile', () => new CostRecommendationsRepository().reconcileActiveRecommendations(org, [{ issue: 'Idle Instance', success: true, recommendations: [finding] }], { homeRegion: REGION }, leaseA, runA.id));
    await attempt('RI replace', () => new CostRecommendationsRepository().replaceReservedInstanceRecommendations(org, { homeRegion: REGION }, [], leaseA));
    await attempt('run finished', () => new CostAnalysisRunsRepository().markFinished(runA.id, org, {
      recommendationsFound: 1, totalPotentialSavings: 1, summary: { state: 'completed', checks: [], failedDetectorCount: 0, unknownResourceCount: 0 }, counts: null,
    }, leaseA));
    await attempt('SOC 2 persist (job lease)', () => new Soc2EvidenceRepository(pool).persistComputation(org, [], [], [], jobA));
    await attempt('Security Hub page', () => new SecurityHubFindingsRepository().upsertFindings(org, [shFinding('from-a')], a));
    await attempt('Security Hub start', () => new SecurityHubStateRepository().markSyncStarted(org, a));
    await attempt('Security Hub result', () => new SecurityHubStateRepository().recordSyncResult(org, a, {
      capability: { status: 'ERROR', checkedAt: new Date().toISOString(), error: 'from A' } as any,
      enabledStandards: [], syncStatus: 'FAILED', syncError: 'from A', pagesProcessed: 0, findingsCount: 0,
    }));
    const observedByA = await recordObservations(pool, { organizationId: org, awsAccountId: ACCOUNT, region: REGION, connection: a },
      [{ resourceDbId: resourceB, lastDatapointAt: new Date('2026-10-28T11:00:00.000Z'), lastSuccessfulCheckAt: new Date() }], 'complete', new Date('2026-10-28T11:00:00.000Z'));

    expect(refused).toEqual([
      'discovery upsert (aws_resources)', 'region list', 'cost reconcile', 'RI replace', 'run finished',
      'SOC 2 persist (job lease)', 'Security Hub page', 'Security Hub start', 'Security Hub result',
    ]);
    expect(observedByA.persisted).toBe(false);
    // Zero rows from A in any affected table, and B's rows exactly as they were.
    expect(await snapshot(org)).toEqual(before);
    // B's run status and Security Hub state are B's.
    expect((await pool.query(`SELECT status FROM cost_analysis_runs WHERE id = $1`, [runB.id])).rows[0].status).toBe('completed');
    expect((await new SecurityHubStateRepository().get(org))!.lastSyncStatus).toBe('COMPLETED');
    // A's own run row stays as A left it ('running'): only the caller closes it, and only while running.
    expect((await pool.query(`SELECT status FROM cost_analysis_runs WHERE id = $1`, [runA.id])).rows[0].status).toBe('running');
    await release(leaseA);
    await release(jobA);
  });

  it('rows A committed BEFORE the change stay (PR C\'s cleanup removes them); nothing is committed after', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;
    await tagged(org, (c) => recordRegionList(c, leaseA, [{ region: 'us-east-1', optInStatus: null, enabled: true }]));
    await replaceWithB(org);
    await expect(tagged(org, (c) => recordRegionList(c, leaseA, [{ region: 'us-west-2', optInStatus: null, enabled: true }]))).rejects.toBeInstanceOf(LeaseLostError);
    const { rows } = await pool.query(`SELECT region FROM aws_account_regions WHERE organization_id = $1 ORDER BY region`, [org]);
    expect(rows.map((r) => r.region)).toEqual(['us-east-1']);
    await release(leaseA);
  });
});

describe('overlapping workers', () => {
  it('two scans of one connection: the lease admits one; the second starts only after the first ends, and its writes pass', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const first = (await scanLease(org, a, 'first'))!;
    expect(await scanLease(org, a, 'second')).toBeNull();
    await release(first);
    const second = (await scanLease(org, a, 'second'))!;
    await tagged(org, (c) => recordRegionList(c, second, [{ region: 'us-east-1', optInStatus: null, enabled: true }]));
    await release(second);
  });

  it('scheduled + manual across a change: the cron\'s job lease (taken under A) is fenced out; a manual scan under B writes', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const cron = (await jobLease(org, a))!;
    const b = await replaceWithB(org);
    const manual = (await scanLease(org, b, 'manual'))!;
    await expect(new Soc2EvidenceRepository(pool).persistComputation(org, [], [], [], cron)).rejects.toMatchObject({ reason: 'account_changed' });
    await tagged(org, (c) => recordRegionList(c, manual, [{ region: 'us-east-1', optInStatus: null, enabled: true }]));
    await release(cron);
    await release(manual);
  });

  it('retry after failure: the retry re-reads the connection and writes under B', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const attempt1 = (await scanLease(org, a))!;
    await replaceWithB(org);
    await expect(tagged(org, (c) => recordRegionList(c, attempt1, [{ region: 'us-east-1', optInStatus: null, enabled: true }]))).rejects.toBeInstanceOf(LeaseLostError);
    await release(attempt1);
    const target = (await leaseTargetFor(pool, org))!;
    expect(target.connection).toBe(await currentConnectionIdentity(pool, org));
    const attempt2 = (await scanLease(org, target.connection))!;
    await tagged(org, (c) => recordRegionList(c, attempt2, [{ region: 'us-east-1', optInStatus: null, enabled: true }]));
    await release(attempt2);
  });

  it('same-account reconnect while A still holds the lease row: B waits, A is fenced out, then B acquires and writes', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const stale = (await scanLease(org, a, 'stale'))!;
    const b = await replaceWithB(org);
    expect(await scanLease(org, b, 'new')).toBeNull();
    await expect(tagged(org, (c) => fenceIn(c, stale))).rejects.toMatchObject({ reason: 'account_changed' });
    await release(stale);
    const fresh = (await scanLease(org, b, 'new'))!;
    await tagged(org, (c) => recordRegionList(c, fresh, [{ region: 'us-east-1', optInStatus: null, enabled: true }]));
    await release(fresh);
  });
});

async function fenceIn(c: PoolClient, lease: HeldLease): Promise<void> {
  await c.query('BEGIN');
  try {
    await fence(c, lease);
  } finally {
    await c.query('ROLLBACK');
  }
}

async function waitingForConnectionLock(org: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND NOT l.granted
                     AND ((l.classid::bigint << 32) | l.objid::bigint) = (SELECT ${AWS_CONNECTION_LOCK_KEY_SQL})) AS waiting`,
    [org]
  );
  return rows[0].waiting === true;
}

async function until(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('atomicity and lock wait', () => {
  it('the check and its writes are one transaction: a change waits for the in-flight fenced write, which commits under A; every later fence sees B', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;
    const writer = await pool.connect();
    await writer.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
    await writer.query('BEGIN');
    await fence(writer, leaseA);

    const HOLD_MS = 400;
    const started = Date.now();
    const change = replaceWithB(org).then((b) => ({ b, at: Date.now() }));
    await until(() => waitingForConnectionLock(org), 'the change to wait');
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await writer.query(`INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'us-east-1', true)`, [org, ACCOUNT]);
    const committedAt = Date.now();
    await writer.query('COMMIT');
    await writer.query("SELECT set_config('app.current_organization_id', '', false)");
    writer.release();
    const { b, at } = await change;

    const waitedMs = at - started;
    console.log(`[lock-wait] change waited ${waitedMs} ms for a fenced write held ${committedAt - started} ms`);
    expect(at).toBeGreaterThanOrEqual(committedAt);
    expect(waitedMs).toBeGreaterThanOrEqual(HOLD_MS);
    expect((await pool.query(`SELECT count(*)::int AS n FROM aws_account_regions WHERE organization_id = $1`, [org])).rows[0].n).toBe(1);
    await expect(tagged(org, (c) => fenceIn(c, leaseA))).rejects.toMatchObject({ reason: 'account_changed' });
    expect(await currentConnectionIdentity(pool, org)).toBe(b);
    await release(leaseA);
  }, 30_000);

  it('shared holders never wait for each other: 8 concurrent fenced writes, no lock waits', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const job = (await jobLease(org, a))!;
    const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    try {
      for (const c of clients) {
        await c.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
        await c.query('BEGIN');
      }
      const started = Date.now();
      await Promise.all(clients.map((c) => fence(c, job)));
      const elapsed = Date.now() - started;
      expect(await waitingForConnectionLock(org)).toBe(false);
      console.log(`[lock-wait] 8 concurrent shared fences took ${elapsed} ms in total, none waited`);
    } finally {
      for (const c of clients) {
        await c.query('ROLLBACK').catch(() => undefined);
        await c.query("SELECT set_config('app.current_organization_id', '', false)").catch(() => undefined);
        c.release();
      }
      await release(job);
    }
  });
});

describe('lock order: connection lock first, then the lease row', () => {
  it('no deadlock against PR C\'s shape (exclusive lock, then the lease rows FOR UPDATE) while a writer\'s fence starts', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;

    const disconnect = await pool.connect();
    const writer = await pool.connect();
    try {
      await disconnect.query('BEGIN');
      await lockConnectionExclusive(disconnect, org);
      await writer.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
      await writer.query('BEGIN');
      const writing = fence(writer, leaseA).then(() => 'passed', (error) => error);
      await until(() => waitingForConnectionLock(org), 'the writer to wait for the connection lock');
      // The writer holds no lease-row lock yet, so this does not block.
      await disconnect.query(`SET LOCAL lock_timeout = 5000`);
      await disconnect.query(`SELECT 1 FROM aws_scan_leases WHERE organization_id = $1 FOR UPDATE`, [org]);
      await disconnect.query(`DELETE FROM aws_accounts WHERE org_id = $1`, [org]);
      await disconnect.query('COMMIT');
      const outcome = await writing;
      expect(outcome).toBeInstanceOf(LeaseLostError);
      expect((outcome as LeaseLostError).reason).toBe('account_changed');
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      await writer.query("SELECT set_config('app.current_organization_id', '', false)").catch(() => undefined);
      writer.release();
      await disconnect.query('ROLLBACK').catch(() => undefined);
      disconnect.release();
    }
    await release(leaseA);
  }, 30_000);
});

describe('the heartbeat notices a connection change (D5)', () => {
  it('a renewal after the change marks the lease lost (account_changed), so the worker stops before more AWS calls', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;
    const heartbeat = new LeaseHeartbeat(pool, leaseA);
    await heartbeat.beat();
    expect(heartbeat.lost).toBe(false);
    await replaceWithB(org);
    await heartbeat.beat();
    expect(heartbeat.reason).toBe('account_changed');
    expect(() => heartbeat.checkpoint()).toThrow(LeaseLostError);
    await release(leaseA);
  });
});

describe('the helpers keep the check and the writes in one transaction', () => {
  /** Runs `hold` (which must open a fenced write and wait on `gate`), then a change; returns whether the change waited for the gate. */
  async function changeWaitsFor(org: string, hold: (gate: Promise<void>) => Promise<unknown>): Promise<boolean> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const holding = hold(gate).catch((error) => error);
    await new Promise((r) => setTimeout(r, 150));
    let changed = false;
    const change = replaceWithB(org).then(() => (changed = true));
    await new Promise((r) => setTimeout(r, 300));
    const waited = !changed;
    open();
    await holding;
    await change;
    return waited;
  }

  it('withFencedTransaction: a change waits until the fenced transaction ends', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    const leaseA = (await scanLease(org, a))!;
    expect(await changeWaitsFor(org, (gate) => tagged(org, (c) => withFencedTransaction(c, leaseA, () => gate, { idleInTransactionTimeoutMs: 5000 })))).toBe(true);
    await release(leaseA);
  });

  it('withConnectionFence: a change waits until the fenced transaction ends', async () => {
    const org = await insertOrg();
    const a = await connectA(org);
    expect(await changeWaitsFor(org, (gate) => withConnectionFence(pool, org, a, () => gate, { idleInTransactionTimeoutMs: 5000 }))).toBe(true);
  });
});
