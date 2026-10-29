/**
 * Scan timeout and stale-run recovery (custom-compliance.service.ts).
 *
 *  - A scan that runs past its timeout is marked failed ("Timed out after 10
 *    minutes"), its Postgres session is ended (which frees the scan lock and
 *    rolls back its results transaction), and a new start works.
 *  - A run left pending/running by a dead session is marked failed
 *    ("Interrupted: ...") before a new start of its framework and at server
 *    startup -- only while holding that framework's scan lock, so a live
 *    scan is never touched.
 *  - Findings and the final status commit together, only while the run is
 *    still running: a late completion never overwrites a failed run, and an
 *    abandoned worker writes nothing.
 *
 * Real Postgres. A "hung" scan is a real lock wait: the test holds the
 * framework rule's row FOR UPDATE, which blocks the scan's first finding
 * insert (its foreign-key check takes FOR KEY SHARE on that row).
 */
import { Pool, PoolClient } from 'pg';
import {
  CustomComplianceService,
  ScanTimedOutError,
  SCAN_INTERRUPTED_MESSAGE,
  SCAN_TIMED_OUT_MESSAGE,
} from '../custom-compliance.service';
import { ComplianceFrameworksRepository, ComplianceScan } from '../../repositories/compliance-frameworks.repository';

// Must match custom-compliance.service.ts's SCAN_CONCURRENCY_LOCK_SALT (see
// custom-compliance.concurrency.test.ts for the redeclaration convention).
const SCAN_CONCURRENCY_LOCK_SALT = 3;

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const repository = new ComplianceFrameworksRepository(pool);
const originalConnect = pool.connect.bind(pool);
const createdOrgIds: string[] = [];

type Session = { pid: number; backendStart: string };

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(db: Pool = pool): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await db.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
    [`Scan Timeout Org ${suffix}`, `scan-timeout-org-${suffix}`, `Scan Timeout Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertFramework(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, `Framework ${uniqueSuffix()}`]
  );
  return rows[0].id as string;
}

async function insertRule(frameworkId: string, orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_framework_rules
       (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
     VALUES ($1, $2, $3, 'Encryption required', 'high', 'encryption', 'property_check',
             '{"property":"is_encrypted","operator":"equals","value":true}', 'Enable encryption')
     RETURNING id`,
    [frameworkId, orgId, `RULE-${uniqueSuffix()}`]
  );
  return rows[0].id as string;
}

async function insertResource(orgId: string, isEncrypted = true): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', $4) RETURNING id`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`, isEncrypted]
  );
  return rows[0].id as string;
}

/** An org with one framework, one rule and `resources` resources. */
async function scannable(resources = 2) {
  const orgId = await insertOrg();
  const frameworkId = await insertFramework(orgId);
  const ruleId = await insertRule(frameworkId, orgId);
  const resourceIds: string[] = [];
  for (let i = 0; i < resources; i++) resourceIds.push(await insertResource(orgId, i % 2 === 0));
  return { orgId, frameworkId, ruleId, resourceIds };
}

/** A run row left behind by a dead session (no lock held for it). */
async function insertOrphan(orgId: string, frameworkId: string, status: 'pending' | 'running' = 'running'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status, started_at)
     VALUES ($1, $2, 'manual', $3, $4) RETURNING id`,
    [orgId, frameworkId, status, status === 'running' ? new Date() : null]
  );
  return rows[0].id as string;
}

type Holder = { client: PoolClient; pid: number; release: () => Promise<void> };

/** Holds a row lock in an open transaction until release(). */
async function holdRow(sql: string, params: unknown[]): Promise<Holder> {
  const client = await originalConnect();
  await client.query('BEGIN');
  await client.query(sql, params);
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  let released = false;
  return {
    client,
    pid,
    release: async () => {
      if (released) return;
      released = true;
      await client.query('ROLLBACK');
      client.release();
    },
  };
}

const lockRule = (ruleId: string) =>
  holdRow('SELECT 1 FROM compliance_framework_rules WHERE id = $1 FOR UPDATE', [ruleId]);

async function waitUntil(check: () => Promise<boolean>, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** How many backends are waiting, directly or through another waiter, behind `rootPid`. */
async function blockedBehind(rootPid: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0`
  );
  const behind = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows as { pid: number; blockers: number[] }[]) {
      if (behind.has(row.pid)) continue;
      if (row.blockers.some((b) => b === rootPid || behind.has(b))) {
        behind.add(row.pid);
        grew = true;
      }
    }
  }
  return behind.size;
}

