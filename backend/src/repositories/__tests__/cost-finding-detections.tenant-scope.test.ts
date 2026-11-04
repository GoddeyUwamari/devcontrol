/**
 * Tenant scope of PR 3a's statements.
 *
 * cost_finding_detections is postgres-owned with RLS forced, and
 * cost_recommendations is postgres-owned with RLS enabled (production audit,
 * pr3-step1.md §1.6). RLS is the second layer: every statement also names the
 * organization itself, which the static half holds to, with no top-level OR
 * (helpers/tenant-predicate.ts).
 *
 * Static scope (founder decision 10): every statement on cost_finding_detections
 * anywhere in backend/src, and every statement on cost_recommendations in its
 * repository. Other readers of cost_recommendations are reviewed, not held
 * here: the Prometheus gauge (metrics/index.ts) is cross-organization by design,
 * and the services inventory scopes by a correlated predicate.
 *
 * The live half runs the table's real RLS as the application role.
 */
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { hasOrganizationPredicate, sourceFiles, statementsInFiles } from './helpers/tenant-predicate';

const SRC = join(__dirname, '..', '..');
const REPOSITORY = join(SRC, 'repositories', 'cost-recommendations.repository.ts');

describe('static: cost_finding_detections, every statement in backend/src', () => {
  const statements = statementsInFiles(sourceFiles(SRC), 'cost_finding_detections');

  it('finds the statements it is meant to check', () => {
    // Two upserts, the hidden-list read and the reopen read.
    expect(statements.length).toBeGreaterThanOrEqual(4);
  });

  it('allows no statement without a top-level organization predicate', () => {
    const missing = statements.filter(({ statement }) => !hasOrganizationPredicate(statement, 'cost_finding_detections'));
    expect(missing).toEqual([]);
  });

  it('the check rejects an unscoped, subquery-scoped or OR-bypassed statement', () => {
    const check = (sql: string) => hasOrganizationPredicate(sql, 'cost_finding_detections');
    expect(check('SELECT * FROM cost_finding_detections WHERE resource_id = $1')).toBe(false);
    expect(check('SELECT * FROM cost_finding_detections WHERE organization_id = $1 OR true')).toBe(false);
    expect(check('UPDATE cost_finding_detections SET outcome = $2 WHERE resource_id IN (SELECT resource_id FROM x WHERE organization_id = $1)')).toBe(false);
    expect(check('INSERT INTO cost_finding_detections (resource_id) VALUES ($1)')).toBe(false);
    expect(check('SELECT * FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2')).toBe(true);
  });
});

describe('static: cost_recommendations, every statement in its repository', () => {
  const statements = statementsInFiles([REPOSITORY], 'cost_recommendations');

  it('finds the statements it is meant to check', () => {
    expect(statements.length).toBeGreaterThanOrEqual(20);
  });

  it('allows no statement without a top-level organization predicate', () => {
    const missing = statements.filter(({ statement }) => !hasOrganizationPredicate(statement, 'cost_recommendations', ['cr']));
    expect(missing).toEqual([]);
  });

  it('reconciliation\'s parenthesised region OR is one conjunct; a bare OR is not', () => {
    const check = (sql: string) => hasOrganizationPredicate(sql, 'cost_recommendations', ['cr']);
    expect(check(`UPDATE cost_recommendations SET occurrence_ended_at = NOW()
      WHERE organization_id = $1 AND issue = $2 AND ($5::varchar IS NULL OR aws_region = $5 OR aws_region IS NULL)`)).toBe(true);
    expect(check(`UPDATE cost_recommendations SET occurrence_ended_at = NOW()
      WHERE organization_id = $1 AND issue = $2 OR aws_region IS NULL`)).toBe(false);
    expect(check('SELECT * FROM cost_recommendations cr WHERE cr.organization_id = $1 OR cr.status = $2')).toBe(false);
    expect(check('SELECT * FROM cost_recommendations cr JOIN x o ON o.id = cr.id WHERE o.organization_id = $1')).toBe(false);
  });
});

describe('live: cost_finding_detections RLS, as the application role', () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  const created: string[] = [];

  async function insertOrg(): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
      [`Detections Scope Org ${suffix}`, `detections-scope-org-${suffix}`]
    );
    created.push(rows[0].id);
    return rows[0].id;
  }

  /** Runs `fn` as devcontrol (forced RLS and its grants apply), optionally tagged for `orgId`. */
  async function asApplication<T>(orgId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE devcontrol');
      if (orgId) await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgId]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  afterAll(async () => {
    if (created.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [created]);
    await pool.end();
  });

  it('the table is RLS-forced with exactly SELECT, INSERT, UPDATE for devcontrol', async () => {
    const { rows } = await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'cost_finding_detections'::regclass`
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const grants = await pool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'cost_finding_detections' AND grantee = 'devcontrol' ORDER BY 1`
    );
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('untagged sees nothing; tagged sees only its own organization; cross-org writes and deletes are refused', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await pool.query(
      `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, outcome)
       VALUES ($1, 'res-a', 'Idle Instance', 'unknown'), ($2, 'res-b', 'Idle Instance', 'unknown')`,
      [orgA, orgB]
    );

    expect(await asApplication(null, async (c) => (await c.query('SELECT organization_id FROM cost_finding_detections WHERE organization_id = ANY($1)', [[orgA, orgB]])).rows)).toEqual([]);
    expect(await asApplication(orgA, async (c) => (await c.query('SELECT organization_id FROM cost_finding_detections WHERE organization_id = ANY($1)', [[orgA, orgB]])).rows)).toEqual([{ organization_id: orgA }]);

    await expect(asApplication(orgA, (c) => c.query(
      `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, outcome) VALUES ($1, 'res-x', 'Idle Instance', 'unknown')`, [orgB]
    ))).rejects.toThrow(/row-level security/);
    const updated = await asApplication(orgA, (c) => c.query(`UPDATE cost_finding_detections SET outcome = 'unknown' WHERE organization_id = $1`, [orgB]));
    expect(updated.rowCount).toBe(0);
    await expect(asApplication(orgA, (c) => c.query('DELETE FROM cost_finding_detections WHERE organization_id = $1', [orgA]))).rejects.toThrow(/permission denied/);
  });
});
