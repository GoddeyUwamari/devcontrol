/**
 * The migration is applied to production BEFORE this code is deployed, so the
 * release running then must keep working on the new schema. These are its
 * statements, verbatim from the previous repository (6fc58dc).
 */
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
let orgId: string;

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Run Compat Org ${suffix}`, `run-compat-org-${suffix}`, `Run Compat Org ${suffix}`]
  );
  orgId = rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await pool.end();
});

const oldCreate = async () =>
  (await pool.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, started_at)
         VALUES ($1, 'running', NOW())
         RETURNING *`,
    [orgId]
  )).rows[0];

describe('the deployed release on the migrated schema', () => {
  it('create: the row reads as a manual run with no recorded counts', async () => {
    const run = await oldCreate();
    expect(run).toMatchObject({ source: 'manual', status: 'running', detected_count: null, checks: null, lease_acquired_at: null });
  });

  it('complete', async () => {
    const run = await oldCreate();
    await pool.query(
      `UPDATE cost_analysis_runs
         SET status = 'completed', completed_at = NOW(),
             recommendations_found = $1, total_potential_savings = $2
         WHERE id = $3 AND organization_id = $4`,
      [0, 0, run.id, orgId]
    );
    const { rows } = await pool.query(`SELECT status FROM cost_analysis_runs WHERE id = $1`, [run.id]);
    expect(rows[0].status).toBe('completed');
  });

  it('fail', async () => {
    const run = await oldCreate();
    await pool.query(
      `UPDATE cost_analysis_runs
         SET status = 'failed', completed_at = NOW(), error_message = $1
         WHERE id = $2 AND organization_id = $3`,
      ['placeholder', run.id, orgId]
    );
    const { rows } = await pool.query(`SELECT status FROM cost_analysis_runs WHERE id = $1`, [run.id]);
    expect(rows[0].status).toBe('failed');
  });

  it('read', async () => {
    const { rows } = await pool.query(`SELECT * FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2`, [orgId, 5]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('the constraints', () => {
  it('rejects an unknown status and an unknown source', async () => {
    await expect(pool.query(`INSERT INTO cost_analysis_runs (organization_id, status) VALUES ($1, 'nonsense')`, [orgId])).rejects.toThrow('cost_analysis_runs_status_check');
    await expect(pool.query(`INSERT INTO cost_analysis_runs (organization_id, source) VALUES ($1, 'nonsense')`, [orgId])).rejects.toThrow('cost_analysis_runs_source_check');
  });
});
