/**
 * PR4a (empty states): GET /api/forecast with no connected AWS account.
 *
 * "No connected account" is no eligible aws_accounts row (status 'active'): no row
 * at all, or rows whose status is anything else (NULL, 'disconnected'). The forecast
 * path (cost-forecast.service -> awsCostService.fetchCostTrend -> requireEligibleAwsAccount)
 * throws AwsAccountNotConnectedError, which is now answered as PR1 answers scan and
 * cost analysis:
 *
 *   409 { success:false, code:'NOT_CONNECTED', error:'Connect an AWS account before generating a forecast.' }
 *
 * with no AWS call and nothing logged as an error.
 *
 * Matched by class (isAwsAccountNotConnected), never by text: a connected account's
 * own failures keep today's 500, including the plain Error whose message starts with
 * the same AWS_NOT_CONNECTED prefix (aws-cost.service customerCostExplorer()).
 *
 * Unchanged: AssumeRole refused, Cost Explorer refused, more than one eligible
 * account (500 'Failed to generate forecast'); fewer than 7 finished days (422);
 * success (200); the plan gate (402 for a free organization, account or not: the
 * page never asks then).
 *
 * Real routes and real Postgres; only token verification, STS, Cost Explorer and the
 * model call are stubbed. Placeholders only.
 */
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { createForecastRoutes } from '../forecast.routes';
import { pool as appPool } from '../../config/database';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import * as platformSts from '../../services/platform-sts';
import { AWSCostService } from '../../services/aws-cost.service';
import { ForecastAIService } from '../../services/forecast-ai.service';
import { CostForecastService } from '../../services/cost-forecast.service';
import * as accountsRepository from '../../repositories/aws-accounts.repository';
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository';
import { connectPlaceholderAccount, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';

const harness = createRoleGateHarness('pr4a-forecast');
const { pool } = harness;

const PLACEHOLDER_ROLE_ARN = 'arn:aws:iam::123456789012:role/devcontrol-readonly';
const NOT_CONNECTED = { success: false, code: 'NOT_CONNECTED', error: 'Connect an AWS account before generating a forecast.' };
const FAILED = { success: false, error: 'Failed to generate forecast' };

let seq = 0;

/** An aws_accounts row that is NOT eligible (status NULL or 'disconnected'). */
async function insertIneligibleAccount(orgId: string, status: string | null): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', NOW(), $4)`,
    [orgId, PLACEHOLDER_ROLE_ARN, `pr4a-${seq}-${orgId}`.slice(0, 32), status]
  );
}

type AccountState = 'no aws_accounts row' | 'a row with status NULL' | "a row with status 'disconnected'";
const NO_ACCOUNT_STATES: AccountState[] = ['no aws_accounts row', 'a row with status NULL', "a row with status 'disconnected'"];

async function orgIn(tier: 'free' | 'pro', state: AccountState | 'connected'): Promise<RoleGateOrg> {
  const org = await harness.buildOrg();
  await pool.query(
    `UPDATE organizations SET subscription_tier = $1, billing_lifecycle_state = 'healthy', grace_period_ends_at = NULL WHERE id = $2`,
    [tier, org.orgId]
  );
  if (state === 'connected') await connectPlaceholderAccount(pool, org.orgId);
  if (state === 'a row with status NULL') await insertIneligibleAccount(org.orgId, null);
  if (state === "a row with status 'disconnected'") await insertIneligibleAccount(org.orgId, 'disconnected');
  return org;
}

async function getForecast(org: RoleGateOrg) {
  const res = await harness.sendAs(org.orgId, org.owner, 'GET', '/forecast');
  return { status: res.status, body: await res.json() };
}

/** Every AWS call the forecast can make, watched; each refuses unless a test says otherwise. */
function watchAws() {
  return {
    assumeRole: jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockRejectedValue(
      Object.assign(new Error('unexpected AssumeRole'), { name: 'Unexpected' })
    ),
    costExplorer: jest.spyOn(CostExplorerClient.prototype, 'send').mockRejectedValue(
      Object.assign(new Error('unexpected Cost Explorer call'), { name: 'Unexpected' }) as never
    ),
    createForOrg: jest.spyOn(AWSCostService, 'createForOrg'),
  };
}

/** STS grants the customer's role (placeholder credentials). */
function grantAssumeRole(aws: ReturnType<typeof watchAws>) {
  aws.assumeRole.mockResolvedValue({
    Credentials: { AccessKeyId: 'AKIAPLACEHOLDER', SecretAccessKey: 'placeholder', SessionToken: 'placeholder', Expiration: new Date() },
  } as never);
}

/** `days` finished UTC days ending three days ago, each `amount`. */
function finishedTrend(days: number, amount = 5) {
  const end = Date.now() - 3 * 86_400_000;
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    total: amount,
    reportState: 'final',
  }));
}