const waitBehind = (rootPid: number, count: number, label: string) =>
  waitUntil(async () => (await blockedBehind(rootPid)) >= count, label);

async function scansOf(frameworkId: string): Promise<ComplianceScan[]> {
  const { rows } = await pool.query('SELECT * FROM compliance_scans WHERE framework_id = $1 ORDER BY created_at, id', [frameworkId]);
  return rows;
}

async function scanRow(id: string): Promise<ComplianceScan> {
  return (await repository.findScanById(id))!;
}

async function findingsCount(scanId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM compliance_scan_findings WHERE scan_id = $1', [scanId]);
  return rows[0].n;
}

async function waitForScanId(frameworkId: string, status?: string): Promise<string> {
  let id = '';
  await waitUntil(async () => {
    const scans = await scansOf(frameworkId);
    const match = scans.find((s) => !status || s.status === status);
    id = match?.id ?? '';
    return id !== '';
  }, `a ${status ?? ''} scan row for ${frameworkId}`);
  return id;
}

/** True when another session can take the framework's scan lock right now (it is released again at once). */
async function lockIsFree(orgId: string, frameworkId: string): Promise<boolean> {
  const client = await originalConnect();
  try {
    const key = `${orgId}:${frameworkId}`;
    const { rows } = await client.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT})) AS locked`,
      [key]
    );
    if (rows[0].locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT}))`, [key]);
    }
    return rows[0].locked === true;
  } finally {
    client.release();
  }
}

async function sessionAlive(session: Session): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND backend_start = $2::timestamptz',
    [session.pid, session.backendStart]
  );
  return rows[0].n > 0;
}

/** Records the Postgres session of every scan `service` claims. */
function captureSessions(service: CustomComplianceService): Session[] {
  const sessions: Session[] = [];
  const original = (service as any).readSession.bind(service);
  jest.spyOn(service as any, 'readSession').mockImplementation(async (...args: any[]) => {
    const session = await original(...args);
    sessions.push(session);
    return session;
  });
  return sessions;
}

async function waitForSession(sessions: Session[]): Promise<Session> {
  await waitUntil(async () => sessions.length > 0, 'the scan session');
  return sessions[0];
}

/** Waits for a background scan to reach completed/failed. */
async function waitForTerminal(scanId: string): Promise<ComplianceScan> {
  let scan: ComplianceScan | null = null;
  await waitUntil(async () => {
    scan = await repository.findScanById(scanId);
    return !!scan && (scan.status === 'completed' || scan.status === 'failed');
  }, `scan ${scanId} terminal`);
  return scan!;
}

