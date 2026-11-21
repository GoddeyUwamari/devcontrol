/**
 * PR1 (empty states): with no connected AWS account, a scan or a cost analysis is
 * refused and NOTHING is recorded.
 *
 * "No connected account" is no eligible aws_accounts row (status 'active'): no row
 * at all, or rows whose status is anything else (NULL, 'disconnected'). Every one
 * of these is refused the same way, at every entry point:
 *
 *   - POST /api/services/discover (Scan now on Services, Infrastructure, Security):
 *     409 { success:false, code:'NOT_CONNECTED', error:'Connect an AWS account before starting a scan.' }
 *   - POST /api/aws-resources/discover (legacy): the same 409, and no scan is started;
 *   - POST /api/cost-recommendations/analyze:
 *     409 { success:false, code:'NOT_CONNECTED', error:'Connect an AWS account before running cost analysis.' }
 *   - discoverAllResources() itself (connect, home region change) and discoverOrJoin():
 *     AwsAccountNotConnectedError, before any AssumeRole;
 *   - the 6-hourly cron: skipped / inactive, as before.
 *
 * "Nothing recorded" is proven by counting this organization's rows in every table
 * a scan or an analysis can write before it knows whether an account exists
 * (pr1-build.md §2), before and after each request.
 *
 * Unchanged, and proven here through the real path: a connected account whose role
 * AWS refuses (AssumeRole AccessDenied) still records its failed scan (one failed
 * resource_discovery_jobs row under the scan lease, and the connection's health) and
 * its failed cost analysis run, with today's answers; a connected account's scan and
 * analysis still run and record as before.
 *
 * Real routes and real Postgres; only token verification and AWS are stubbed.
 * Placeholders only.
 */
import servicesRoutes from '../services.routes';
import awsResourcesRoutes from '../awsResources.routes';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { AWSClientFactory, AwsAssumeRoleFailedError } from '../../services/aws-client-factory.service';
import * as platformSts from '../../services/platform-sts';
import { ScanContext } from '../../services/scan-context';
import { ResourceDiscoveryJob } from '../../jobs/resourceDiscovery.job';
import costOptimizationService from '../../services/cost-optimization.service';
import { AwsAccountNotConnectedError } from '../../repositories/aws-accounts.repository';
import { AWS_NOT_CONNECTED_CODE } from '../../services/aws-connection-messages';
import { DISCOVERY_FAILED_MESSAGE } from '../../services/discovery-job-messages';
import { connectPlaceholderAccount, isGetIndex, ACTIVE_INDEX, removePlaceholderAccounts, stubScanSource } from '../../services/__tests__/helpers/scan-source';

const harness = createRoleGateHarness('pr1-no-account');
const { pool } = harness;

const PLACEHOLDER_ROLE_ARN = 'arn:aws:iam::123456789012:role/devcontrol-readonly';

/** Every table a scan or an analysis can write for an organization (pr1-build.md §2), plus audit_logs. */
const COUNTED_TABLES = [
  'resource_discovery_jobs',
  'aws_scan_leases',
  'job_leases',
  'cost_analysis_runs',
  'aws_connection_checks',
  'aws_resources',
  'cost_recommendations',
  'analytics_events',
  'audit_logs',
] as const;

type Counts = Record<(typeof COUNTED_TABLES)[number], number>;

async function counts(orgId: string): Promise<Counts> {
  const result = {} as Counts;
  for (const table of COUNTED_TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [orgId]);
    result[table] = rows[0].n;
  }
  return result;
}

const NOTHING: Counts = Object.fromEntries(COUNTED_TABLES.map((table) => [table, 0])) as Counts;

const SCAN_REFUSAL = { success: false, code: 'NOT_CONNECTED', error: 'Connect an AWS account before starting a scan.' };
const COST_REFUSAL = { success: false, code: 'NOT_CONNECTED', error: 'Connect an AWS account before running cost analysis.' };

let seq = 0;

