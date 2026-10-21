/**
 * Multi-region plan M5a (m5-plan.md §2-3, §7): the account's region list.
 *
 *  - parseRegionList / describeAccountRegions (services/region-list.ts): the
 *    one DescribeRegions call and what is accepted from it (D3, D2, D6).
 *  - recordRegionList (repositories/multi-region-foundation.repository.ts):
 *    the fenced write to aws_account_regions (F17) -- opt-in, disabled and
 *    changed lists (D3-D5), idempotency, never deleting a row, stale tokens
 *    (F1), the account check (F2) and two-organization isolation (I1).
 *
 * The repository tests run against their own schema holding the real
 * foundation migration (read from disk), as devcontrol under row-level
 * security, the way scan-lease.test.ts does; the schema is dropped in finally.
 *
 * Fixture: a real DescribeRegions { AllRegions: true } response, region fields
 * only (fixtures/describe-regions.json). It has no 'opted-in' region, so the
 * opted-in and changing-list cases use variants DERIVED from it by flipping one
 * region's OptInStatus; each is labelled "derived". Placeholders only.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { MAX_LISTED_REGIONS, ListedRegion, describeAccountRegions, parseRegionList } from '../region-list';
import { recordRegionList } from '../../repositories/multi-region-foundation.repository';
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository';
import { HeldLease, LeaseLostError, acquireScanLease, releaseLease } from '../scan-lease';
import { AwsCallTimeoutError } from '../../utils/awsCallPolicy';

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../../../database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql'),
  'utf8'
);

interface FixtureRegion {
  RegionName: string;
  OptInStatus: string;
}
const FIXTURE: { Regions: FixtureRegion[] } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/describe-regions.json'), 'utf8'));
const HOME = 'us-east-1';

/** Documented placeholder account ids (aws-account-id-literals.test.ts). */
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '123456789012';
const roleArn = (account: string) => `arn:aws:iam::${account}:role/devcontrol-test`;

/** The real response. */
function realResponse(): { Regions: FixtureRegion[] } {
  return { Regions: FIXTURE.Regions.map((r) => ({ ...r })) };
}

/** DERIVED from the real response: `region`'s OptInStatus replaced by `status`. */
function derivedResponse(region: string, status: string): { Regions: FixtureRegion[] } {
  const response = realResponse();
  const entry = response.Regions.find((r) => r.RegionName === region);
  if (!entry) throw new Error(`derivedResponse: ${region} is not in the fixture`);
  entry.OptInStatus = status;
  return response;
}

/** DERIVED from the real response: `region` left out. */
function derivedWithout(region: string): { Regions: FixtureRegion[] } {
  const response = realResponse();
  return { Regions: response.Regions.filter((r) => r.RegionName !== region) };
}

function listed(response: unknown): ListedRegion[] {
  const result = parseRegionList(response, HOME);
  if (!result.ok) throw new Error(`fixture not accepted: ${result.detail}`);
  return result.regions;
}

/** `length` well-formed, enabled entries that include the home region (us-east-0 ... us-east-<length-1>). */
function regionsOfLength(length: number): FixtureRegion[] {
  return Array.from({ length }, (_, i) => ({ RegionName: `us-east-${i}`, OptInStatus: 'opt-in-not-required' }));
}

/** Names that match the region pattern; 33 characters is one more than aws_account_regions.region (VARCHAR(32)) holds. */
const NAME_33 = `us-${'a'.repeat(28)}-1`;
const NAME_32 = `us-${'a'.repeat(27)}-1`;

const ENABLED_IN_FIXTURE = FIXTURE.Regions.filter((r) => r.OptInStatus === 'opt-in-not-required').map((r) => r.RegionName).sort();
/** An opt-in region the real account has not opted into (a real 'not-opted-in' entry). */
const OPT_IN_REGION = 'eu-south-1';
/** A default region (a real 'opt-in-not-required' entry) other than the home region. */
const DEFAULT_REGION = 'eu-west-1';

