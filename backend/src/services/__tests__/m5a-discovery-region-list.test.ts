/**
 * Multi-region plan M5a (m5-plan.md §2-3, §7) inside a discovery scan: the one
 * DescribeRegions call per scan, under the scan lease, its fenced write to
 * aws_account_regions, and the fail-soft rule -- a denied, timed-out, failed or
 * invalid region list leaves the scan exactly as it is without M5a (job row,
 * result, other AWS calls, reconcile), keeps the last stored list, and writes
 * nothing. A lost lease still stops the scan.
 *
 * Real Postgres for every lease, job, inventory and region row; AWS clients are
 * fakes (no AWS call is made). Fixture: a real DescribeRegions response, region
 * fields only; variants DERIVED from it are labelled. Placeholders only.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { HeldLease, acquireScanLease, isLeaseLost } from '../scan-lease';
import { DISCOVERY_LEASE_LOST_MESSAGE, LeaseTiming, SCAN_KIND_DISCOVERY, onTaggedConnection } from '../scan-session';
import { AwsCallTimeoutError } from '../../utils/awsCallPolicy';
import * as foundation from '../../repositories/multi-region-foundation.repository';
import { PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

const dbConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(dbConfig());
const pool2 = new Pool(dbConfig());
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-east-1';
const INSTANCE_ARN = `arn:aws:ec2:${HOME}:*:instance/i-1234567890abcdef0`;
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };
const createdOrgIds: string[] = [];

interface FixtureRegion {
  RegionName: string;
  OptInStatus: string;
}
const FIXTURE: { Regions: FixtureRegion[] } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/describe-regions.json'), 'utf8'));
const realResponse = () => ({ Regions: FIXTURE.Regions.map((r) => ({ ...r })) });
/** DERIVED from the real response: `region`'s OptInStatus replaced by `status`. */
function derivedResponse(region: string, status: string) {
  const response = realResponse();
  response.Regions.find((r) => r.RegionName === region)!.OptInStatus = status;
  return response;
}
const OPT_IN_REGION = 'eu-south-1';
const ENABLED_IN_FIXTURE = FIXTURE.Regions.filter((r) => r.OptInStatus === 'opt-in-not-required').length;

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'active') RETURNING id`,
    [`M5a Region Org ${suffix}`, `m5a-region-org-${suffix}`, `M5a Region Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function service(timing: LeaseTiming = FAST): AWSResourceDiscoveryService {
  const s = new AWSResourceDiscoveryService(pool);
  (s as any).leaseTiming = timing;
  return s;
}

/** A fake client answering by command name; anything unlisted fails at once. Records every command and its input. */
function fake(answers: Record<string, (input: any) => any>) {
  const calls: Array<{ name: string; input: any }> = [];
  return {
    calls,
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      calls.push({ name: command.constructor.name, input: command.input });
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer(command.input ?? {});
    }),
  };
}

function explorer(): ResourceExplorer2Client {
  const client = new ResourceExplorer2Client({ region: HOME });
  (client as any).send = jest.fn(async () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }));
  return client;
}

/** The free tier's clients; `describeRegions` answers (or throws for) DescribeRegionsCommand, absent = not answered. */
function mockAwsClients(describeRegions?: (input: any) => any) {
  stubScanSource();
  const ec2 = fake({
    DescribeInstancesCommand: () => ({ Reservations: [] }),
    DescribeVolumesCommand: () => ({ Volumes: [] }),
    DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    ...(describeRegions ? { DescribeRegionsCommand: describeRegions } : {}),
  });
  const rds = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [] }) });
  const s3 = fake({ ListBucketsCommand: () => ({ Buckets: [] }) });
  const iam = fake({ ListUsersCommand: () => ({ Users: [] }) });
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: HOME, accountId: ACCOUNT,
    costExplorer: {}, ec2, rds, s3, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam, backup: {},
    resourceExplorer: explorer(),
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false, homeRegion: HOME });
  return { ec2, rds, s3, iam };
}