/** An aws_accounts row that is NOT eligible (status NULL or 'disconnected'). */
async function insertIneligibleAccount(orgId: string, status: string | null): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', NOW(), $4)`,
    [orgId, PLACEHOLDER_ROLE_ARN, `pr1-${seq}-${orgId}`.slice(0, 32), status]
  );
}

type AccountState = 'no aws_accounts row' | 'a row with status NULL' | "a row with status 'disconnected'";
const NO_ACCOUNT_STATES: AccountState[] = ['no aws_accounts row', 'a row with status NULL', "a row with status 'disconnected'"];

/** A free-tier organization (EC2, EBS, RDS, S3 only) with one member per role, in `state`. */
async function orgIn(state: AccountState | 'connected'): Promise<RoleGateOrg> {
  const org = await harness.buildOrg();
  await pool.query(`UPDATE organizations SET subscription_tier = 'free' WHERE id = $1`, [org.orgId]);
  if (state === 'connected') await connectPlaceholderAccount(pool, org.orgId);
  if (state === 'a row with status NULL') await insertIneligibleAccount(org.orgId, null);
  if (state === "a row with status 'disconnected'") await insertIneligibleAccount(org.orgId, 'disconnected');
  return org;
}

async function post(org: RoleGateOrg, route: string) {
  const res = await harness.sendAs(org.orgId, org.owner, 'POST', route);
  return { status: res.status, body: await res.json() };
}

/** AWS refusing the AssumeRole into the customer's role: the real AwsAssumeRoleFailedError path. */
function refuseAssumeRole() {
  const refused = Object.assign(new Error('User is not authorized to perform: sts:AssumeRole'), {
    name: 'AccessDenied',
    $metadata: { httpStatusCode: 403 },
  });
  return jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockRejectedValue(refused);
}

/** A fake client answering by command name. */
function fake(answers: Record<string, () => unknown>) {
  return {
    send: jest.fn(async (command: { constructor: { name: string } }) => {
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer();
    }),
  };
}

/** A connected account's AWS: empty free-tier inventory; the cost step stubbed. */
function connectedAws() {
  stubScanSource();
  const resourceExplorer = {
    send: jest.fn(async (command: unknown) => (isGetIndex(command) ? ACTIVE_INDEX : { Resources: [], Count: { TotalResources: 0, Complete: true } })),
  };
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: 'us-east-1', accountId: '123456789012',
    costExplorer: {},
    ec2: fake({
      DescribeInstancesCommand: () => ({ Reservations: [] }),
      DescribeVolumesCommand: () => ({ Volumes: [] }),
      DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    }),
    rds: fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [] }) }),
    s3: fake({ ListBucketsCommand: () => ({ Buckets: [] }) }),
    iam: fake({ ListUsersCommand: () => ({ Users: [] }) }),
    s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, backup: {}, resourceExplorer,
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations: [{ issue: 'ec2_idle_instance', success: true, recommendations: [] }],
    riRecommendations: [],
    riSucceeded: true,
    homeRegion: 'us-east-1',
  } as any);
}