/** Forecast Controller lines logged with console.error. */
const controllerErrors = () =>
  (console.error as jest.Mock).mock.calls.filter((call) => String(call[0]).startsWith('[Forecast Controller]'));

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    // The same factory, mounted at the same path, as server.ts.
    app.use('/api/forecast', createForecastRoutes(appPool));
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(ForecastAIService.prototype, 'analyzeForecast').mockImplementation(async (f) => f);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await removePlaceholderAccounts(pool, orgIds);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
}, 30_000);

describe('GET /api/forecast with no connected AWS account (Pro)', () => {
  it.each(NO_ACCOUNT_STATES)('%s: 409 NOT_CONNECTED, no AWS call, nothing logged as an error', async (state) => {
    const org = await orgIn('pro', state);
    const aws = watchAws();

    const res = await getForecast(org);

    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_CONNECTED);
    expect(aws.createForOrg).not.toHaveBeenCalled();
    expect(aws.assumeRole).not.toHaveBeenCalled();
    expect(aws.costExplorer).not.toHaveBeenCalled();
    expect(controllerErrors()).toEqual([]);
  });
});

describe('a connected account: unchanged', () => {
  it('AssumeRole refused: 500 "Failed to generate forecast", logged', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    aws.assumeRole.mockRejectedValue(Object.assign(new Error('User is not authorized to perform: sts:AssumeRole'), {
      name: 'AccessDenied', $metadata: { httpStatusCode: 403 },
    }));

    const res = await getForecast(org);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(FAILED);
    expect(aws.assumeRole).toHaveBeenCalledTimes(1);
    expect(controllerErrors()).toHaveLength(1);
  });

  it('Cost Explorer refused: 500 "Failed to generate forecast", logged', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    grantAssumeRole(aws);
    aws.costExplorer.mockRejectedValue(Object.assign(new Error('User is not authorized to perform: ce:GetCostAndUsage'), {
      name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 },
    }) as never);

    const res = await getForecast(org);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(FAILED);
    expect(aws.costExplorer).toHaveBeenCalled();
    expect(controllerErrors()).toHaveLength(1);
  });

  it('a plain Error with the same AWS_NOT_CONNECTED prefix (a client without credentials) stays a 500: matched by class, not text', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    // An instance with no Cost Explorer client: customerCostExplorer() throws the
    // real Error('AWS_NOT_CONNECTED: no organization AWS credentials ...').
    aws.createForOrg.mockResolvedValue(new AWSCostService(appPool));

    const res = await getForecast(org);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(FAILED);
    expect(aws.createForOrg).toHaveBeenCalledTimes(1);
    expect(controllerErrors()).toEqual([
      ['[Forecast Controller] Error:', expect.objectContaining({ message: expect.stringMatching(/^AWS_NOT_CONNECTED: /) })],
    ]);
  });

  it('an error that only carries code AWS_NOT_CONNECTED (not the class) stays a 500: matched by class, not .code', async () => {
    // Synthetic: today only AwsAccountNotConnectedError sets this code, so this pins the
    // rule (class, never a code or a text) against a future error that copies it.
    const org = await orgIn('pro', 'connected');
    watchAws();
    jest.spyOn(CostForecastService.prototype, 'generateForecast').mockRejectedValue(
      Object.assign(new Error('AWS_NOT_CONNECTED: copied'), { code: 'AWS_NOT_CONNECTED' })
    );

    const res = await getForecast(org);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(FAILED);
  });

  it('more than one eligible account: 500 "Failed to generate forecast", not NOT_CONNECTED', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    jest.spyOn(accountsRepository, 'requireEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(org.orgId, 2));

    const res = await getForecast(org);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(FAILED);
    expect(aws.assumeRole).not.toHaveBeenCalled();
  });

  it('fewer than 7 finished days: 422 as before', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    grantAssumeRole(aws);
    jest.spyOn(AWSCostService.prototype as any, 'queryCostTrend').mockResolvedValue(finishedTrend(3));

    const res = await getForecast(org);

    expect(res.status).toBe(422);
    expect(res.body).toEqual(expect.objectContaining({ success: false, code: 'INSUFFICIENT_FORECAST_HISTORY', finishedDays: 3, requiredDays: 7 }));
  });

  it('success: 200 with the forecast', async () => {
    const org = await orgIn('pro', 'connected');
    const aws = watchAws();
    grantAssumeRole(aws);
    jest.spyOn(AWSCostService.prototype as any, 'queryCostTrend').mockResolvedValue(finishedTrend(30));

    const res = await getForecast(org);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.forecast).toEqual(expect.objectContaining({ organizationId: org.orgId, forecastMethod: 'ensemble' }));
    expect(aws.assumeRole).toHaveBeenCalledTimes(1);
    expect(controllerErrors()).toEqual([]);
  });
});

describe('the plan gate comes first: unchanged', () => {
  it.each([['no aws_accounts row' as const], ['connected' as const]])('a free organization (%s): 402 TIER_REQUIRED, no AWS call', async (state) => {
    const org = await orgIn('free', state);
    const aws = watchAws();

    const res = await getForecast(org);

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('TIER_REQUIRED');
    expect(aws.createForOrg).not.toHaveBeenCalled();
    expect(aws.assumeRole).not.toHaveBeenCalled();
  });
});