/** The outcome of a settled executeScan() promise. */
async function settle(p: Promise<ComplianceScan>): Promise<{ scan?: ComplianceScan; error?: unknown }> {
  try {
    return { scan: await p };
  } catch (error) {
    return { error };
  }
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('scan timeout', () => {
  it('1: a hung scan times out -- failed with the reason, session ended, lock free, no findings, and a new start works', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 400 });
    const sessions = captureSessions(service);
    const blocker = await lockRule(ruleId);
    let timedOutId = '';
    try {
      await expect(service.executeScan(frameworkId, orgId)).rejects.toBeInstanceOf(ScanTimedOutError);

      const [scan] = await scansOf(frameworkId);
      timedOutId = scan.id;
      expect(scan.status).toBe('failed');
      expect(scan.error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
      expect(scan.completed_at).not.toBeNull();
      expect(await findingsCount(scan.id)).toBe(0);
      expect(await sessionAlive(sessions[0])).toBe(false);
      expect(await lockIsFree(orgId, frameworkId)).toBe(true);
    } finally {
      await blocker.release();
    }

    const next = await service.startScan(frameworkId, orgId);
    expect(next.status).toBe('started');
    const done = await waitForTerminal((next as { scanId: string }).scanId);
    expect(done.status).toBe('completed');
    expect(await findingsCount(done.id)).toBe(2);

    // The new start found nothing to recover: the timed-out run keeps its own reason.
    expect((await scanRow(timedOutId)).error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
  }, 20000);

  // 2a/2b order the two sides with in-process gates on the timeout's own steps rather than with row
  // locks: the scan already holds a KEY SHARE lock on its run row (its findings' foreign-key checks),
  // so Postgres lets its final UPDATE skip the row's wait queue, and lock order alone can't decide
  // who commits first.
  it('2a: the timeout fires mid-scan but the completion commits before its mark -- the run stays completed, its session is not ended, and its connection is pooled as usual', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 300 });
    const markResults: string[] = [];
    let markCalled!: () => void;
    const marking = new Promise<void>((resolve) => { markCalled = resolve; });
    let openMark!: () => void;
    const markGate = new Promise<void>((resolve) => { openMark = resolve; });
    const realMark = (service as any).markTimedOut.bind(service);
    jest.spyOn(service as any, 'markTimedOut').mockImplementation(async (...args: any[]) => {
      markCalled();
      await markGate;
      const result = await realMark(...args);
      markResults.push(result);
      return result;
    });
    const endSession = jest.spyOn(service as any, 'endScanSession');
    // The scan's own connection is the first one it checks out.
    const scanReleases: unknown[][] = [];
    let scanClientSeen = false;
    jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      if (args.length > 0) return (originalConnect as any)(...args);
      const client = await originalConnect();
      if (!scanClientSeen) {
        scanClientSeen = true;
        const realRelease = client.release.bind(client);
        jest.spyOn(client, 'release').mockImplementationOnce((...rArgs: any[]) => {
          scanReleases.push(rArgs);
          return realRelease(...rArgs);
        });
      }
      return client;
    });

    const ruleBlocker = await lockRule(ruleId);
    try {
      const result = settle(service.executeScan(frameworkId, orgId));
      await waitBehind(ruleBlocker.pid, 1, 'the scan blocked on its first finding');
      await marking;
      const scanId = await waitForScanId(frameworkId);

      await ruleBlocker.release();
      await waitUntil(async () => (await scanRow(scanId)).status === 'completed', 'the completion committed');
      openMark();

      const { scan, error } = await result;
      expect(error).toBeUndefined();
      expect(scan!.status).toBe('completed');
      expect(markResults).toEqual(['already_finished']);
      expect(endSession).not.toHaveBeenCalled();
      expect(scanReleases).toEqual([[undefined]]);
      const stored = await scanRow(scanId);
      expect(stored.status).toBe('completed');
      expect(stored.error_message).toBeNull();
      expect(await findingsCount(scanId)).toBe(2);
      expect(await lockIsFree(orgId, frameworkId)).toBe(true);
    } finally {
      openMark();
      await ruleBlocker.release();
    }
  }, 20000);

  it('2b: the timeout commits its mark just before the completion -- the late completion matches no row and is rolled back, findings included', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 300 });
    // Hold the session end, so the late completion really reaches its final UPDATE.
    let openEnd!: () => void;
    const endGate = new Promise<void>((resolve) => { openEnd = resolve; });
    const realEnd = (service as any).endScanSession.bind(service);
    jest.spyOn(service as any, 'endScanSession').mockImplementation(async (...args: any[]) => {
      await endGate;
      return realEnd(...args);
    });
    let finalUpdate!: (row: unknown) => void;
    const finalUpdated = new Promise<unknown>((resolve) => { finalUpdate = resolve; });
    const updateScan = ComplianceFrameworksRepository.prototype.updateScan;
    jest.spyOn(ComplianceFrameworksRepository.prototype, 'updateScan').mockImplementation(async function (
      this: ComplianceFrameworksRepository, ...args: Parameters<typeof updateScan>
    ) {
      const row = await updateScan.apply(this, args);
      if (args[1].status === 'completed') finalUpdate(row);
      return row;
    });

    const ruleBlocker = await lockRule(ruleId);
    try {
      const result = settle(service.executeScan(frameworkId, orgId));
      await waitBehind(ruleBlocker.pid, 1, 'the scan blocked on its first finding');
      const scanId = await waitForScanId(frameworkId);
      await waitUntil(async () => (await scanRow(scanId)).status === 'failed', 'the timeout committed its mark');

      await ruleBlocker.release();
      expect(await finalUpdated).toBeNull();
      openEnd();

      const { error } = await result;
      expect(error).toBeInstanceOf(ScanTimedOutError);
      const stored = await scanRow(scanId);
      expect(stored.status).toBe('failed');
      expect(stored.error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
      expect(await findingsCount(scanId)).toBe(0);
      expect(await lockIsFree(orgId, frameworkId)).toBe(true);
    } finally {
      openEnd();
      await ruleBlocker.release();
    }
  }, 20000);

  it('2d: a session ended while the scan waits idle in its finally block, with the event loop busy, closes before release -- no pool error, no exit', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 300 });
    const sessions = captureSessions(service);

    // Production's pool handler (config/database.ts) exits the process on a pool error.
    const poolErrors: Error[] = [];
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const onPoolError = (error: Error) => {
      poolErrors.push(error);
      process.exit(-1);
    };
    pool.on('error', onPoolError);

    // The session end: terminate without waiting, then keep the event loop busy, so the
    // server's "terminating connection" notice is still unread on the scan's socket when
    // the timeout returns and the scan's finally block runs.
    let openEnd!: () => void;
    const endGate = new Promise<void>((resolve) => { openEnd = resolve; });
    jest.spyOn(service as any, 'endScanSession').mockImplementation(async (...args: any[]) => {
      const session = args[0] as Session;
      await endGate;
      await pool.query('SELECT pg_terminate_backend($1)', [session.pid]);
      const until = Date.now() + 300;
      while (Date.now() < until) { /* busy */ }
    });
    let finalUpdate!: (row: unknown) => void;
    const finalUpdated = new Promise<unknown>((resolve) => { finalUpdate = resolve; });
    const updateScan = ComplianceFrameworksRepository.prototype.updateScan;
    jest.spyOn(ComplianceFrameworksRepository.prototype, 'updateScan').mockImplementation(async function (
      this: ComplianceFrameworksRepository, ...args: Parameters<typeof updateScan>
    ) {
      const row = await updateScan.apply(this, args);
      if (args[1].status === 'completed') finalUpdate(row);
      return row;
    });

    const ruleBlocker = await lockRule(ruleId);
    try {
      const result = settle(service.executeScan(frameworkId, orgId));
      const worker = await waitForSession(sessions);
      await waitBehind(ruleBlocker.pid, 1, 'the scan blocked on its first finding');
      const scanId = await waitForScanId(frameworkId);
      await waitUntil(async () => (await scanRow(scanId)).status === 'failed', 'the timeout committed its mark');

      await ruleBlocker.release();
      expect(await finalUpdated).toBeNull();
      // The late completion rolled back: the scan's session is idle, out of any transaction.
      await waitUntil(async () => {
        const { rows } = await pool.query('SELECT state FROM pg_stat_activity WHERE pid = $1', [worker.pid]);
        return rows[0]?.state === 'idle';
      }, 'the scan idle in its finally block');
      openEnd();

      const { error } = await result;
      expect(error).toBeInstanceOf(ScanTimedOutError);
      // Give any late socket event a chance to reach the pool.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(poolErrors).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
      expect(await sessionAlive(worker)).toBe(false);
      expect((await scanRow(scanId)).error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
      expect(await findingsCount(scanId)).toBe(0);
      expect(await lockIsFree(orgId, frameworkId)).toBe(true);
    } finally {
      openEnd();
      await ruleBlocker.release();
      pool.removeListener('error', onPoolError);
    }
  }, 20000);

  it('2c: timeouts landing at every point of a scan always leave one consistent terminal state', async () => {
    // Long enough (30 findings) that a timeout can land before, during or after the results transaction.
    const { orgId, frameworkId } = await scannable(30);
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const service = new CustomComplianceService(pool, { scanTimeoutMs: 1 + Math.floor(Math.random() * 60) });
      const { scan, error } = await settle(service.executeScan(frameworkId, orgId));
      const latest = (await scansOf(frameworkId)).pop()!;

      if (scan) {
        expect(latest.status).toBe('completed');
        expect(latest.error_message).toBeNull();
        expect(await findingsCount(latest.id)).toBe(30);
        outcomes.push('completed');
      } else {
        expect(error).toBeInstanceOf(ScanTimedOutError);
        expect(latest.status).toBe('failed');
        expect(latest.error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
        expect(await findingsCount(latest.id)).toBe(0);
        outcomes.push('timed_out');
      }
      await waitUntil(() => lockIsFree(orgId, frameworkId), 'the lock freed');
    }
    expect(outcomes).toHaveLength(20);
    // No row is ever left active, and none was recovered as interrupted.
    for (const s of await scansOf(frameworkId)) {
      expect(['completed', 'failed']).toContain(s.status);
      expect(s.error_message).not.toBe(SCAN_INTERRUPTED_MESSAGE);
    }
  }, 60000);

  it('3: a worker abandoned by its timeout writes nothing after a replacement run started', async () => {
    const { orgId, frameworkId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 400 });
    const sessions = captureSessions(service);

    // The first scan's worker stalls in this process before its first finding.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let gatedScan: string | null = null;
    const createFinding = ComplianceFrameworksRepository.prototype.createFinding;
    jest.spyOn(ComplianceFrameworksRepository.prototype, 'createFinding').mockImplementation(async function (
      this: ComplianceFrameworksRepository, data, client
    ) {
      gatedScan ??= data.scan_id;
      if (data.scan_id === gatedScan) await gate;
      return createFinding.call(this, data, client);
    });

    const first = settle(service.executeScan(frameworkId, orgId));
    const firstSession = await waitForSession(sessions);
    const firstId = await waitForScanId(frameworkId);
    await waitUntil(async () => (await scanRow(firstId)).status === 'failed', 'the timeout marked the first run');
    await waitUntil(async () => !(await sessionAlive(firstSession)), 'the first session ended');

    const replacement = await service.executeScan(frameworkId, orgId);
    expect(replacement.status).toBe('completed');
    const replacementBefore = await scanRow(replacement.id);
    const replacementFindings = await findingsCount(replacement.id);
    expect(replacementFindings).toBe(2);

    openGate();
    const { error } = await first;
    expect(error).toBeInstanceOf(ScanTimedOutError);

    const abandoned = await scanRow(firstId);
    expect(abandoned.status).toBe('failed');
    expect(abandoned.error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
    expect(await findingsCount(firstId)).toBe(0);
    expect(await scanRow(replacement.id)).toEqual(replacementBefore);
    expect(await findingsCount(replacement.id)).toBe(replacementFindings);
  }, 20000);

  it('3b: a late results transaction for a failed run, even on a fresh connection, matches no row and is rolled back', async () => {
    const { orgId, frameworkId, ruleId, resourceIds } = await scannable(1);
    const runId = await insertOrphan(orgId, frameworkId, 'running');
    await repository.updateScan(runId, { status: 'failed', error_message: SCAN_TIMED_OUT_MESSAGE, completed_at: new Date() });

    const client = await originalConnect();
    try {
      await client.query('BEGIN');
      await repository.createFinding({
        scan_id: runId, organization_id: orgId, rule_id: ruleId, resource_id: resourceIds[0],
        resource_arn: 'arn:aws:s3:::late', resource_type: 's3', resource_name: null,
        status: 'pass', severity: 'high', category: 'encryption', issue: null, recommendation: null,
      }, client);
      const completed = await repository.updateScan(runId, { status: 'completed', completed_at: new Date() }, client, ['running']);
      expect(completed).toBeNull();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const row = await scanRow(runId);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe(SCAN_TIMED_OUT_MESSAGE);
    expect(await findingsCount(runId)).toBe(0);
  });
});

