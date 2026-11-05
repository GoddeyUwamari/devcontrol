/**
 * AWS connect PR C (C-a), L3: a cost analysis run row is created only inside a
 * fenced transaction, by the scan lease (discovery) or by the connection the
 * run belongs to (Analyze, before any lease is held). A stale worker creates no
 * row; a connection change holding the lock makes the creation wait and then
 * refuses it. Production code never calls the unfenced create(), which stays
 * for test fixtures. Real Postgres. Placeholders only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { CostAnalysisRunsRepository } from '../cost-analysis-runs.repository';
import { ConnectionChangedError, currentConnectionIdentity, withConnectionChange } from '../../services/aws-connection-fence';
import { LeaseLostError } from '../../services/scan-lease';
import { PLACEHOLDER_ACCOUNT_ROW, TestLeases, connectPlaceholderAccount, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const runs = new CostAnalysisRunsRepository();
const leases = new TestLeases(pool);
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Fenced Run Org ${suffix}`, `fenced-run-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

async function replaceRow(c: { query: Pool['query'] }, orgId: string): Promise<void> {
  const { rows } = await c.query(`DELETE FROM aws_accounts WHERE org_id = $1 RETURNING account_id, region`, [orgId]);
  await c.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', $4, 'active')`,
    [orgId, PLACEHOLDER_ACCOUNT_ROW.role_arn, rows[0].account_id, rows[0].region]
  );
}

const runCount = async (orgId: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM cost_analysis_runs WHERE organization_id = $1`, [orgId])).rows[0].n;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});
afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM cost_analysis_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await leases.cleanup();
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('createFenced: the connection fence (Analyze)', () => {
  it('the current connection creates the row', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const identity = await currentConnectionIdentity(pool, orgId);
    const run = await runs.createFenced(orgId, {}, { connection: identity! });
    expect(run).toMatchObject({ organization_id: orgId, status: 'running', source: 'manual' });
    expect(await runCount(orgId)).toBe(1);
  });

  it('a stale identity creates nothing (ConnectionChangedError)', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const stale = await currentConnectionIdentity(pool, orgId);
    await withConnectionChange(pool, orgId, (c) => replaceRow(c, orgId));
    await expect(runs.createFenced(orgId, {}, { connection: stale! })).rejects.toBeInstanceOf(ConnectionChangedError);
    expect(await runCount(orgId)).toBe(0);
  });

  it('concurrent: a change holding the lock makes the creation wait, then refuses it', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const stale = await currentConnectionIdentity(pool, orgId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const change = withConnectionChange(pool, orgId, async (c) => {
      await replaceRow(c, orgId);
      entered();
      await held;
    });
    await inside;
    let settled = false;
    const create = runs.createFenced(orgId, {}, { connection: stale! }).then(
      (value: unknown) => { settled = true; return value; },
      (error: unknown) => { settled = true; return error; }
    );
    try {
      const deadline = Date.now() + 10_000;
      while ((await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n === 0) {
        if (settled || Date.now() > deadline) throw new Error('the creation never waited for the connection lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
      await change;
    }
    expect(await create).toBeInstanceOf(ConnectionChangedError);
    expect(await runCount(orgId)).toBe(0);
  }, 30_000);
});

describe('createFenced: the scan lease fence (discovery)', () => {
  it('a held lease on the current connection creates the row', async () => {
    const orgId = await insertOrg();
    const lease = await leases.hold(orgId);
    const run = await runs.createFenced(orgId, { source: 'discovery', leaseAcquiredAt: lease.acquiredAt }, { lease });
    expect(run).toMatchObject({ status: 'running', source: 'discovery' });
  });

  it('a lease whose connection was replaced creates nothing (account_changed)', async () => {
    const orgId = await insertOrg();
    const lease = await leases.hold(orgId);
    await withConnectionChange(pool, orgId, (c) => replaceRow(c, orgId));
    const error = await runs.createFenced(orgId, { source: 'discovery' }, { lease }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(LeaseLostError);
    expect(error).toMatchObject({ reason: 'account_changed' });
    expect(await runCount(orgId)).toBe(0);
  });
});

describe('static: no production file creates a run row unfenced', () => {
  const SRC = path.join(__dirname, '../..');
  const productionFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  it('every cost_analysis_runs INSERT is in the repository, and every production caller uses createFenced()', () => {
    const offenders: string[] = [];
    for (const file of productionFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      const relative = path.relative(SRC, file);
      if (/INSERT INTO cost_analysis_runs/.test(source) && relative !== path.join('repositories', 'cost-analysis-runs.repository.ts')) offenders.push(`${relative}: INSERT`);
      if (/\b(analysisRunsRepository|costRuns|runsRepository|runs)\.create\(/.test(source) || /CostAnalysisRunsRepository\(\)\.create\(/.test(source)) offenders.push(`${relative}: unfenced create()`);
    }
    expect(offenders).toEqual([]);
  });
});
