/**
 * Multi-region PR 3c (Services home-region UI): the backend fields the page reads.
 *
 *   G9   GET /api/aws/accounts `can_change_home_region`: from the caller's CURRENT
 *        membership (the same check as the home-region routes), never the JWT role
 *        claim. Owner true; admin, member and viewer false.
 *   G2b  GET /api/services/coverage `account.previous_home_region_resources`: the
 *        former home region's regional resources still stored, exactly HR-1's
 *        regionalResourcesIn (not S3, not terminated); the number the change dialog
 *        showed as resources_kept_in_old_region. Present only alongside
 *        previous_home_region. Never the Services inventory count of the region.
 *   Owner-only code (founder decision Nov 17): the 403 of the three home-region
 *        routes keeps its message and gains `code: HOME_REGION_OWNER_ONLY`; every
 *        other owner-only route's 403 is unchanged (no code).
 *   Tenancy: the explicit organization predicate, and row-level security alone (the
 *        non-superuser devcontrol role with the predicate stripped). The GETs make no
 *        AWS call and write nothing.
 *
 * Real routes over live Postgres; only authService.verifyToken and the background scan
 * are stubbed. Placeholders only.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { STSClient } from '@aws-sdk/client-sts';
import awsRoutes, { CHECK_AGAIN_FORBIDDEN_MESSAGE, HOME_REGION_FORBIDDEN_MESSAGE, HOME_REGION_OWNER_ONLY_CODE } from '../aws.routes';
import servicesCoverageRoutes from '../services-coverage.routes';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { regionalResourcesIn } from '../../services/home-region.service';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { HOME_REGION_FIXTURE_TABLES, PROPOSAL, homeRegionRouteFixtures, type Org } from './home-region-route-fixtures';

const harness = createRoleGateHarness('home-region-pr3c');
const { pool } = harness;
const { connectedOrg, setProposal, stateOf, put, preview, dismiss, accounts } = homeRegionRouteFixtures(harness);
const DOC = path.join(__dirname, '..', '..', '..', '..', 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md');

// The shared @smithy/smithy-client base of every AWS SDK v3 client: no GET here may reach AWS.
const SmithyClient = Object.getPrototypeOf(STSClient.prototype).constructor;
let awsSend: jest.SpyInstance;
let discover: jest.SpyInstance;

interface Recorded { text: string }
const recorded: Recorded[] = [];
const originalClientQuery = Client.prototype.query;

const coverage = async (org: Pick<Org, 'orgId' | 'viewer'>, as: string = org.viewer) => {
  const res = await harness.sendAs(org.orgId, as, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  return (await res.json()).coverage;
};
const flagOn = (org: Org) =>
  pool.query(`INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'pr3c')`, [org.orgId]);

let seq = 0;
async function resource(org: Org, region: string, type: string, status: string | null = 'running') {
  seq += 1;
  const id = `pr3c-${seq}-${org.orgId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, $3, $4, $5, $6, '{}', '{}')`,
    [org.orgId, `arn:aws:${type}:${region}:${org.accountId}:thing/${id}`, id, type, region, status]
  );
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const arg = args[0] as string | { text?: string } | null;
    recorded.push({ text: typeof arg === 'string' ? arg : arg?.text ?? '' });
    return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
  await harness.listen((app) => {
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/aws', awsRoutes);
  });
});

beforeEach(() => {
  awsSend = jest.spyOn(SmithyClient.prototype, 'send').mockImplementation(() => Promise.reject(new Error('no AWS in this test')));
  discover = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  Client.prototype.query = originalClientQuery;
  await harness.close(async (orgIds) => {
    for (const table of [...HOME_REGION_FIXTURE_TABLES, 'resource_discovery_jobs']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

// ── G9 ──

describe('G9 GET /api/aws/accounts can_change_home_region (current membership)', () => {
  it('the owner: true', async () => {
    const org = await connectedOrg();
    const body = await (await accounts(org)).json();
    expect(body.can_change_home_region).toBe(true);
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s, with a token CLAIMING owner: false', async (role) => {
    const org = await connectedOrg();
    // sendAs's JWT role claim is 'owner' by default: only the membership can make this false.
    const body = await (await accounts(org, org[role])).json();
    expect(body.can_change_home_region).toBe(false);
  });

  it('a demoted owner (membership now member, token still says owner): false', async () => {
    const org = await connectedOrg();
    await pool.query(`UPDATE organization_memberships SET role = 'member' WHERE organization_id = $1 AND user_id = $2`, [org.orgId, org.owner]);
    expect((await (await accounts(org)).json()).can_change_home_region).toBe(false);
  });

  it("the owner of ANOTHER organization, a member here: false (the role of this organization's membership)", async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await harness.addMembership(b.orgId, a.owner, 'member');
    expect((await (await accounts(b, a.owner)).json()).can_change_home_region).toBe(false);
    expect((await (await accounts(a, a.owner)).json()).can_change_home_region).toBe(true);
  });

  it('always a boolean, also with no connection', async () => {
    const org = await harness.buildOrg();
    const body = await (await harness.sendAs(org.orgId, org.owner, 'GET', '/aws/accounts')).json();
    expect(body.connection).toEqual({ state: 'not_connected' });
    expect(body.can_change_home_region).toBe(true);
    const member = await (await harness.sendAs(org.orgId, org.member, 'GET', '/aws/accounts')).json();
    expect(member.can_change_home_region).toBe(false);
  });

  it('the field agrees with the server refusal: false ⇔ the PUT is refused 403 HOME_REGION_OWNER_ONLY', async () => {
    const org = await connectedOrg();
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const can = (await (await accounts(org, org[role])).json()).can_change_home_region;
      const res = await preview(org, 'us-west-2', org[role]);
      expect(res.status === 403).toBe(!can);
    }
  });
});

// ── The owner-only code ──

describe('owner-only refusal: the code on the three home-region routes only', () => {
  const REFUSED = { success: false, code: HOME_REGION_OWNER_ONLY_CODE, message: HOME_REGION_FORBIDDEN_MESSAGE };

  it.each(['admin', 'member', 'viewer'] as const)('%s, UI bypassed (token claims owner): PUT, GET preview and dismiss are refused server-side; nothing changes', async (role) => {
    const org = await connectedOrg();
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    const before = await stateOf(org);
    for (const res of [await put(org, { region: 'us-west-2' }, org[role]), await preview(org, 'us-west-2', org[role]), await dismiss(org, org[role])]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(REFUSED);
    }
    expect(await stateOf(org)).toEqual(before);
    expect(discover).not.toHaveBeenCalled();
  });

  it('every other owner-only route keeps its 403 body (no code): connect-init, connect, check-again', async () => {
    const org = await connectedOrg();
    const init = await harness.sendAs(org.orgId, org.member, 'GET', '/aws/accounts/connect-init');
    expect(init.status).toBe(403);
    expect(await init.json()).toEqual({ success: false, message: 'Only an organization owner can connect an AWS account' });
    const connect = await harness.sendAs(org.orgId, org.member, 'POST', '/aws/accounts', { roleArn: 'arn:aws:iam::123456789012:role/DevControlRole' });
    expect(connect.status).toBe(403);
    expect(await connect.json()).toEqual({ success: false, message: 'Only an organization owner can connect an AWS account' });
    const again = await harness.sendAs(org.orgId, org.member, 'POST', '/aws/accounts/check-again', {});
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ success: false, message: CHECK_AGAIN_FORBIDDEN_MESSAGE });
  });
});

// ── G2b ──

describe('G2b coverage account.previous_home_region_resources', () => {
  it.each([['off'], ['on']])('flag %s: never changed → absent', async (flag) => {
    const org = await connectedOrg();
    if (flag === 'on') await flagOn(org);
    await resource(org, 'us-east-1', 'ec2');
    expect('previous_home_region_resources' in (await coverage(org)).account).toBe(false);
  });

  it('flag off: the former home region\'s regional, not-terminated, non-S3 rows; equal to the dialog\'s resources_kept_in_old_region', async () => {
    const org = await connectedOrg();
    const other = await connectedOrg();
    await resource(org, 'us-east-1', 'ec2');
    await resource(org, 'us-east-1', 'rds', 'available');
    await resource(org, 'us-east-1', 'lambda', null);
    await resource(org, 'us-east-1', 's3'); // S3: account-wide, still checked: never counted
    await resource(org, 'us-east-1', 's3');
    await resource(org, 'us-east-1', 'ec2', 'terminated'); // terminated: never counted
    await resource(org, 'us-west-2', 'ec2'); // the new home: not the former one
    await resource(org, 'global', 'cloudfront');
    await resource(other, 'us-east-1', 'ec2'); // another organization's row in the same region
    const kept = (await (await preview(org, 'us-west-2')).json()).data.target.resources_kept_in_old_region;
    expect(kept).toBe(3);
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    const body = await coverage(org);
    expect(body.account).toMatchObject({ home_region: 'us-west-2', previous_home_region: 'us-east-1', previous_home_region_resources: kept });
    // Not the Services inventory count of the region: that one holds the 2 S3 buckets, and
    // (inventoryWhere: status <> 'terminated') leaves out the row with no status, which
    // HR-1's definition (status IS DISTINCT FROM 'terminated') counts. ec2 + rds + 2 S3 = 4.
    expect(body.regions.find((r: { region: string }) => r.region === 'us-east-1').count).toBe(4);
    expect(body.account.previous_home_region_resources).toBe(3);
  });

  it('flag on: present too, by the same definition', async () => {
    const org = await connectedOrg();
    await flagOn(org);
    await resource(org, 'us-east-1', 'ec2');
    await resource(org, 'us-east-1', 's3');
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    expect((await coverage(org)).account).toMatchObject({ previous_home_region: 'us-east-1', previous_home_region_resources: 1 });
  });

  it('read live, never cached from the change: a row terminated since leaves the count', async () => {
    const org = await connectedOrg();
    await resource(org, 'us-east-1', 'ec2');
    await resource(org, 'us-east-1', 'ec2');
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    expect((await coverage(org)).account.previous_home_region_resources).toBe(2);
    await pool.query(`UPDATE aws_resources SET status = 'terminated' WHERE id = (SELECT id FROM aws_resources WHERE organization_id = $1 AND region = 'us-east-1' LIMIT 1)`, [org.orgId]);
    expect((await coverage(org)).account.previous_home_region_resources).toBe(1);
  });

  it('no connection: the account carries exactly its three keys (no former-home key, no count)', async () => {
    const org = await harness.buildOrg();
    expect((await coverage(org)).account).toEqual({ connected: false, status: null, home_region: null });
  });

  it('zero is a real 0 (present with the former home region)', async () => {
    const org = await connectedOrg();
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    expect((await coverage(org)).account).toMatchObject({ previous_home_region: 'us-east-1', previous_home_region_resources: 0 });
  });

  it('a hand edit since the change (no former home reported): absent with it', async () => {
    const org = await connectedOrg();
    await resource(org, 'us-east-1', 'ec2');
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    await pool.query(`UPDATE aws_accounts SET region = 'eu-west-1' WHERE id = $1`, [org.rowId]);
    expect(Object.keys((await coverage(org)).account).sort()).toEqual(['connected', 'home_region', 'status']);
  });

  it('the GETs make no AWS call and write nothing', async () => {
    const org = await connectedOrg();
    await resource(org, 'us-east-1', 'ec2');
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    discover.mockClear();
    const before = await stateOf(org);
    const start = recorded.length;
    await coverage(org);
    await accounts(org);
    await accounts(org, org.member);
    // The API usage meter (middleware, on every authenticated request) is not the route's write.
    const writes = recorded.slice(start).map((r) => r.text)
      .filter((t) => /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(t))
      .filter((t) => !/^\s*INSERT INTO api_usage /.test(t));
    expect(writes).toEqual([]);
    expect(await stateOf(org)).toEqual(before);
    expect(awsSend).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('G2b tenancy', () => {
  it('explicit predicate: two organizations with the same former home region each get their own count', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await resource(a, 'us-east-1', 'ec2');
    for (let i = 0; i < 3; i++) await resource(b, 'us-east-1', 'ec2');
    expect((await put(a, { region: 'us-west-2' })).status).toBe(200);
    expect((await put(b, { region: 'us-west-2' })).status).toBe(200);
    expect((await coverage(a)).account.previous_home_region_resources).toBe(1);
    expect((await coverage(b)).account.previous_home_region_resources).toBe(3);
  });

  it('row-level security alone (devcontrol, the organization predicate stripped): only the tagged organization\'s rows', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await resource(a, 'us-east-1', 'ec2');
    for (let i = 0; i < 3; i++) await resource(b, 'us-east-1', 'ec2');
    const client = await pool.connect();
    const texts: string[] = [];
    // regionalResourcesIn itself, its organization predicate replaced by a no-op.
    const stripped = {
      query: (text: string, values: unknown[]) => {
        const t = text.split('organization_id = $1').join('$1::uuid IS NOT NULL');
        texts.push(t);
        return client.query(t, values);
      },
    } as unknown as Parameters<typeof regionalResourcesIn>[0];
    try {
      await client.query('BEGIN');
      await client.query('GRANT SELECT ON aws_resources TO devcontrol');
      await client.query('SET LOCAL ROLE devcontrol');
      const role = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [a.orgId]);
      expect(await regionalResourcesIn(stripped, b.orgId, 'us-east-1')).toBe(1);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b.orgId]);
      expect(await regionalResourcesIn(stripped, a.orgId, 'us-east-1')).toBe(3);
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      expect(await regionalResourcesIn(stripped, a.orgId, 'us-east-1')).toBe(0);
      expect(texts.every((t) => !/organization_id = \$1/.test(t))).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// ── docs §16: the example blocks are real answers ──

function docExamples(marker: string): Record<string, unknown> {
  const text = fs.readFileSync(DOC, 'utf8');
  const out: Record<string, unknown> = {};
  const pattern = new RegExp(`<!-- ${marker}: ([a-z_0-9]+) -->\\s*\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``, 'g');
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) out[m[1]] = JSON.parse(m[2]);
  return out;
}

describe('docs §16 (PR 3c): the example blocks are real answers', () => {
  it('the document has exactly these examples', () => {
    expect(Object.keys(docExamples('example-former-home')).sort()).toEqual(['changed']);
    expect(Object.keys(docExamples('example-accounts')).sort()).toEqual(['member', 'owner']);
    expect(Object.keys(docExamples('example-owner-only')).sort()).toEqual(['refused']);
  });

  it('former home: coverage.account after a change from us-east-1 to us-west-2 (2 EC2 + 1 S3 + 1 terminated left in us-east-1)', async () => {
    const org = await connectedOrg();
    await resource(org, 'us-east-1', 'ec2');
    await resource(org, 'us-east-1', 'ec2');
    await resource(org, 'us-east-1', 's3');
    await resource(org, 'us-east-1', 'ec2', 'terminated');
    // The change as HR-1 records it: the region, and its audit event at a fixed time.
    await pool.query(`UPDATE aws_accounts SET region = 'us-west-2' WHERE id = $1`, [org.rowId]);
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, changes, metadata, created_at)
       VALUES ($1, $2, 'aws_account.home_region_changed', 'aws_account', $3, '{"from":"us-east-1","to":"us-west-2"}', '{}', '2026-11-16T09:02:00Z')`,
      [org.orgId, org.owner, org.rowId]
    );
    expect((await coverage(org)).account).toEqual(docExamples('example-former-home').changed);
  });

  it('accounts: the owner and a member', async () => {
    const org = await connectedOrg();
    const pick = (b: any) => ({ can_change_home_region: b.can_change_home_region });
    expect(pick(await (await accounts(org)).json())).toEqual(docExamples('example-accounts').owner);
    expect(pick(await (await accounts(org, org.member)).json())).toEqual(docExamples('example-accounts').member);
  });

  it('owner-only refusal body', async () => {
    const org = await connectedOrg();
    expect(await (await put(org, { region: 'us-west-2' }, org.member)).json()).toEqual(docExamples('example-owner-only').refused);
  });
});