describe('connection safety (P1, P2)', () => {
  it('P1: a scan session the server ends does not crash the process; the run is recovered as interrupted on the next start', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(1);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 60000 });
    const sessions = captureSessions(service);
    const clients: PoolClient[] = [];
    jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      if (args.length > 0) return (originalConnect as any)(...args);
      const client = await originalConnect();
      clients.push(client);
      return client;
    });

    const blocker = await lockRule(ruleId);
    try {
      const result = settle(service.executeScan(frameworkId, orgId));
      const session = await waitForSession(sessions);
      await waitBehind(blocker.pid, 1, 'the scan blocked');

      // pg-pool drops its own listener while a client is checked out.
      expect(clients[0].listenerCount('error')).toBeGreaterThan(0);

      await pool.query('SELECT pg_terminate_backend($1, 5000)', [session.pid]);
      const { error } = await result;
      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(ScanTimedOutError);
    } finally {
      await blocker.release();
    }
    jest.mocked(pool.connect).mockRestore();

    // The dead worker could not write: its run is still "running" ...
    const [orphan] = await scansOf(frameworkId);
    expect(orphan.status).toBe('running');
    expect(await lockIsFree(orgId, frameworkId)).toBe(true);

    // ... until the next start recovers it.
    const next = await service.startScan(frameworkId, orgId);
    expect(next.status).toBe('started');
    const recovered = await scanRow(orphan.id);
    expect(recovered.status).toBe('failed');
    expect(recovered.error_message).toBe(SCAN_INTERRUPTED_MESSAGE);
    expect(recovered.completed_at).not.toBeNull();
    await waitForTerminal((next as { scanId: string }).scanId);
  }, 20000);

  it('P2: a failed lock release destroys the connection instead of pooling it with the lock held', async () => {
    const { orgId, frameworkId } = await scannable(1);
    const service = new CustomComplianceService(pool);
    const releases: unknown[][] = [];
    jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      if (args.length > 0) return (originalConnect as any)(...args);
      const client = await originalConnect();
      const realQuery = client.query.bind(client);
      const realRelease = client.release.bind(client);
      jest.spyOn(client, 'query').mockImplementation((...qArgs: any[]) => {
        const text = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text;
        if (text?.includes('pg_advisory_unlock')) return Promise.reject(new Error('unlock failed (simulated)')) as any;
        return (realQuery as any)(...qArgs);
      });
      jest.spyOn(client, 'release').mockImplementation((...rArgs: any[]) => {
        releases.push(rArgs);
        return realRelease(...rArgs);
      });
      return client;
    });

    const scan = await service.executeScan(frameworkId, orgId);
    expect(scan.status).toBe('completed');
    jest.mocked(pool.connect).mockRestore();

    expect(releases).toHaveLength(1);
    expect(releases[0][0]).toBeInstanceOf(Error);
    // The destroyed session took its lock with it.
    await waitUntil(() => lockIsFree(orgId, frameworkId), 'the lock freed', 2000);
  }, 20000);
});

