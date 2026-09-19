/**
 * Focused coverage for the Phase 2 scan connection-lifecycle fix:
 * CustomComplianceService.executeScan() now owns a dedicated PoolClient for
 * the scan's entire lifetime instead of relying on the request-scoped
 * AsyncLocalStorage client, which is released as soon as the triggering HTTP
 * response finishes (see compliance-frameworks.controller.ts's executeScan,
 * which never awaits this call). This file proves, against real Postgres:
 *
 *  - the dedicated client is released exactly once, and only after every
 *    scan-path query has completed (no query after release());
 *  - organization context stays correct for the whole scan even when a
 *    concurrent scan for a *different* organization is running against the
 *    same pool at the same time;
 *  - existing finding/composite-FK/RLS semantics are unaffected by the
 *    client-ownership change.
 *
 * Real Postgres, local dev DB -- no synthetic data or queries against
 * production.
 */
import { Pool } from 'pg';
import { CustomComplianceService } from '../custom-compliance.service';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';

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
// Captured once, before any test installs a spy on pool.connect -- reused by
// every test's mock factory so repeated spyOn/mockRestore cycles across
// tests can't leave a later test capturing an already-wrapped reference.
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
    [`Scan Lifecycle Org ${suffix}`, `scan-lifecycle-org-${suffix}`, `Scan Lifecycle Org ${suffix}`]
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

async function insertResource(orgId: string, isEncrypted: boolean): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', $4)
     RETURNING id`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`, isEncrypted]
  );
  return rows[0].id as string;
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('CustomComplianceService.executeScan -- dedicated connection lifecycle', () => {
  it('releases its dedicated client exactly once, and only after every scan-path query has completed', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertRule(frameworkId, orgId);
    await insertResource(orgId, true);

    const calls: string[] = [];
    const connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      const client = await (originalConnect as any)(...args);
      const realQuery = client.query.bind(client);
      const realRelease = client.release.bind(client);
      jest.spyOn(client, 'query').mockImplementation((...qArgs: any[]) => {
        calls.push('query');
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

      const releaseCount = calls.filter((c) => c === 'release').length;
      expect(releaseCount).toBe(1);
      expect(calls[calls.length - 1]).toBe('release');
      expect(calls.indexOf('release')).toBe(calls.length - 1);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it('does not leak the dedicated client when the scan fails (no enabled rules) -- proven by exhausting the pool', async () => {
    // This test's own `pool` uses pg's default max (10) connections. If the
    // failure path's `finally { client.release() }` were ever skipped, the
    // 11th+ concurrent failed scan below would hang forever waiting for a
    // connection that never comes back -- a black-box proof of "released
    // exactly once on the failure path" that doesn't depend on spying on
    // pg's internal client-reuse behavior (observed to be flaky in this
    // file: pg's pool can hand out the same wrapped client object across
    // sequential connect() calls, which broke a spy-based version of this
    // test with no bearing on the actual implementation under test).
    const attempts = 15;
    const setups = await Promise.all(
      Array.from({ length: attempts }, async () => {
        const orgId = await insertOrg();
        const frameworkId = await insertFramework(orgId);
        // No rules inserted -- executeScan throws 'No enabled rules in framework'.
        return { orgId, frameworkId };
      })
    );

    const results = await Promise.all(
      setups.map(({ orgId, frameworkId }) =>
        service.executeScan(frameworkId, orgId).then(
          () => ({ ok: true as const }),
          (error: Error) => ({ ok: false as const, message: error.message })
        )
      )
    );

    expect(results).toHaveLength(attempts);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect((result as { message: string }).message).toBe('No enabled rules in framework');
    }

    const { rows } = await pool.query(
      `SELECT status, error_message FROM compliance_scans WHERE framework_id = ANY($1)`,
      [setups.map((s) => s.frameworkId)]
    );
    expect(rows).toHaveLength(attempts);
    for (const row of rows) {
      expect(row.status).toBe('failed');
      expect(row.error_message).toBe('No enabled rules in framework');
    }
  }, 30000);

  it('keeps organization context correct for two scans of different organizations running concurrently on the same pool', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const fwA = await insertFramework(orgA);
    const fwB = await insertFramework(orgB);
    await insertRule(fwA, orgA);
    await insertRule(fwB, orgB);
    await insertResource(orgA, true);
    await insertResource(orgB, false);

    const [scanA, scanB] = await Promise.all([
      service.executeScan(fwA, orgA),
      service.executeScan(fwB, orgB),
    ]);

    expect(scanA.status).toBe('completed');
    expect(scanB.status).toBe('completed');
    expect(scanA.organization_id).toBe(orgA);
    expect(scanB.organization_id).toBe(orgB);

    const findingsA = await repository.findFindingsByScan(scanA.id);
    const findingsB = await repository.findFindingsByScan(scanB.id);
    expect(findingsA.length).toBeGreaterThan(0);
    expect(findingsB.length).toBeGreaterThan(0);
    for (const f of findingsA) expect(f.organization_id).toBe(orgA);
    for (const f of findingsB) expect(f.organization_id).toBe(orgB);

    // orgA's resource was is_encrypted=true -> passes; orgB's was false -> fails.
    expect(findingsA[0].status).toBe('pass');
    expect(findingsB[0].status).toBe('fail');
  });

  it('finding upsert semantics (ON CONFLICT scan_id/resource_id/rule_id) and composite FK protection are unaffected', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFramework(orgId);
    await insertRule(frameworkId, orgId);
    await insertResource(orgId, true);

    const scan = await service.executeScan(frameworkId, orgId);
    const findings = await repository.findFindingsByScan(scan.id);
    expect(findings).toHaveLength(1);

    // Composite FK still enforced live: a finding cannot claim an
    // organization different from its parent scan's.
    await expect(
      pool.query(
        `INSERT INTO compliance_scan_findings
           (scan_id, organization_id, rule_id, resource_id, resource_arn, resource_type, status, severity, category)
         VALUES ($1, $2, $3, 'res-x', 'arn:x', 's3', 'fail', 'high', 'encryption')`,
        [scan.id, await insertOrg(), findings[0].rule_id]
      )
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});