async function seedInstance(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
     VALUES ($1, $2, 'i-1234567890abcdef0', 'i-1234567890abcdef0', 'ec2', $3, 'running', 0)`,
    [orgId, INSTANCE_ARN, HOME]
  );
}

async function regionRows(orgId: string): Promise<Record<string, any>> {
  const { rows } = await pool.query(`SELECT * FROM aws_account_regions WHERE organization_id = $1 ORDER BY region`, [orgId]);
  return Object.fromEntries(rows.map((row) => [row.region, row]));
}

/** Everything a scan leaves behind that M5a must not change, without ids and times. */
async function scanFootprint(orgId: string, result: any) {
  const job = (
    await pool.query(
      `SELECT status, error_message, to_jsonb(j) -> 'warnings' AS warnings, resources_discovered, resources_updated, resources_deleted,
              compliance_scan_completed, cost_analysis_completed, resource_types, regions, completed_at IS NOT NULL AS completed
         FROM resource_discovery_jobs j WHERE organization_id = $1`,
      [orgId]
    )
  ).rows;
  const resources = (
    await pool.query(`SELECT resource_arn, status, missing_scan_count FROM aws_resources WHERE organization_id = $1 ORDER BY resource_arn`, [orgId])
  ).rows;
  const lease = (await pool.query(`SELECT scan_kind, aws_account_id, released_at IS NOT NULL AS released FROM aws_scan_leases WHERE organization_id = $1`, [orgId]))
    .rows;
  return {
    job,
    resources,
    lease,
    result: { ...result, job_id: undefined },
  };
}

const warnLines = () => (console.warn as jest.Mock).mock.calls.map((args) => args.map(String).join(' '));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'cost_recommendations', 'cost_analysis_runs',
      'framework_evaluation_runs', 'aws_resources', 'resource_discovery_jobs', 'aws_scan_leases', 'job_leases', 'aws_account_regions',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
  await pool2.end();
}, 30_000);

// ---------------------------------------------------------------------------
describe('a scan records the region list', () => {
  it('D6 one DescribeRegions call (AllRegions) on the home EC2 client; every region recorded for the lease\'s account; the job lists the home region', async () => {
    const orgId = await insertOrg();
    const { ec2, rds, s3, iam } = mockAwsClients(() => realResponse());

    const result = await service().discoverAllResources(orgId);

    const describeCalls = ec2.calls.filter((c) => c.name === 'DescribeRegionsCommand');
    expect(describeCalls).toEqual([{ name: 'DescribeRegionsCommand', input: { AllRegions: true } }]);
    for (const other of [rds, s3, iam]) expect(other.calls.map((c) => c.name)).not.toContain('DescribeRegionsCommand');

    const rows = await regionRows(orgId);
    expect(Object.keys(rows).sort()).toEqual(FIXTURE.Regions.map((r) => r.RegionName).sort());
    expect(Object.values(rows).filter((r) => r.enabled)).toHaveLength(ENABLED_IN_FIXTURE);
    for (const row of Object.values(rows)) expect(row).toMatchObject({ aws_account_id: ACCOUNT, last_scan_status: 'never_scanned' });

    const job = (await pool.query(`SELECT status, regions FROM resource_discovery_jobs WHERE id = $1`, [result.job_id])).rows[0];
    expect(job).toEqual({ status: 'completed', regions: [HOME] });
  });

  it('names AWS supplied are never logged: dropped names are logged as a count only (no names, no control characters); the rest is recorded', async () => {
    const orgId = await insertOrg();
    const NAME_33 = `us-${'a'.repeat(28)}-1`;
    const dropped = ['us-east-1\u001b[2J\r\nFAKE LOG LINE', NAME_33, 'global'];
    mockAwsClients(() => {
      const response: { Regions: FixtureRegion[] } = realResponse();
      for (const name of dropped) response.Regions.push({ RegionName: name, OptInStatus: 'opt-in-not-required' });
      return response;
    });

    await service().discoverAllResources(orgId);

    expect(Object.keys(await regionRows(orgId)).sort()).toEqual(FIXTURE.Regions.map((r) => r.RegionName).sort());
    const lines = warnLines().filter((line) => line.includes('region_list_'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('region_list_names_dropped');
    expect(lines[0]).toContain('3 region name(s) not recorded');
    expect(lines[0]).not.toMatch(/[\u0000-\u001f\u007f]/);
    for (const name of [...dropped, 'FAKE LOG LINE', ...FIXTURE.Regions.map((r) => r.RegionName)]) expect(lines[0]).not.toContain(name);
  });

  it('D5 derived: the next scan records the changed list (a region opted into, then out again)', async () => {
    const orgId = await insertOrg();
    mockAwsClients(() => derivedResponse(OPT_IN_REGION, 'opted-in')); // derived
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[OPT_IN_REGION]).toMatchObject({ enabled: true, disabled_at: null });

    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAwsClients(() => realResponse());
    await service().discoverAllResources(orgId);
    const row = (await regionRows(orgId))[OPT_IN_REGION];
    expect(row).toMatchObject({ enabled: false, opt_in_status: 'not-opted-in' });
    expect(row.disabled_at).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
describe('fail-soft: without a region list the scan is exactly as without M5a', () => {
  const throwing = (error: Error) => () => {
    throw error;
  };
  const DENIED_TEXT = `User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized to perform: ec2:DescribeRegions`;
  const variants: Array<[string, ((input: any) => any) | undefined, string]> = [
    ['denied (UnauthorizedOperation)', throwing(Object.assign(new Error(DENIED_TEXT), { name: 'UnauthorizedOperation' })), 'region_list_denied'],
    ['denied (HTTP 403)', throwing(Object.assign(new Error(DENIED_TEXT), { name: 'Forbidden', $metadata: { httpStatusCode: 403 } })), 'region_list_denied'],
    ['timed out', throwing(new AwsCallTimeoutError(15_000)), 'region_list_timed_out'],
    ['failed (any other error)', throwing(Object.assign(new Error(DENIED_TEXT), { name: 'InternalError' })), 'region_list_failed'],
    ['invalid (empty list)', () => ({ Regions: [] }), 'region_list_invalid'],
    ['invalid (derived: home region not enabled)', () => derivedResponse(HOME, 'not-opted-in'), 'region_list_invalid'],
    ['not answered by the client at all', undefined, 'region_list_failed'],
  ];

  async function baseline() {
    const orgId = await insertOrg();
    await seedInstance(orgId);
    const { ec2 } = mockAwsClients(() => realResponse());
    const result = await service().discoverAllResources(orgId);
    return { footprint: await scanFootprint(orgId, result), otherCalls: ec2.calls.filter((c) => c.name !== 'DescribeRegionsCommand') };
  }

  it.each(variants)('D1/D2 %s: same job row, result, AWS calls and reconcile; nothing written; logged only', async (_label, answer, logCode) => {
    const expected = await baseline();
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const orgId = await insertOrg();
    await seedInstance(orgId);
    const { ec2 } = mockAwsClients(answer);
    const result = await service().discoverAllResources(orgId);

    expect(await scanFootprint(orgId, result)).toEqual(expected.footprint);
    expect(ec2.calls.filter((c) => c.name !== 'DescribeRegionsCommand')).toEqual(expected.otherCalls);
    expect(ec2.calls.filter((c) => c.name === 'DescribeRegionsCommand')).toHaveLength(1);
    expect(await regionRows(orgId)).toEqual({});
    expect(result.warnings).toEqual([]);
    const lines = warnLines().filter((line) => line.includes('region_list_'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(logCode);
    expect(lines[0]).not.toContain('arn:');
    expect(lines[0]).not.toContain(ACCOUNT);
  });

  it('a write that fails for a reason other than a lost lease: logged once (no ARN, no account id), nothing written, the scan identical', async () => {
    const expected = await baseline();
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const orgId = await insertOrg();
    await seedInstance(orgId);
    const { ec2 } = mockAwsClients(() => realResponse());
    // The real write, made to fail inside its fenced transaction after the fence has
    // passed: the home region twice in one INSERT ... ON CONFLICT is a Postgres
    // cardinality violation, so the transaction rolls back. No lease is involved.
    const realRecord = foundation.recordRegionList;
    const write = jest.spyOn(foundation, 'recordRegionList').mockImplementation((client, lease, regions) =>
      realRecord(client, lease, [...regions, regions.find((r) => r.region === HOME)!])
    );
    const result = await service().discoverAllResources(orgId);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await scanFootprint(orgId, result)).toEqual(expected.footprint);
    expect(ec2.calls.filter((c) => c.name !== 'DescribeRegionsCommand')).toEqual(expected.otherCalls);
    expect(await regionRows(orgId)).toEqual({});
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const lines = warnLines().filter((line) => line.includes('region_list_'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('region_list_write_failed');
    expect(lines[0]).not.toContain('arn:');
    expect(lines[0]).not.toContain(ACCOUNT);
  });

  it('D1 a denied list keeps the list stored by an earlier scan, unchanged', async () => {
    const orgId = await insertOrg();
    mockAwsClients(() => realResponse());
    await service().discoverAllResources(orgId);
    const stored = await regionRows(orgId);
    expect(Object.keys(stored)).toHaveLength(FIXTURE.Regions.length);

    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockAwsClients(() => {
      throw Object.assign(new Error('denied'), { name: 'UnauthorizedOperation' });
    });
    const result = await service().discoverAllResources(orgId);
    expect(result.errors).toEqual([]);
    expect(await regionRows(orgId)).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
describe('the lease', () => {
  it('F1 a lease lost while the list is read: nothing is written, the scan stops with the lease-lost job text, not a region_list log', async () => {
    const orgId = await insertOrg();
    let other: HeldLease | null = null;
    // The scan's lease is not renewed (long heartbeat interval) and lives 2 s; inside the
    // DescribeRegions call it expires by the database clock and another worker takes it.
    mockAwsClients(async () => {
      const deadline = Date.now() + 15_000;
      while ((await pool.query(`SELECT expires_at <= clock_timestamp() AS e FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows[0].e !== true) {
        if (Date.now() > deadline) throw new Error('the lease did not expire');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      other = await onTaggedConnection(pool2, orgId, (db) =>
        acquireScanLease(db, { organizationId: orgId, awsAccountId: ACCOUNT, scanKind: SCAN_KIND_DISCOVERY }, 'other-worker')
      );
      return realResponse();
    });

    const error = await service({ ...FAST, ttlSeconds: 2, heartbeat: { intervalMs: 60_000 } })
      .discoverAllResources(orgId)
      .catch((err) => err);

    expect(other).not.toBeNull();
    expect(isLeaseLost(error)).toBe(true);
    expect(await regionRows(orgId)).toEqual({});
    const job = (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(job).toEqual([{ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE }]);
    expect(warnLines().filter((line) => line.includes('region_list_'))).toEqual([]);
  }, 30_000);
});
