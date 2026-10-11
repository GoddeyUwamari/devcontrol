/**
 * The scheduled discovery job through the REAL AWSResourceDiscoveryService and
 * AWSClientFactory: only the STS client is mocked, so nothing reaches AWS.
 *
 * Policy under test:
 *   - An organization with no aws_accounts row, or with a row that is not
 *     active, gets no resource_discovery_jobs row and no STS client.
 *   - The organization's own AssumeRole failure (AWS_NOT_CONNECTED from the
 *     factory) and a platform credential failure both leave a failed job row
 *     whose error_message is a fixed message: no internal tag, ARN, 12-digit
 *     account ID or raw AWS text. The full error stays in the server log.
 *
 * Live Postgres. Every ID, ARN and account ID here is a placeholder.
 */
import { Pool } from 'pg';
import { STSClient } from '@aws-sdk/client-sts';

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const mockComputeAndPersistEvidence = jest.fn();
jest.mock('../../services/soc2-evidence.service', () => ({
  Soc2EvidenceService: jest.fn().mockImplementation(() => ({
    computeAndPersistEvidence: mockComputeAndPersistEvidence,
  })),
}));

import { ResourceDiscoveryJob } from '../resourceDiscovery.job';
import { DISCOVERY_FAILED_MESSAGE } from '../../services/awsResourceDiscovery';
import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../../services/platform-sts';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import { pool as appPool } from '../../config/database';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A random 12-digit placeholder account ID; never a real account. */
function placeholderAccountId(): string {
  return String(Math.floor(1e11 + Math.random() * 9e11));
}

async function insertOrg(awsStatus: string | 'none'): Promise<{ id: string; name: string; roleArn: string | null }> {
  const suffix = uniqueSuffix();
  const name = `Discovery Real Org ${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, is_active)
     VALUES ($1, $2, $3, 'free', 'free', true)
     RETURNING id, name`,
    [name, `discovery-real-org-${suffix}`, name]
  );
  createdOrgIds.push(rows[0].id);
  if (awsStatus === 'none') return { ...rows[0], roleArn: null };
  const accountId = placeholderAccountId();
  const roleArn = `arn:aws:iam::${accountId}:role/DevControlRole`;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', NOW(), $4)`,
    [rows[0].id, roleArn, accountId, awsStatus]
  );
  return { ...rows[0], roleArn };
}

async function jobRows(orgId: string) {
  const { rows } = await pool.query(
    'SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1',
    [orgId]
  );
  return rows;
}

function stsRejects(error: Error) {
  jest.mocked(STSClient).mockImplementation(() => ({ send: jest.fn().mockRejectedValue(error) }) as unknown as STSClient);
}

function expectUserSafe(message: string) {
  expect(message).not.toMatch(/arn:aws:/);
  expect(message).not.toMatch(/\b\d{12}\b/);
  expect(message).not.toMatch(/AWS_NOT_CONNECTED|PLATFORM_AWS_CREDENTIALS_UNAVAILABLE|PLATFORM_AWS_IAM_DENIED/);
  expect(message).not.toContain('is not authorized to perform');
  expect(message).not.toContain('Could not load credentials');
}

const errorLines = (spy: jest.SpyInstance) => spy.mock.calls.map((args) => args.map(String).join(' '));

let job: ResourceDiscoveryJob;
let error: jest.SpyInstance;
let warn: jest.SpyInstance;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(STSClient).mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  job = new ResourceDiscoveryJob(pool);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
  await appPool.end();
});

describe('no AWS work for an organization without an active connection', () => {
  it('no aws_accounts row: skipped, no discovery job row, no STS client, no error or stack trace', async () => {
    const org = await insertOrg('none');

    const summary = await job.scanOrganizations([org]);

    expect(summary).toMatchObject({ skipped: 1, scanned: 0, failed: 0, platformFailed: 0 });
    expect(await jobRows(org.id)).toEqual([]);
    expect(STSClient).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('an inactive row: one warning, no discovery job row, no STS client, no error or stack trace', async () => {
    const org = await insertOrg('disconnected');

    const summary = await job.scanOrganizations([org]);

    expect(summary).toMatchObject({ inactive: 1, scanned: 0, failed: 0, platformFailed: 0 });
    expect(await jobRows(org.id)).toEqual([]);
    expect(STSClient).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(errorLines(warn)).toEqual([`[Resource Discovery Job] Skipping org ${org.id}: AWS connection status is disconnected, not active`]);
  });
});

describe('a connected organization whose discovery fails: an error, and a user-safe error_message', () => {
  it("the organization's role refuses AssumeRole: failed, the job row stores the fixed message", async () => {
    const org = await insertOrg('active');
    const raw = `User: arn:aws:sts::111122223333:assumed-role/DevControlInstanceRole/i-0123456789abcdef0 is not authorized to perform: sts:AssumeRole on resource: ${org.roleArn}`;
    stsRejects(Object.assign(new Error(raw), { name: 'AccessDenied' }));

    const summary = await job.scanOrganizations([org]);

    expect(summary).toMatchObject({ failed: 1, platformFailed: 0, scanned: 0 });
    expect(STSClient).toHaveBeenCalledTimes(1);
    const rows = await jobRows(org.id);
    expect(rows).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE }]);
    expectUserSafe(rows[0].error_message);
    // Still an error in the server log, with the error class; the AWS text stays in the log.
    expect(errorLines(error)).toContain(
      `[Resource Discovery Job] Failed for org ${org.id} (Error): AWS_NOT_CONNECTED: org ${org.id} has not connected an AWS account`
    );
    expect(errorLines(error).some((line) => line.includes(raw))).toBe(true);
  });

  it('the platform identity is unavailable: platform_failed, the job row stores the platform message, not the internal tag', async () => {
    const org = await insertOrg('active');
    stsRejects(Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' }));

    const summary = await job.scanOrganizations([org]);

    expect(summary).toMatchObject({ platformFailed: 1, failed: 0, scanned: 0 });
    const rows = await jobRows(org.id);
    expect(rows).toEqual([{ status: 'failed', error_message: PLATFORM_AWS_UNAVAILABLE_MESSAGE }]);
    expectUserSafe(rows[0].error_message);
    expect(errorLines(error).some((line) => line.includes('[PLATFORM_AWS_CREDENTIALS_UNAVAILABLE]'))).toBe(true);
  });
});
