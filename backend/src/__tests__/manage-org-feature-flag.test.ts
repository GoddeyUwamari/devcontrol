/**
 * Multi-region PR 1: the staff script that turns multi_region_discovery on or off for
 * one organization (backend/scripts/manage-org-feature-flag.js).
 *   - dry run by default: prints before and what --apply would do; writes nothing;
 *   - --apply writes and prints before and after;
 *   - idempotent: the same state again writes nothing (set_at unchanged);
 *   - "off" keeps the row (audit), enabled = false;
 *   - refuses a bad id, an unknown organization, an unknown flag or argument.
 * Real Postgres (the table's owner, as the script is run). Placeholders only.
 */
import { Client, Pool } from 'pg';

// The script is plain CommonJS (backend/scripts is not compiled).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require('../../scripts/manage-org-feature-flag.js') as {
  run: (argv: string[], io: { client: Client; log: (line: string) => void; error: (line: string) => void }) => Promise<number>;
};

const config = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(config());
let client: Client;
const orgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $3, 'free', 'active') RETURNING id`,
    [`Flag Org ${suffix}`, `flag-org-${suffix}`, `Flag Org ${suffix}`]
  );
  orgIds.push(rows[0].id);
  return rows[0].id;
}

async function flagRow(orgId: string) {
  return (await pool.query(`SELECT enabled, set_by, set_at, note FROM organization_feature_flags WHERE organization_id = $1`, [orgId])).rows;
}

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await script.run(argv, { client, log: (line) => out.push(line), error: (line) => err.push(line) });
  return { code, out, err };
}

beforeAll(async () => {
  client = new Client(config());
  await client.connect();
});

afterAll(async () => {
  await client.end();
  if (orgIds.length > 0) {
    await pool.query('DELETE FROM organization_feature_flags WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
  }
  await pool.end();
});

describe('manage-org-feature-flag.js', () => {
  it('dry run by default: before and what --apply would do; nothing written', async () => {
    const orgId = await insertOrg();
    const { code, out } = await run([orgId, 'on', '--by', 'staff-1', '--note', 'internal org first']);
    expect(code).toBe(0);
    expect(out).toEqual([
      `Organization ${orgId}, flag multi_region_discovery`,
      '  before: no row (OFF)',
      '  dry run: --apply would set enabled=true, set_by=staff-1, note="internal org first". Nothing written.',
    ]);
    expect(await flagRow(orgId)).toEqual([]);
  });

  it('--apply turns it on, prints before and after; again: no change, set_at unchanged; off keeps the row', async () => {
    const orgId = await insertOrg();
    const on = await run([orgId, 'on', '--by', 'staff-1', '--apply']);
    expect(on.code).toBe(0);
    expect(on.out[1]).toBe('  before: no row (OFF)');
    expect(on.out[2]).toMatch(/^ {2}after: {2}enabled=true, set_by=staff-1, set_at=\S+, note=null$/);
    const [first] = await flagRow(orgId);
    expect(first).toMatchObject({ enabled: true, set_by: 'staff-1', note: null });

    const again = await run([orgId, 'on', '--by', 'staff-2', '--apply']);
    expect(again.out[2]).toBe('  no change: the flag is already ON; nothing written.');
    expect(await flagRow(orgId)).toEqual([first]);

    const off = await run([orgId, 'off', '--by', 'staff-2', '--apply']);
    expect(off.code).toBe(0);
    expect(off.out[2]).toMatch(/^ {2}after: {2}enabled=false, set_by=staff-2/);
    expect(await flagRow(orgId)).toEqual([expect.objectContaining({ enabled: false, set_by: 'staff-2' })]);

    const status = await run([orgId, 'status']);
    expect(status.out[1]).toMatch(/^ {2}before: enabled=false, set_by=staff-2/);
  });

  it('off with no row: no change (no row is OFF)', async () => {
    const orgId = await insertOrg();
    const { out } = await run([orgId, 'off', '--apply']);
    expect(out[2]).toBe('  no change: the flag is already OFF; nothing written.');
    expect(await flagRow(orgId)).toEqual([]);
  });

  it.each([
    [['not-a-uuid', 'on'], 'The first argument must be an organization id'],
    [['00000000-0000-4000-8000-0000000000f1', 'enable'], 'The command must be status, on or off'],
    [['00000000-0000-4000-8000-0000000000f1', 'on', '--flag', 'everything'], 'Unknown flag everything'],
    [['00000000-0000-4000-8000-0000000000f1', 'on', '--force'], 'Unknown argument --force'],
    [['00000000-0000-4000-8000-0000000000f1', 'status', '--apply'], 'status takes no --apply'],
    [['00000000-0000-4000-8000-0000000000f1', 'on', '--apply'], 'No organization with id 00000000-0000-4000-8000-0000000000f1'],
  ])('refuses %p', async (argv, message) => {
    const { code, err } = await run(argv as string[]);
    expect(code).toBe(1);
    expect(err[0]).toContain(message);
  });
});