async function discoveryJobs(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY created_at`,
    [orgId]
  );
  return rows;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services', servicesRoutes);
    app.use('/api/aws-resources', awsResourcesRoutes);
    app.use('/api/cost-recommendations', costRecommendationsRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'framework_evaluation_runs',
      ...COUNTED_TABLES.filter((table) => table !== 'analytics_events' && table !== 'audit_logs'),
      'aws_account_regions',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, orgIds);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
}, 30_000);

it('the refusal code is the existing NOT_CONNECTED constant', () => {
  expect(AWS_NOT_CONNECTED_CODE).toBe('NOT_CONNECTED');
});

// ---------------------------------------------------------------------------
describe.each(NO_ACCOUNT_STATES)('no connected AWS account (%s): refused, nothing recorded', (state) => {
  it('POST /api/services/discover: 409 NOT_CONNECTED with the scan text; no AssumeRole; no row in any table', async () => {
    const org = await orgIn(state);
    const forOrg = jest.spyOn(ScanContext, 'forOrg');
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const before = await counts(org.orgId);
    expect(before).toEqual(NOTHING);

    const { status, body } = await post(org, '/services/discover');

    // The rows first: a missing guard shows as a row written, not only as a call made.
    expect(await counts(org.orgId)).toEqual(before);
    expect(status).toBe(409);
    expect(body).toEqual(SCAN_REFUSAL);
    expect(forOrg).not.toHaveBeenCalled();
    expect(createClients).not.toHaveBeenCalled();
  });

  it('POST /api/aws-resources/discover (legacy): the same 409, no scan started, no row in any table', async () => {
    const org = await orgIn(state);
    const discoverAll = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources');
    const before = await counts(org.orgId);

    const { status, body } = await post(org, '/aws-resources/discover');

    // The rows first: a missing guard shows as a row written, not only as a call made.
    expect(await counts(org.orgId)).toEqual(before);
    expect(status).toBe(409);
    expect(body).toEqual(SCAN_REFUSAL);
    expect(discoverAll).not.toHaveBeenCalled();
  });

  it('POST /api/cost-recommendations/analyze: 409 NOT_CONNECTED with the cost text; no analysis; no row in any table', async () => {
    const org = await orgIn(state);
    const analyze = jest.spyOn(costOptimizationService, 'analyzeAllResources');
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const before = await counts(org.orgId);

    const { status, body } = await post(org, '/cost-recommendations/analyze');

    // The rows first: a missing guard shows as a row written, not only as a call made.
    expect(await counts(org.orgId)).toEqual(before);
    expect(status).toBe(409);
    expect(body).toEqual(COST_REFUSAL);
    expect(analyze).not.toHaveBeenCalled();
    expect(createClients).not.toHaveBeenCalled();
  });

  it('discoverAllResources() (connect, home region change) and discoverOrJoin(): AwsAccountNotConnectedError before any AssumeRole; no row', async () => {
    const org = await orgIn(state);
    const forOrg = jest.spyOn(ScanContext, 'forOrg');
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const service = new AWSResourceDiscoveryService(pool);
    const before = await counts(org.orgId);

    const first = await service.discoverAllResources(org.orgId).catch((error: unknown) => error);
    const joined = await service.discoverOrJoin(org.orgId).catch((error: unknown) => error);

    // The rows first: a missing guard shows as a row written, not only as a call made.
    expect(await counts(org.orgId)).toEqual(before);
    expect(first).toBeInstanceOf(AwsAccountNotConnectedError);
    expect(joined).toBeInstanceOf(AwsAccountNotConnectedError);
    expect(forOrg).not.toHaveBeenCalled();
    expect(createClients).not.toHaveBeenCalled();
  });

  it('the scheduled job: not scanned, as before (skipped or inactive); no row', async () => {
    const org = await orgIn(state);
    const discoverAll = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources');
    const before = await counts(org.orgId);

    const summary = await new ResourceDiscoveryJob(pool).scanOrganizations([{ id: org.orgId, name: 'PR1 org' }]);

    expect(summary).toMatchObject(state === 'no aws_accounts row' ? { skipped: 1, inactive: 0 } : { skipped: 0, inactive: 1 });
    expect(summary).toMatchObject({ scanned: 0, failed: 0, locked: 0, platformFailed: 0 });
    expect(discoverAll).not.toHaveBeenCalled();
    expect(await counts(org.orgId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
describe('the account goes between the guard and the scan (decision 4)', () => {
  it('ScanContext.forOrg finds no eligible account: AwsAccountNotConnectedError, no failed job row, no lease, no row in any table', async () => {
    const org = await orgIn('connected');
    const realForOrg = ScanContext.forOrg.bind(ScanContext);
    // The guard has passed (the row was active); the row stops being eligible before
    // the scan's account context reads it, then the real forOrg runs.
    const forOrg = jest.spyOn(ScanContext, 'forOrg').mockImplementation(async (organizationId: string) => {
      await pool.query(`UPDATE aws_accounts SET status = 'disconnected' WHERE org_id = $1`, [organizationId]);
      return realForOrg(organizationId);
    });
    const before = await counts(org.orgId);

    await expect(new AWSResourceDiscoveryService(pool).discoverAllResources(org.orgId)).rejects.toBeInstanceOf(AwsAccountNotConnectedError);

    expect(forOrg).toHaveBeenCalledTimes(1);
    expect(await counts(org.orgId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
describe('a connected account: unchanged', () => {
  it('its role refused (AssumeRole AccessDenied): Scan now still records ONE failed job under the scan lease and the connection health, with today\'s answer', async () => {
    const org = await orgIn('connected');
    const assume = refuseAssumeRole();
    const before = await counts(org.orgId);

    const { status, body } = await post(org, '/services/discover');

    expect(assume).toHaveBeenCalled();
    // Today's answer for a role failure (ruling 8: unchanged, follow-up), not the PR1 refusal.
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'aws_not_connected', message: 'Please connect your AWS account in Settings to run audits.' });
    expect(await discoveryJobs(org.orgId)).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE }]);
    const { rows: leases } = await pool.query(`SELECT released_at FROM aws_scan_leases WHERE organization_id = $1`, [org.orgId]);
    expect(leases).toHaveLength(1);
    expect(leases[0].released_at).toBeInstanceOf(Date);
    const { rows: checks } = await pool.query(`SELECT last_attempt_result FROM aws_connection_checks WHERE organization_id = $1`, [org.orgId]);
    expect(checks).toEqual([{ last_attempt_result: 'role_refused' }]);
    expect(await counts(org.orgId)).toEqual({ ...before, resource_discovery_jobs: 1, aws_scan_leases: 1, aws_connection_checks: 1 });
  });

  it('its role refused: discoverAllResources() rejects with the AssumeRole failure (not the PR1 refusal) and records the failed job', async () => {
    const org = await orgIn('connected');
    refuseAssumeRole();

    const failure = await new AWSResourceDiscoveryService(pool).discoverAllResources(org.orgId).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AwsAssumeRoleFailedError);
    expect(failure).not.toBeInstanceOf(AwsAccountNotConnectedError);
    expect(await discoveryJobs(org.orgId)).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE }]);
  });

  it('its role refused: Analyze still records its failed run, with today\'s 400 answer', async () => {
    const org = await orgIn('connected');
    const assume = refuseAssumeRole();

    const { status, body } = await post(org, '/cost-recommendations/analyze');

    expect(assume).toHaveBeenCalled();
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: 'No AWS account connected for this organization. Connect one to run cost analysis.' });
    const { rows: runs } = await pool.query(`SELECT status, error_message FROM cost_analysis_runs WHERE organization_id = $1`, [org.orgId]);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error_message).toContain('AWS_NOT_CONNECTED');
  });

  it('Scan now runs and records its completed job, as before', async () => {
    const org = await orgIn('connected');
    connectedAws();

    const { status, body } = await post(org, '/services/discover');

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, discovered: 0, updated: 0 });
    expect(await discoveryJobs(org.orgId)).toEqual([{ status: 'completed', error_message: null }]);
  });

  it('Analyze runs and records its completed run, as before', async () => {
    const org = await orgIn('connected');
    connectedAws();

    const { status, body } = await post(org, '/cost-recommendations/analyze');

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { recommendationsFound: 0, runState: 'completed' } });
    const { rows: runs } = await pool.query(`SELECT status FROM cost_analysis_runs WHERE organization_id = $1`, [org.orgId]);
    expect(runs).toEqual([{ status: 'completed' }]);
  });

  it('the legacy discover still starts the scan and answers "started"', async () => {
    const org = await orgIn('connected');
    const discoverAll = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
      job_id: 'placeholder', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
    });

    const { status, body } = await post(org, '/aws-resources/discover');

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, message: 'Resource discovery started' });
    expect(discoverAll).toHaveBeenCalledWith(org.orgId);
  });
});