describe('stale-run recovery', () => {
  it('4a: a start recovers the framework\'s orphaned pending and running rows as interrupted, under the same lock', async () => {
    const { orgId, frameworkId } = await scannable(1);
    const running = await insertOrphan(orgId, frameworkId, 'running');
    const pending = await insertOrphan(orgId, frameworkId, 'pending');
    const service = new CustomComplianceService(pool);

    const next = await service.startScan(frameworkId, orgId);
    expect(next.status).toBe('started');
    const nextId = (next as { scanId: string }).scanId;
    expect([running, pending]).not.toContain(nextId);

    for (const id of [running, pending]) {
      const row = await scanRow(id);
      expect(row.status).toBe('failed');
      expect(row.error_message).toBe(SCAN_INTERRUPTED_MESSAGE);
      expect(row.completed_at).not.toBeNull();
    }
    expect((await waitForTerminal(nextId)).status).toBe('completed');
  });

  describe('4b: startup recovery as a role that row-level security applies to', () => {
    const role = `scan_recovery_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let rolePool: Pool;

    beforeAll(async () => {
      await pool.query(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS`);
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      rolePool = new Pool({ ...dbConfig(), max: 2, options: `-c role=${role}` });
    });

    afterAll(async () => {
      await rolePool.end();
      await pool.query(`DROP OWNED BY ${role}`);
      await pool.query(`DROP ROLE ${role}`);
    });

    it('recovers orphaned rows in every organization, each read under its own tenant tag', async () => {
      const { rows } = await rolePool.query('SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user');
      expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });

      const a = await scannable(0);
      const b = await scannable(0);
      const orphanA = await insertOrphan(a.orgId, a.frameworkId, 'running');
      const orphanB = await insertOrphan(b.orgId, b.frameworkId, 'pending');

      const marked = await new CustomComplianceService(rolePool).recoverInterruptedScans();
      expect(marked).toBeGreaterThanOrEqual(2);
      for (const id of [orphanA, orphanB]) {
        const row = await scanRow(id);
        expect(row.status).toBe('failed');
        expect(row.error_message).toBe(SCAN_INTERRUPTED_MESSAGE);
      }
    });
  });

  it('5: a live scan is never recovered -- not at startup, not by a second start -- and then completes', async () => {
    const { orgId, frameworkId, ruleId } = await scannable(2);
    const service = new CustomComplianceService(pool, { scanTimeoutMs: 60000 });
    const blocker = await lockRule(ruleId);
    let result: Promise<{ scan?: ComplianceScan; error?: unknown }> | null = null;
    try {
      result = settle(service.executeScan(frameworkId, orgId));
      await waitBehind(blocker.pid, 1, 'the scan blocked');
      const liveId = await waitForScanId(frameworkId, 'running');

      await service.recoverInterruptedScans();
      expect(await service.startScan(frameworkId, orgId)).toEqual({ status: 'already_in_progress' });
      expect((await scanRow(liveId)).status).toBe('running');
      expect(await scansOf(frameworkId)).toHaveLength(1);
    } finally {
      await blocker.release();
    }
    const { scan } = await result!;
    expect(scan!.status).toBe('completed');
    expect(await findingsCount(scan!.id)).toBe(2);
  }, 20000);

  it('6: pre-start recovery touches only that framework -- not another framework\'s live run, not another org', async () => {
    const target = await scannable(1);
    const orphanRunning = await insertOrphan(target.orgId, target.frameworkId, 'running');
    const orphanPending = await insertOrphan(target.orgId, target.frameworkId, 'pending');

    // A second framework of the same org, with a live (blocked) scan.
    const liveFramework = await insertFramework(target.orgId);
    const liveRule = await insertRule(liveFramework, target.orgId);
    // Another org's orphan: only startup recovery may touch it.
    const other = await scannable(0);
    const otherOrphan = await insertOrphan(other.orgId, other.frameworkId, 'running');

    const service = new CustomComplianceService(pool, { scanTimeoutMs: 60000 });
    const blocker = await lockRule(liveRule);
    let live: Promise<{ scan?: ComplianceScan; error?: unknown }> | null = null;
    try {
      live = settle(service.executeScan(liveFramework, target.orgId));
      await waitBehind(blocker.pid, 1, 'the live scan blocked');
      const liveId = await waitForScanId(liveFramework, 'running');

      const next = await service.startScan(target.frameworkId, target.orgId);
      expect(next.status).toBe('started');

      for (const id of [orphanRunning, orphanPending]) {
        expect((await scanRow(id)).error_message).toBe(SCAN_INTERRUPTED_MESSAGE);
      }
      expect((await scanRow(liveId)).status).toBe('running');
      expect((await scanRow(otherOrphan)).status).toBe('running');
      await waitForTerminal((next as { scanId: string }).scanId);
    } finally {
      await blocker.release();
    }
    expect((await live!).scan!.status).toBe('completed');
  }, 20000);

  it('7: two concurrent starts with an orphaned row present -- one starts, one 409, the orphan recovered once', async () => {
    const { orgId, frameworkId } = await scannable(1);
    const orphan = await insertOrphan(orgId, frameworkId, 'running');
    const service = new CustomComplianceService(pool);

    const results = await Promise.all([service.startScan(frameworkId, orgId), service.startScan(frameworkId, orgId)]);
    const started = results.filter((r) => r.status === 'started');
    expect(started).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_in_progress')).toHaveLength(1);

    const rows = await scansOf(frameworkId);
    expect(rows).toHaveLength(2);
    const recovered = await scanRow(orphan);
    expect(recovered.status).toBe('failed');
    expect(recovered.error_message).toBe(SCAN_INTERRUPTED_MESSAGE);
    expect((await waitForTerminal((started[0] as { scanId: string }).scanId)).status).toBe('completed');
  });
});
