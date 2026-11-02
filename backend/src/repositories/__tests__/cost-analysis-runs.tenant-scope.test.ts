/**
 * cost_analysis_runs is owned by the application role in production, so
 * row-level security does not apply to it (no FORCE, by decision). The explicit
 * organization_id predicate on every statement is the only tenant boundary.
 *
 * The static half holds every SQL statement in backend/src naming the table to
 * that. The live half proves the predicates work: the test connection, like the
 * production owner, is not limited by RLS here, so a missing predicate shows.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { CostAnalysisRunsRepository } from '../cost-analysis-runs.repository';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** Every backtick or quoted string in `text` that is a statement on the table. */
function statementsOnTable(text: string): string[] {
  const strings = text.match(/`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? [];
  return strings.filter((s) => /\b(FROM|INTO|UPDATE|JOIN)\s+cost_analysis_runs\b/i.test(s));
}

export function hasOrganizationPredicate(statement: string): boolean {
  if (/INSERT\s+INTO\s+cost_analysis_runs\s*\(\s*organization_id\b/i.test(statement)) return true;
  return /WHERE[\s\S]*\b(r\.)?organization_id\s*=\s*\$\d/i.test(statement);
}

describe('static: every statement on cost_analysis_runs names the organization', () => {
  const files = sourceFiles(SRC);
  const statements = files.flatMap((file) => statementsOnTable(readFileSync(file, 'utf-8')).map((statement) => ({ file, statement })));

  it('finds the statements it is meant to check', () => {
    expect(statements.length).toBeGreaterThanOrEqual(8);
  });

  it('allows no statement without a predicate', () => {
    const missing = statements.filter(({ statement }) => !hasOrganizationPredicate(statement));
    expect(missing).toEqual([]);
  });

  it('the check itself rejects an unscoped statement', () => {
    expect(hasOrganizationPredicate('SELECT * FROM cost_analysis_runs WHERE id = $1')).toBe(false);
    expect(hasOrganizationPredicate('UPDATE cost_analysis_runs SET status = $1')).toBe(false);
    expect(hasOrganizationPredicate('INSERT INTO cost_analysis_runs (status) VALUES ($1)')).toBe(false);
  });
});

describe('live: no write or read crosses organizations', () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  const runs = new CostAnalysisRunsRepository();
  const created: string[] = [];
  const detail = { summary: { state: 'completed' as const, checks: [], failedDetectorCount: 0, unknownResourceCount: 0 }, counts: null };

  async function insertOrg(): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
      [`Run Scope Org ${suffix}`, `run-scope-org-${suffix}`, `Run Scope Org ${suffix}`]
    );
    created.push(rows[0].id);
    return rows[0].id;
  }

  const statusOf = async (id: string) => (await pool.query(`SELECT status, lease_acquired_at FROM cost_analysis_runs WHERE id = $1`, [id])).rows[0];

  afterAll(async () => {
    if (created.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [created]);
    await pool.end();
  });

  it('getLatest returns only the caller\'s rows, in every source mode', async () => {
    const [a, b] = [await insertOrg(), await insertOrg()];
    const mine = await runs.create(a);
    await runs.create(b);
    await runs.create(b, { source: 'discovery' });
    expect((await runs.getLatest(a, 50, null)).map((r) => r.id)).toEqual([mine.id]);
    expect((await runs.getLatest(a, 50, 'manual')).map((r) => r.id)).toEqual([mine.id]);
    expect(await runs.getLatest(a, 50, 'discovery')).toEqual([]);
  });

  it('read-time state ignores another organization\'s lease rows', async () => {
    const [a, b] = [await insertOrg(), await insertOrg()];
    const run = await runs.create(a);
    await runs.markLeaseAcquired(run.id, a, new Date());
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, '123456789012', 'discovery', 'other-org', NOW(), NOW(), NOW() + INTERVAL '5 minutes')`,
      [b]
    );
    expect((await runs.getLatest(a, 5, null))[0].run_state).toBe('interrupted');
  });

  it('a write with another organization\'s id changes nothing', async () => {
    const [a, b] = [await insertOrg(), await insertOrg()];
    const run = await runs.create(a);
    await runs.markLeaseAcquired(run.id, b, new Date());
    await runs.markInterrupted(run.id, b);
    await runs.markFailed(run.id, b, 'x');
    await runs.markFailed(run.id, b, 'x', detail);
    await runs.markFinished(run.id, b, { recommendationsFound: 0, totalPotentialSavings: 0, ...detail });
    expect(await statusOf(run.id)).toEqual({ status: 'running', lease_acquired_at: null });
  });

  it('recovery closes only the organization it was called for', async () => {
    const [a, b] = [await insertOrg(), await insertOrg()];
    const run = await runs.create(b);
    await runs.markLeaseAcquired(run.id, b, new Date(Date.now() - 60_000));
    expect(await runs.recoverInterrupted(a, new Date())).toBe(0);
    expect((await statusOf(run.id)).status).toBe('running');
  });
});
