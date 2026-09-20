/**
 * Focused coverage for duplicate/concurrent scan prevention:
 * CustomComplianceService now claims a framework-scoped, session-level
 * PostgreSQL advisory lock (pg_try_advisory_lock(hashtextextended(orgId +
 * ':' + frameworkId, SCAN_CONCURRENCY_LOCK_SALT))) before creating a scan
 * row, and holds it -- on the same dedicated PoolClient the scan already
 * used -- for the scan's entire lifetime. See custom-compliance.service.ts
 * for the full design rationale (no schema change, no time-based staleness
 * guess: correctness comes from Postgres's own connection-liveness
 * detection, not a calendar window).
 *
 * Real Postgres, local dev DB -- no synthetic data or queries against
 * production. Route/controller-level concurrency coverage lives in
 * ../../routes/__tests__/compliance-frameworks-scan-concurrency.test.ts.
 */
import { Pool, PoolClient } from 'pg';
import { CustomComplianceService, ScanInProgressError } from '../custom-compliance.service';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';

// Must match custom-compliance.service.ts's SCAN_CONCURRENCY_LOCK_SALT --
// kept as a locally redeclared literal in the test rather than exported from
// the service, matching this codebase's existing convention (see
// cost-recommendations-occurrence-lifecycle.test.ts's own redeclared
// RECONCILIATION_LOCK_SALT).
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
const service = new CustomComplianceService(pool);
// Captured once, before any test installs a spy on pool.connect -- avoids a
// later test capturing an already-wrapped reference (see the identical
// comment/rationale in custom-compliance.scan-connection-lifecycle.test.ts).
const originalConnect = pool.connect.bind(pool);

const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
    [`Scan Concurrency Org ${suffix}`, `scan-concurrency-org-${suffix}`, `Scan Concurrency Org ${suffix}`]
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

async function insertRule(frameworkId: string, orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO compliance_framework_rules
       (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
     VALUES ($1, $2, $3, 'Encryption required', 'high', 'encryption', 'property_check',
             '{"property":"is_encrypted","operator":"equals","value":true}', 'Enable encryption')`,
    [frameworkId, orgId, `RULE-${uniqueSuffix()}`]
  );
}

async function insertResource(orgId: string, isEncrypted = true): Promise<void> {
  const suffix = uniqueSuffix();
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', $4)`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`, isEncrypted]
  );
}

async function countScans(frameworkId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM compliance_scans WHERE framework_id = $1`,
    [frameworkId]
  );
  return rows[0].count;
}