describe('the fixture (a real response, region fields only)', () => {
  it('is what the tests assume: no opted-in region, the home region and the derived regions present', () => {
    expect(FIXTURE.Regions.length).toBeGreaterThan(20);
    expect(new Set(FIXTURE.Regions.map((r) => r.OptInStatus))).toEqual(new Set(['opt-in-not-required', 'not-opted-in']));
    expect(FIXTURE.Regions.find((r) => r.RegionName === HOME)?.OptInStatus).toBe('opt-in-not-required');
    expect(FIXTURE.Regions.find((r) => r.RegionName === OPT_IN_REGION)?.OptInStatus).toBe('not-opted-in');
    expect(FIXTURE.Regions.find((r) => r.RegionName === DEFAULT_REGION)?.OptInStatus).toBe('opt-in-not-required');
    for (const region of FIXTURE.Regions) expect(Object.keys(region).sort()).toEqual(['OptInStatus', 'RegionName']);
  });
});

// ---------------------------------------------------------------------------
describe('parseRegionList', () => {
  it('D3 the real response: every region kept, enabled exactly when opt-in-not-required, nothing dropped', () => {
    const result = parseRegionList(realResponse(), HOME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toBe(0);
    expect(result.regions).toHaveLength(FIXTURE.Regions.length);
    expect(result.regions.filter((r) => r.enabled).map((r) => r.region).sort()).toEqual(ENABLED_IN_FIXTURE);
    for (const region of result.regions) {
      expect(region.optInStatus).toBe(FIXTURE.Regions.find((r) => r.RegionName === region.region)!.OptInStatus);
    }
  });

  it('D3 derived: an opted-in region is enabled', () => {
    const regions = listed(derivedResponse(OPT_IN_REGION, 'opted-in'));
    expect(regions.find((r) => r.region === OPT_IN_REGION)).toEqual({ region: OPT_IN_REGION, optInStatus: 'opted-in', enabled: true });
  });

  it('D3 derived: a status this code does not know is kept but is not enabled; a status the column refuses is null', () => {
    const unknown = listed(derivedResponse(OPT_IN_REGION, 'opting-in'));
    expect(unknown.find((r) => r.region === OPT_IN_REGION)).toEqual({ region: OPT_IN_REGION, optInStatus: 'opting-in', enabled: false });
    const refused = listed(derivedResponse(OPT_IN_REGION, 'Opted In'));
    expect(refused.find((r) => r.region === OPT_IN_REGION)).toEqual({ region: OPT_IN_REGION, optInStatus: null, enabled: false });
    const missing = realResponse();
    delete (missing.Regions.find((r) => r.RegionName === OPT_IN_REGION) as Partial<FixtureRegion>).OptInStatus;
    expect(listed(missing).find((r) => r.region === OPT_IN_REGION)).toEqual({ region: OPT_IN_REGION, optInStatus: null, enabled: false });
  });

  it.each([
    ['no response', undefined],
    ['no Regions', {}],
    ['an empty list', { Regions: [] }],
    ['Regions that is not a list', { Regions: 'us-east-1' }],
    ['more entries than the limit (65)', { Regions: regionsOfLength(MAX_LISTED_REGIONS + 1) }],
    ['derived: the home region missing', derivedWithout(HOME)],
    ['derived: the home region not enabled', derivedResponse(HOME, 'not-opted-in')],
  ])('D2 refuses %s as invalid', (_label, response) => {
    const result = parseRegionList(response, HOME);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('D2 exactly the limit (64 entries) is accepted', () => {
    expect(MAX_LISTED_REGIONS).toBe(64);
    const result = parseRegionList({ Regions: regionsOfLength(64) }, HOME);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.regions).toHaveLength(64);
  });

  it('D2 a name longer than the column (33 characters) is dropped and counted; 32 characters is kept; the rest of the list is kept', () => {
    expect(NAME_33).toHaveLength(33);
    expect(NAME_32).toHaveLength(32);
    const response: { Regions: FixtureRegion[] } = realResponse();
    response.Regions.push({ RegionName: NAME_33, OptInStatus: 'opt-in-not-required' });
    response.Regions.push({ RegionName: NAME_32, OptInStatus: 'opt-in-not-required' });
    const result = parseRegionList(response, HOME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toBe(1);
    expect(result.regions.map((r) => r.region)).not.toContain(NAME_33);
    expect(result.regions.map((r) => r.region)).toContain(NAME_32);
    expect(result.regions).toHaveLength(FIXTURE.Regions.length + 1);
  });

  it('D2 a name the table would refuse is dropped, the rest kept; a repeated name keeps its first entry', () => {
    const response: { Regions: any[] } = realResponse();
    response.Regions.push({ RegionName: 'global', OptInStatus: 'opt-in-not-required' });
    response.Regions.push({ RegionName: 'US-EAST-9', OptInStatus: 'opt-in-not-required' });
    response.Regions.push({ RegionName: 42, OptInStatus: 'opt-in-not-required' });
    response.Regions.push({ RegionName: DEFAULT_REGION, OptInStatus: 'not-opted-in' });
    const result = parseRegionList(response, HOME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toBe(3);
    expect(result.regions).toHaveLength(FIXTURE.Regions.length);
    expect(result.regions.find((r) => r.region === DEFAULT_REGION)!.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('describeAccountRegions: the one AWS call', () => {
  it('D6 sends exactly one DescribeRegionsCommand with AllRegions: true', async () => {
    const send = jest.fn(async () => realResponse());
    const result = await describeAccountRegions({ send }, HOME);
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0] as unknown as [DescribeRegionsCommand];
    expect(command).toBeInstanceOf(DescribeRegionsCommand);
    expect(command.input).toEqual({ AllRegions: true });
  });

  const ARN_TEXT = `User: arn:aws:sts::${ACCOUNT_A}:assumed-role/devcontrol-test/session is not authorized to perform: ec2:DescribeRegions`;
  it.each([
    ['UnauthorizedOperation', Object.assign(new Error(ARN_TEXT), { name: 'UnauthorizedOperation' }), 'denied'],
    ['AccessDenied', Object.assign(new Error(ARN_TEXT), { name: 'AccessDenied' }), 'denied'],
    ['an HTTP 403', Object.assign(new Error(ARN_TEXT), { name: 'Forbidden', $metadata: { httpStatusCode: 403 } }), 'denied'],
    ['a call timeout', new AwsCallTimeoutError(15_000), 'timed_out'],
    ['throttling past the retries', Object.assign(new Error(ARN_TEXT), { name: 'ThrottlingException' }), 'failed'],
    ['any other error', new Error(ARN_TEXT), 'failed'],
  ])('D1/D2 %s is a failure result, never a throw, and its message is not carried', async (_label, error, reason) => {
    const result = await describeAccountRegions({ send: jest.fn(async () => { throw error; }) }, HOME);
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_A);
    expect(JSON.stringify(result)).not.toContain('arn:');
  });

  it('D6 static: DescribeRegionsCommand is used by region-list.ts only, and no account/opt-in API is called', () => {
    const root = path.join(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.ts$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/DescribeRegionsCommand/.test(text) && path.relative(root, full) !== path.join('services', 'region-list.ts')) offenders.push(full);
          if (/@aws-sdk\/client-account|ListRegionsCommand|GetRegionOptStatusCommand/.test(text)) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recordRegionList against the real migration, as devcontrol under RLS.

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const ROLE_SQL = 'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user';
let schemaCounter = 0;

interface Env {
  schema: string;
  admin: Client;
  organization: (account?: string | null) => Promise<string>;
  connection: (organization: string) => Promise<Client>;
}

async function withSchema(fn: (env: Env) => Promise<void>): Promise<void> {
  const admin = new Client(dbConfig());
  await admin.connect();
  const schema = `m5a_region_list_test_${process.pid}_${Date.now()}_${schemaCounter++}`;
  const clients: Client[] = [];
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET LOCAL search_path TO ${schema}`);
    await admin.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255) NOT NULL)`);
    await admin.query(`
      CREATE TABLE resource_discovery_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`);
    await admin.query(`
      CREATE TABLE aws_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL,
        role_arn TEXT NOT NULL,
        account_id VARCHAR(32),
        nickname VARCHAR(255),
        external_id VARCHAR(64),
        region VARCHAR(32) DEFAULT 'us-east-1',
        connected_at TIMESTAMPTZ,
        status VARCHAR(32)
      )`);
    await admin.query(MIGRATION_SQL);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
    await admin.query(`GRANT SELECT ON aws_accounts TO devcontrol`);
    await admin.query('COMMIT');

    await fn({
      schema,
      admin,
      organization: async (account = ACCOUNT_A) => {
        const org = (await admin.query(`INSERT INTO ${schema}.organizations (name) VALUES ('Region Org') RETURNING id`)).rows[0].id;
        if (account) await admin.query(`INSERT INTO ${schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(account)]);
        return org;
      },
      connection: async (organization) => {
        const client = new Client({ ...dbConfig(), options: '-c statement_timeout=15000' });
        client.on('error', () => undefined);
        await client.connect();
        clients.push(client);
        await client.query(`SET search_path TO ${schema}`);
        await client.query('SET ROLE devcontrol');
        await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organization]);
        expect((await client.query(ROLE_SQL)).rows).toEqual([{ role: 'devcontrol', rolsuper: false, rolbypassrls: false }]);
        return client;
      },
    });
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

const scanKey = (organizationId: string, awsAccountId = ACCOUNT_A) => ({ organizationId, awsAccountId, scanKind: 'discovery' });

/** Every row of the organization, read as the owner (no RLS), by region. */
async function rowsOf(env: Env, org: string): Promise<Record<string, any>> {
  const { rows } = await env.admin.query(`SELECT * FROM ${env.schema}.aws_account_regions WHERE organization_id = $1 ORDER BY region`, [org]);
  return Object.fromEntries(rows.map((row) => [row.region, row]));
}

/** The rows without the two columns every list rewrites. */
function withoutListTimes(rows: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(rows).map(([region, row]) => {
      const rest = { ...row };
      delete rest.last_listed_at;
      delete rest.updated_at;
      return [region, rest];
    })
  );
}

async function lease(db: Client, org: string, account = ACCOUNT_A, ttlSeconds?: number): Promise<HeldLease> {
  const held = await acquireScanLease(db, scanKey(org, account), 'm5a-test', { ttlSeconds });
  expect(held).not.toBeNull();
  return held!;
}

describe('recordRegionList (F17): what is written', () => {
  it('D3 the real list: one row per region, enabled as reported, one last_listed_at, scan columns at their defaults', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const written = await recordRegionList(db, await lease(db, org), listed(realResponse()));
      expect(written).toBe(FIXTURE.Regions.length);

      const rows = await rowsOf(env, org);
      expect(Object.keys(rows).sort()).toEqual(FIXTURE.Regions.map((r) => r.RegionName).sort());
      expect(Object.values(rows).filter((r) => r.enabled).map((r) => r.region).sort()).toEqual(ENABLED_IN_FIXTURE);
      expect(new Set(Object.values(rows).map((r) => r.last_listed_at.toISOString())).size).toBe(1);
      for (const row of Object.values(rows)) {
        expect(row).toMatchObject({
          aws_account_id: ACCOUNT_A,
          scan_enabled: true,
          disabled_at: null,
          last_scan_started_at: null,
          last_scan_finished_at: null,
          last_success_at: null,
          last_scan_status: 'never_scanned',
          last_error_code: null,
          last_error_message: null,
          consecutive_failures: 0,
        });
      }
      expect(rows[OPT_IN_REGION]).toMatchObject({ opt_in_status: 'not-opted-in', enabled: false });
    });
  });

  it('D2 a list with one 33-character name still saves every other region (a 32-character name is saved too)', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const response: { Regions: FixtureRegion[] } = realResponse();
      response.Regions.push({ RegionName: NAME_33, OptInStatus: 'opt-in-not-required' });
      response.Regions.push({ RegionName: NAME_32, OptInStatus: 'opt-in-not-required' });
      await recordRegionList(db, await lease(db, org), listed(response));
      expect(Object.keys(await rowsOf(env, org)).sort()).toEqual([...FIXTURE.Regions.map((r) => r.RegionName), NAME_32].sort());
    });
  });

  it('idempotent: the same list again changes only last_listed_at and updated_at', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      await recordRegionList(db, held, listed(realResponse()));
      const before = await rowsOf(env, org);
      await recordRegionList(db, held, listed(realResponse()));
      const after = await rowsOf(env, org);
      expect(withoutListTimes(after)).toEqual(withoutListTimes(before));
      expect(after[HOME].last_listed_at.getTime()).toBeGreaterThan(before[HOME].last_listed_at.getTime());
    });
  });

  it('D4 derived: an opted-in region that is later not opted in is disabled once, then enabled again', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);

      await recordRegionList(db, held, listed(derivedResponse(OPT_IN_REGION, 'opted-in'))); // derived
      expect((await rowsOf(env, org))[OPT_IN_REGION]).toMatchObject({ opt_in_status: 'opted-in', enabled: true, disabled_at: null });

      await recordRegionList(db, held, listed(realResponse()));
      const disabled = (await rowsOf(env, org))[OPT_IN_REGION];
      expect(disabled).toMatchObject({ opt_in_status: 'not-opted-in', enabled: false });
      expect(disabled.disabled_at).toBeInstanceOf(Date);

      await recordRegionList(db, held, listed(realResponse()));
      expect((await rowsOf(env, org))[OPT_IN_REGION].disabled_at).toEqual(disabled.disabled_at);

      await recordRegionList(db, held, listed(derivedResponse(OPT_IN_REGION, 'opted-in'))); // derived
      expect((await rowsOf(env, org))[OPT_IN_REGION]).toMatchObject({ enabled: true, disabled_at: null });
    });
  });

  it('D4 a region that is never enabled has no disabled_at', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      await recordRegionList(db, held, listed(realResponse()));
      await recordRegionList(db, held, listed(realResponse()));
      expect((await rowsOf(env, org))[OPT_IN_REGION].disabled_at).toBeNull();
    });
  });

  it('D4 the scan columns and the allow-list are never written by the list, even when a region is disabled', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      await recordRegionList(db, held, listed(derivedResponse(OPT_IN_REGION, 'opted-in'))); // derived
      await env.admin.query(
        `UPDATE ${env.schema}.aws_account_regions
            SET scan_enabled = false, last_scan_started_at = now() - interval '2 hours', last_scan_finished_at = now() - interval '1 hour',
                last_success_at = now() - interval '1 hour', last_scan_status = 'partial', last_error_code = 'discovery_listing_truncated',
                consecutive_failures = 3, first_seen_at = now() - interval '30 days'
          WHERE organization_id = $1 AND region = $2`,
        [org, OPT_IN_REGION]
      );
      const scanColumns = (row: any) => ({
        scan_enabled: row.scan_enabled,
        first_seen_at: row.first_seen_at,
        last_scan_started_at: row.last_scan_started_at,
        last_scan_finished_at: row.last_scan_finished_at,
        last_success_at: row.last_success_at,
        last_scan_status: row.last_scan_status,
        last_error_code: row.last_error_code,
        last_error_message: row.last_error_message,
        consecutive_failures: row.consecutive_failures,
      });
      const before = scanColumns((await rowsOf(env, org))[OPT_IN_REGION]);
      await recordRegionList(db, held, listed(realResponse())); // the region is disabled
      expect(scanColumns((await rowsOf(env, org))[OPT_IN_REGION])).toEqual(before);
    });
  });

  it('D5 derived: a newly enabled region is added; a region missing from the list keeps its row and its older last_listed_at', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      const first = listed(derivedWithout(OPT_IN_REGION)); // derived: the opt-in region not listed yet
      await recordRegionList(db, held, first);
      const before = await rowsOf(env, org);
      expect(before[OPT_IN_REGION]).toBeUndefined();

      await recordRegionList(db, held, listed(derivedWithout(DEFAULT_REGION))); // derived: one region now missing
      const after = await rowsOf(env, org);
      expect(Object.keys(after).sort()).toEqual(FIXTURE.Regions.map((r) => r.RegionName).sort());
      expect(after[OPT_IN_REGION]).toMatchObject({ enabled: false, last_scan_status: 'never_scanned' });
      // Kept, unchanged, and recognisably not in the latest list.
      expect(after[DEFAULT_REGION]).toEqual(before[DEFAULT_REGION]);
      const latest = after[HOME].last_listed_at.getTime();
      expect(after[DEFAULT_REGION].last_listed_at.getTime()).toBeLessThan(latest);
      const { rows } = await env.admin.query(
        `SELECT count(*)::int AS n FROM ${env.schema}.aws_account_regions
          WHERE organization_id = $1 AND enabled
            AND last_listed_at = (SELECT max(last_listed_at) FROM ${env.schema}.aws_account_regions WHERE organization_id = $1)`,
        [org]
      );
      expect(rows[0].n).toBe(ENABLED_IN_FIXTURE.length - 1);
    });
  });
});

describe('recordRegionList (F17): fenced', () => {
  it('F1 a token from a released lease that another worker took over writes nothing', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const a = await env.connection(org);
      const b = await env.connection(org);
      const stale = await lease(a, org);
      await recordRegionList(a, stale, listed(realResponse()));
      const before = await rowsOf(env, org);

      await releaseLease(a, stale);
      const current = await lease(b, org);
      expect(BigInt(current.fencingToken)).toBeGreaterThan(BigInt(stale.fencingToken));

      const error = await recordRegionList(a, stale, listed(derivedResponse(OPT_IN_REGION, 'opted-in'))).catch((err) => err); // derived
      expect(error).toBeInstanceOf(LeaseLostError);
      expect(await rowsOf(env, org)).toEqual(before);

      await recordRegionList(b, current, listed(derivedResponse(OPT_IN_REGION, 'opted-in'))); // derived
      expect((await rowsOf(env, org))[OPT_IN_REGION].enabled).toBe(true);
    });
  });

  it('F1 a lease that expired by the database clock and was taken over writes nothing', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const a = await env.connection(org);
      const b = await env.connection(org);
      const stale = await lease(a, org, ACCOUNT_A, 1);
      const deadline = Date.now() + 15_000;
      while ((await env.admin.query(`SELECT expires_at <= clock_timestamp() AS e FROM ${env.schema}.aws_scan_leases WHERE organization_id = $1`, [org])).rows[0].e !== true) {
        if (Date.now() > deadline) throw new Error('the lease did not expire');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Expired but not yet taken over: still refused (the fence reads the clock).
      expect(await recordRegionList(a, stale, listed(realResponse())).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      await lease(b, org);
      expect(await recordRegionList(a, stale, listed(realResponse())).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      expect(await rowsOf(env, org)).toEqual({});
    });
  });

  it.each([
    ['a second active account appears', 'second_active', AwsAccountAmbiguousError],
    ['the account row names another account', 'other', LeaseLostError],
  ] as const)('F2 %s: refused, nothing written', async (_label, change, errorType) => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      if (change === 'second_active') {
        await env.admin.query(`INSERT INTO ${env.schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(ACCOUNT_B)]);
      } else {
        await env.admin.query(`UPDATE ${env.schema}.aws_accounts SET role_arn = $2 WHERE org_id = $1`, [org, roleArn(ACCOUNT_B)]);
      }
      expect(await recordRegionList(db, held, listed(realResponse())).catch((err) => err)).toBeInstanceOf(errorType);
      expect(await rowsOf(env, org)).toEqual({});
    });
  });
});

describe('recordRegionList: two organizations (I1)', () => {
  it('two organizations with the same AWS account each keep their own rows', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization(ACCOUNT_A);
      const orgB = await env.organization(ACCOUNT_A);
      const dbA = await env.connection(orgA);
      const dbB = await env.connection(orgB);
      await recordRegionList(dbB, await lease(dbB, orgB), listed(realResponse()));
      const beforeB = await rowsOf(env, orgB);

      await recordRegionList(dbA, await lease(dbA, orgA), listed(derivedResponse(OPT_IN_REGION, 'opted-in'))); // derived
      expect(await rowsOf(env, orgB)).toEqual(beforeB);
      expect((await rowsOf(env, orgA))[OPT_IN_REGION].enabled).toBe(true);
      expect(beforeB[OPT_IN_REGION].enabled).toBe(false);

      // Row-level security: A's connection sees only A's rows.
      const visible = await dbA.query(`SELECT DISTINCT organization_id FROM aws_account_regions`);
      expect(visible.rows).toEqual([{ organization_id: orgA }]);
    });
  });

  it('another organization\'s lease on this organization\'s connection is refused, and nothing is written for either', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization(ACCOUNT_A);
      const orgB = await env.organization(ACCOUNT_A);
      const dbA = await env.connection(orgA);
      const dbB = await env.connection(orgB);
      const leaseB = await lease(dbB, orgB);
      expect(await recordRegionList(dbA, leaseB, listed(realResponse())).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      expect(await rowsOf(env, orgA)).toEqual({});
      expect(await rowsOf(env, orgB)).toEqual({});
    });
  });

  it('row-level security refuses a row for another organization even without the fence', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization(ACCOUNT_A);
      const orgB = await env.organization(ACCOUNT_A);
      const dbA = await env.connection(orgA);
      const error = await dbA
        .query(`INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, $3, true)`, [orgB, ACCOUNT_A, HOME])
        .catch((err) => err);
      expect(error?.message).toMatch(/row-level security/);
      expect(await rowsOf(env, orgB)).toEqual({});
    });
  });
});