/** Polls startScan for a framework until it stops returning already_in_progress or the timeout elapses. */
async function retryUntilStarted(
  frameworkId: string,
  organizationId: string,
  timeoutMs = 5000
): Promise<Awaited<ReturnType<typeof service.startScan>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await service.startScan(frameworkId, organizationId);
    if (result.status === 'started') return result;
    if (Date.now() > deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('CustomComplianceService -- duplicate/concurrent scan prevention', () => {
  // ---------------------------------------------------------------------
  // A. Two simultaneous attempts, same framework
  // ---------------------------------------------------------------------
  it('A: two simultaneous startScan calls for the SAME framework -- exactly one starts, one reports already_in_progress, only one scan row exists', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertRule(frameworkId, orgId);
    await insertResource(orgId);

    const [resultA, resultB] = await Promise.all([
      service.startScan(frameworkId, orgId),
      service.startScan(frameworkId, orgId),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(['already_in_progress', 'started']);

    // Only the winner's scan row was created -- the loser never inserted one.
    expect(await countScans(frameworkId)).toBe(1);
  });

  // ---------------------------------------------------------------------
  // B. Two simultaneous attempts, different frameworks -- no global lock
  // ---------------------------------------------------------------------
  it('B: two simultaneous startScan calls for DIFFERENT frameworks (different orgs) both start -- no global serialization', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const fwA = await insertFramework(orgA);
    const fwB = await insertFramework(orgB);
    await insertRule(fwA, orgA);
    await insertRule(fwB, orgB);
    await insertResource(orgA);
    await insertResource(orgB);

    const [resultA, resultB] = await Promise.all([
      service.startScan(fwA, orgA),
      service.startScan(fwB, orgB),
    ]);

    expect(resultA.status).toBe('started');
    expect(resultB.status).toBe('started');
  });

  // ---------------------------------------------------------------------
  // C. Completed scan releases the lock
  // ---------------------------------------------------------------------
  it('C: a completed scan releases its lock, allowing a subsequent scan for the same framework', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertRule(frameworkId, orgId);
    await insertResource(orgId);

    const first = await service.executeScan(frameworkId, orgId);
    expect(first.status).toBe('completed');

    const second = await service.executeScan(frameworkId, orgId);
    expect(second.status).toBe('completed');
    expect(second.id).not.toBe(first.id);
  });

  // ---------------------------------------------------------------------
  // D. Failed scan releases the lock
  // ---------------------------------------------------------------------
  it('D: a failed scan releases its lock, allowing a subsequent legitimate scan', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    // No rules yet -- executeScan will fail with 'No enabled rules in framework'.

    await expect(service.executeScan(frameworkId, orgId)).rejects.toThrow(
      'No enabled rules in framework'
    );

    // Lock must already be free -- add a rule/resource and prove a real scan
    // can now start and complete for the same framework.
    await insertRule(frameworkId, orgId);
    await insertResource(orgId);

    const recovered = await service.executeScan(frameworkId, orgId);
    expect(recovered.status).toBe('completed');
  });

  // ---------------------------------------------------------------------
  // E. Process/connection loss releases the lock (as far as this harness
  //    can simulate a crash: force-destroy the physical connection that
  //    holds the lock, without ever unlocking it explicitly).
  // ---------------------------------------------------------------------
  it('E: dropping the connection that holds the lock (simulated crash) releases it automatically', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    const lockKey = `${orgId}:${frameworkId}`;

    const crashClient = await pool.connect();
    const { rows } = await crashClient.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT})) AS locked`,
      [lockKey]
    );
    expect(rows[0].locked).toBe(true);

    // No pg_advisory_unlock call -- this is the point of the test. Passing
    // `true` tells the pool to destroy the physical connection instead of
    // returning it for reuse, which is what actually triggers Postgres to
    // notice the session is gone and release its advisory locks.
    crashClient.release(true);

    const result = await retryUntilStarted(frameworkId, orgId, 5000);
    expect(result.status).toBe('started');
  }, 10000);

  // ---------------------------------------------------------------------
  // F. Client lifecycle safety
  // ---------------------------------------------------------------------
  describe('F: client lifecycle safety', () => {
    it('F1: success path -- client released exactly once, unlock happens before release, no query after release', async () => {
      const orgId = await insertOrg();
      const frameworkId = await insertFramework(orgId);
      await insertRule(frameworkId, orgId);
      await insertResource(orgId);

      const calls: string[] = [];
      const connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
        if (args.length > 0) {
          // Callback-style invocation -- e.g. pg-pool's own pool.query()
          // shorthand calls this.connect(cb) internally. This wrapper only
          // observes the service's own explicit, zero-arg, promise-style
          // pool.connect() calls; pass anything else straight through.
          return (originalConnect as any)(...args);
        }
        const client = await (originalConnect as any)();
        const realQuery = client.query.bind(client);
        const realRelease = client.release.bind(client);
        jest.spyOn(client, 'query').mockImplementation((...qArgs: any[]) => {
          const text = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text;
          calls.push(text?.includes('pg_advisory_unlock') ? 'unlock' : 'query');
          return realQuery(...qArgs);
        });
        jest.spyOn(client, 'release').mockImplementation((...rArgs: any[]) => {
          calls.push('release');
          return realRelease(...rArgs);
        });
        return client;
      });

      try {
        const scan = await service.executeScan(frameworkId, orgId);
        expect(scan.status).toBe('completed');

        expect(calls.filter((c) => c === 'release')).toHaveLength(1);
        expect(calls[calls.length - 1]).toBe('release');
        expect(calls.indexOf('unlock')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('unlock')).toBeLessThan(calls.lastIndexOf('release'));
        // Nothing after release.
        expect(calls.slice(calls.indexOf('release') + 1)).toHaveLength(0);
      } finally {
        connectSpy.mockRestore();
      }
    });

    it('F2: lock-not-acquired path -- client released immediately, no unlock query issued, no scan row created', async () => {
      const orgId = await insertOrg();
      const frameworkId = await insertFramework(orgId);
      const lockKey = `${orgId}:${frameworkId}`;

      // Hold the lock externally so the service's own attempt fails.
      const holder = await pool.connect();
      await holder.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT}))`,
        [lockKey]
      );

      const calls: string[] = [];
      const connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
        if (args.length > 0) {
          // See the identical guard/comment in F1's mock above -- this test
          // also calls plain pool.query() (via countScans) while the spy is
          // active, which internally uses connect(cb).
          return (originalConnect as any)(...args);
        }
        const client = await (originalConnect as any)();
        const realQuery = client.query.bind(client);
        const realRelease = client.release.bind(client);
        jest.spyOn(client, 'query').mockImplementation((...qArgs: any[]) => {
          const text = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text;
          calls.push(text?.includes('pg_advisory_unlock') ? 'unlock' : 'query');
          return realQuery(...qArgs);
        });
        jest.spyOn(client, 'release').mockImplementation((...rArgs: any[]) => {
          calls.push('release');
          return realRelease(...rArgs);
        });
        return client;
      });

      try {
        const result = await service.startScan(frameworkId, orgId);
        expect(result.status).toBe('already_in_progress');
        expect(calls.filter((c) => c === 'release')).toHaveLength(1);
        expect(calls.filter((c) => c === 'unlock')).toHaveLength(0);
        expect(await countScans(frameworkId)).toBe(0);
      } finally {
        connectSpy.mockRestore();
        await holder.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT}))`,
          [lockKey]
        );
        holder.release();
      }
    });

    it('F3: a synchronous throw at the handoff boundary (between lock acquisition and entering the long-running scan) still unlocks and releases', async () => {
      const orgId = await insertOrg();
      const frameworkId = await insertFramework(orgId);
      await insertRule(frameworkId, orgId);
      await insertResource(orgId);

      // Force the exact boundary the spec calls out: lock acquired + scan
      // row created, then the very next step (entering the long-running
      // scan body) throws synchronously, before its own try/finally ever
      // starts.
      const runScanBodySpy = jest
        .spyOn(service as any, 'runScanBody')
        .mockImplementationOnce(() => {
          throw new Error('synchronous handoff failure (simulated)');
        });

      try {
        const started = await service.startScan(frameworkId, orgId);
        expect(started.status).toBe('started');

        // Prove the lock/client were not leaked: a fresh attempt for the
        // same framework succeeds once the background failure has settled.
        const recovered = await retryUntilStarted(frameworkId, orgId, 5000);
        expect(recovered.status).toBe('started');
      } finally {
        runScanBodySpy.mockRestore();
      }
    }, 10000);

    it('F4: createScan failing after lock acquisition still unlocks and releases, and surfaces the original error', async () => {
      const orgId = await insertOrg();
      const frameworkId = await insertFramework(orgId);

      const createScanSpy = jest
        .spyOn(ComplianceFrameworksRepository.prototype, 'createScan')
        .mockImplementationOnce(async () => {
          throw new Error('createScan failure (simulated)');
        });

      try {
        await expect(service.executeScan(frameworkId, orgId)).rejects.toThrow(
          'createScan failure (simulated)'
        );
        expect(await countScans(frameworkId)).toBe(0);

        // Lock must be free -- a subsequent attempt is not blocked.
        createScanSpy.mockRestore();
        const result = await service.startScan(frameworkId, orgId);
        expect(result.status).toBe('started');
        // Let this second scan's background failure (no enabled rules, same
        // as before) settle before the test ends, so it doesn't overlap the
        // next test's own connect()/pool.end() lifecycle.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } finally {
        createScanSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------
  // H. Existing scan results/findings are unaffected by the refactor
  // ---------------------------------------------------------------------
  it('H: scan/finding results, scoring, and composite-FK semantics are unchanged', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertRule(frameworkId, orgId);
    await insertResource(orgId, true);
    await insertResource(orgId, false);

    const scan = await service.executeScan(frameworkId, orgId);
    expect(scan.status).toBe('completed');
    expect(scan.resources_scanned).toBe(2);
    expect(Number(scan.compliance_score)).toBe(50);

    const findings = await repository.findFindingsByScan(scan.id);
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.status === 'pass')).toBe(true);
    expect(findings.some((f) => f.status === 'fail')).toBe(true);
    for (const f of findings) {
      expect(f.organization_id).toBe(orgId);
    }
  });

  it('ScanInProgressError carries the exact controller-facing message', () => {
    const error = new ScanInProgressError();
    expect(error.message).toBe('A scan is already in progress for this framework.');
    expect(error.name).toBe('ScanInProgressError');
  });
});
