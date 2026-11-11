/**
 * AWS connect PR D1a against the real database (aws_connection_checks as the
 * bootstrap creates it; the shared aws_accounts fixture). STS is spied at
 * platform-sts and IAM is a fake client: no AWS.
 *
 *   - Repository: fenced, monotonic health writes (an older or equal attempt
 *     changes nothing); a write for a connection that was replaced writes
 *     nothing; two queued failure writes both count; scan vs Check again, the
 *     newer wins; the role ID baseline / replacement / re-baseline; the
 *     cooldown claim; the view never carries the role ID.
 *   - ScanContext.forOrg and its refresh record AccessDenied as failing, a
 *     success as ok, a platform failure as nothing; a failing health write never
 *     changes the scan's own outcome.
 *   - Refused sources (CP-D11, D1-D9): a refused listing saves `denied` and runs
 *     ONE policy compare on the scan's IAM client (never the probes); none
 *     refused -> no compare; a compare under an hour old -> skipped; an older
 *     scan never replaces a newer one's sources; Resource Explorer's
 *     AccessDenied is `denied`.
 *
 * Placeholders only.
 */
import { Pool } from 'pg';
import * as platformSts from '../platform-sts';
import { PlatformAwsCredentialsUnavailableError } from '../platform-sts';
import * as fence from '../aws-connection-fence';
import { ConnectionChangedError } from '../aws-connection-fence';
import { awsConnectionIdentity } from '../../repositories/aws-accounts.repository';
import {
  claimCheckAgain,
  connectionChecksView,
  readConnectionChecks,
  recordAssumeOutcome,
  recordAssumeOutcomeSoft,
  savePolicyResult,
  saveScanSources,
} from '../../repositories/aws-connection-checks.repository';
import { ScanContext } from '../scan-context';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { ResourceExplorerService } from '../resourceExplorer.service';
import * as permissionCheck from '../connect-permission-check';
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
const ROLE_ID = 'AROAEXAMPLEROLEID0001';
const OTHER_ROLE_ID = 'AROAEXAMPLEROLEID0002';
const HOUR = 3600e3;

type Account = { id: string; org_id: string; account_id: string; role_arn: string; region: string; external_id: string };

async function orgWithConnection(): Promise<Account> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $1, $1, 'free', 'free') RETURNING id::text AS id`,
    [`d1-health-${suffix}`])).rows[0].id as string;
  createdOrgIds.push(org);
  return insertConnection(org, suffix);
}
async function insertConnection(org: string, suffix: string): Promise<Account> {
  const accountId = '123456789012';
  return (await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status, connected_at)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active', NOW())
     RETURNING id::text AS id, org_id::text AS org_id, $4::text AS account_id, role_arn, region, external_id`,
    [org, `arn:aws:iam::${accountId}:role/DevControlRole`, `ph-${suffix}`.slice(0, 32), accountId])).rows[0];
}
/** The identity exactly as the fence compares it (the stored account_id). */
async function storedIdentity(a: Account): Promise<string> {
  const row = (await pool.query(`SELECT id::text AS id, account_id, role_arn, region FROM aws_accounts WHERE id = $1`, [a.id])).rows[0];
  return awsConnectionIdentity(row);
}
const row = (a: Account) => readConnectionChecks(pool, a.org_id, a.id);

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});
afterAll(async () => {
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
  await appPool.end();
});
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('repository: fenced, monotonic health writes', () => {
  it('failing, then an older and an equal attempt change nothing, then ok', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    const t = Date.parse('2026-11-11T06:00:00Z');
    expect(await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t), result: 'role_refused' }, source: 'scan' })).toEqual({ written: true, roleReplacedNow: false });
    expect(await row(a)).toMatchObject({ health_state: 'failing', consecutive_role_failures: 1, last_attempt_result: 'role_refused' });
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t - 1000), result: 'ok' }, source: 'scan' })).written).toBe(false);
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t), result: 'ok' }, source: 'scan' })).written).toBe(false);
    expect(await row(a)).toMatchObject({ health_state: 'failing', consecutive_role_failures: 1 });
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t + 1000), result: 'ok' }, source: 'scan' });
    expect(await row(a)).toMatchObject({ health_state: 'ok', consecutive_role_failures: 0, failing_since: null });
  });

  it('a write for a connection that was replaced (under the exclusive lock) writes nothing', async () => {
    const a = await orgWithConnection();
    const oldIdentity = await storedIdentity(a);
    // The connection is replaced, as a disconnect + reconnect would (connection lock exclusive).
    await fence.withConnectionChange(pool, a.org_id, async (c) => {
      await c.query('DELETE FROM aws_accounts WHERE id = $1', [a.id]);
      await c.query(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')`,
        [a.org_id, a.role_arn, `ph-new-${a.id.slice(0, 8)}`]);
    });
    await expect(recordAssumeOutcome(a.org_id, oldIdentity, a.id, { attempt: { at: new Date(), result: 'role_refused' }, source: 'scan' }))
      .rejects.toBeInstanceOf(ConnectionChangedError);
    expect(await recordAssumeOutcomeSoft(a.org_id, oldIdentity, a.id, { attempt: { at: new Date(), result: 'role_refused' }, source: 'scan' }))
      .toEqual({ written: false, roleReplacedNow: false });
    expect((await pool.query(`SELECT count(*)::int AS n FROM aws_connection_checks WHERE organization_id = $1`, [a.org_id])).rows[0].n).toBe(0);
  });

  it('two failure writes queued on the row lock with distinct attempt times both count (+2)', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    const t = Date.parse('2026-11-11T06:00:00Z');
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t), result: 'ok' }, source: 'scan' });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM aws_connection_checks WHERE aws_account_id = $1 FOR UPDATE', [a.id]);
      const waiting = async (n: number) => {
        for (let i = 0; i < 250; i++) {
          const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM aws_connection_checks WHERE organization_id%FOR UPDATE%'`);
          if (rows[0].n >= n) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error('the writes did not queue');
      };
      const first = recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t + HOUR), result: 'role_refused' }, source: 'scan' });
      await waiting(1);
      const second = recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t + 2 * HOUR), result: 'role_refused' }, source: 'check_again' });
      await waiting(2);
      await holder.query('COMMIT');
      await Promise.all([first, second]);
    } finally {
      holder.release();
    }
    expect(await row(a)).toMatchObject({ health_state: 'failing', consecutive_role_failures: 2, last_attempt_at: new Date(t + 2 * HOUR), failing_since: new Date(t + HOUR) });
  });

  it('scan vs Check again: a Check again success newer than a slow scan failure wins', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    const t = Date.parse('2026-11-11T06:00:00Z');
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t + 10_000), result: 'ok' }, roleUniqueId: ROLE_ID, source: 'check_again' });
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: new Date(t), result: 'role_refused' }, source: 'scan' })).written).toBe(false);
    expect(await row(a)).toMatchObject({ health_state: 'ok', consecutive_role_failures: 0, last_attempt_result: 'ok' });
  });

  it('role ID: connect baseline; same ID nothing; a different ID marks replaced once; Check again re-baselines and clears', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    const t = Date.parse('2026-11-11T06:00:00Z');
    const at = (h: number) => new Date(t + h * HOUR);
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(0), result: 'ok' }, roleUniqueId: ROLE_ID, source: 'connect' });
    expect(await row(a)).toMatchObject({ role_unique_id: ROLE_ID, role_unique_id_source: 'connect', role_replaced_at: null });
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(1), result: 'ok' }, roleUniqueId: ROLE_ID, source: 'scan' })).roleReplacedNow).toBe(false);
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(2), result: 'ok' }, roleUniqueId: OTHER_ROLE_ID, source: 'scan' })).roleReplacedNow).toBe(true);
    expect((await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(3), result: 'ok' }, roleUniqueId: OTHER_ROLE_ID, source: 'scan' })).roleReplacedNow).toBe(false);
    expect(await row(a)).toMatchObject({ role_unique_id: ROLE_ID, role_replaced_at: at(2) });
    // A null (malformed) ID never changes or marks anything.
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(4), result: 'ok' }, roleUniqueId: null, source: 'scan' });
    expect(await row(a)).toMatchObject({ role_unique_id: ROLE_ID, role_replaced_at: at(2) });
    await recordAssumeOutcome(a.org_id, id, a.id, { attempt: { at: at(5), result: 'ok' }, roleUniqueId: OTHER_ROLE_ID, source: 'check_again' });
    expect(await row(a)).toMatchObject({ role_unique_id: OTHER_ROLE_ID, role_unique_id_source: 'check_again', role_replaced_at: null });
    // The view names only when; never the ID.
    const view = connectionChecksView(await row(a), at(5));
    expect(JSON.stringify(view)).not.toMatch(/AROA/);
  });

  it('a scan records a baseline only when none exists (pre-D1 connections), labelled scan', async () => {
    const a = await orgWithConnection();
    await recordAssumeOutcome(a.org_id, await storedIdentity(a), a.id, { attempt: { at: new Date(), result: 'ok' }, roleUniqueId: ROLE_ID, source: 'scan' });
    expect(await row(a)).toMatchObject({ role_unique_id: ROLE_ID, role_unique_id_source: 'scan', role_replaced_at: null });
  });

  it('the Check again claim: once per 5 minutes, by the database clock', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    expect(await claimCheckAgain(a.org_id, id, a.id)).toEqual({ ok: true });
    const second = await claimCheckAgain(a.org_id, id, a.id);
    expect(second.ok).toBe(false);
    const started = (await row(a))!.check_again_started_at as Date;
    if (!second.ok) expect(second.availableAt.getTime()).toBe(new Date(started).getTime() + 5 * 60e3);
    await pool.query(`UPDATE aws_connection_checks SET check_again_started_at = now() - interval '5 minutes 1 second' WHERE aws_account_id = $1`, [a.id]);
    expect(await claimCheckAgain(a.org_id, id, a.id)).toEqual({ ok: true });
  });
});

/** STS answers for the scan: a success with a role ID, or a thrown error. */
function stsAnswer(result: 'ok' | Error, expiresInMs = 3600e3) {
  return jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return {
      Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example', Expiration: new Date(Date.now() + expiresInMs) },
      AssumedRoleUser: { AssumedRoleId: `${ROLE_ID}:devcontrol-scan`, Arn: 'arn:aws:sts::123456789012:assumed-role/DevControlRole/devcontrol-scan' },
    } as any;
  });
}
const denied = () => Object.assign(new Error('not authorized'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });

describe('ScanContext records the scan AssumeRole as health', () => {
  it('AccessDenied: the scan fails exactly as before (AWS_NOT_CONNECTED) and health is failing', async () => {
    const a = await orgWithConnection();
    stsAnswer(denied());
    await expect(ScanContext.forOrg(a.org_id)).rejects.toThrow(`AWS_NOT_CONNECTED: org ${a.org_id} has not connected an AWS account`);
    expect(await row(a)).toMatchObject({ health_state: 'failing', last_attempt_result: 'role_refused', consecutive_role_failures: 1 });
  });

  it('a platform failure: the scan fails as before and nothing is recorded', async () => {
    const a = await orgWithConnection();
    stsAnswer(new PlatformAwsCredentialsUnavailableError(denied()));
    await expect(ScanContext.forOrg(a.org_id)).rejects.toBeInstanceOf(PlatformAwsCredentialsUnavailableError);
    expect(await row(a)).toBeNull();
  });

  it('a success: ok, with the role ID baseline labelled scan', async () => {
    const a = await orgWithConnection();
    stsAnswer('ok');
    const ctx = await ScanContext.forOrg(a.org_id);
    expect(ctx.awsAccountRowId).toBe(a.id);
    expect(await row(a)).toMatchObject({ health_state: 'ok', role_unique_id: ROLE_ID, role_unique_id_source: 'scan' });
  });

  it('a refresh refused mid-scan counts as a role failure, and the scan still fails as before', async () => {
    const a = await orgWithConnection();
    stsAnswer('ok', 60e3); // inside the refresh window: the next request refreshes
    const ctx = await ScanContext.forOrg(a.org_id);
    stsAnswer(denied());
    await expect(ctx.ensureFreshCredentials()).rejects.toThrow('AWS_NOT_CONNECTED');
    expect(await row(a)).toMatchObject({ health_state: 'failing', last_attempt_result: 'role_refused' });
  });

  it('a health write that fails (table missing) never changes the scan: the context is still returned', async () => {
    const a = await orgWithConnection();
    stsAnswer('ok');
    jest.spyOn(fence, 'withConnectionFence').mockRejectedValue(Object.assign(new Error('relation "aws_connection_checks" does not exist'), { code: '42P01' }));
    const ctx = await ScanContext.forOrg(a.org_id);
    expect(ctx.awsAccountRowId).toBe(a.id);
    stsAnswer(denied());
    await expect(ScanContext.forOrg(a.org_id)).rejects.toThrow(`AWS_NOT_CONNECTED: org ${a.org_id} has not connected an AWS account`);
  });
});

/** recordScanSources with a pass-through lease session (the lease fence itself is covered by the discovery suites). */
async function recordScanSources(a: Account, outcomes: Array<{ source: string; status: any }>, iam: { send: jest.Mock }) {
  const service = new AWSResourceDiscoveryService(pool);
  const client = await pool.connect();
  try {
    const scan = { checkpoint: () => undefined, fenced: (_c: unknown, fn: () => Promise<unknown>) => fn() };
    const scanContext = { awsAccountRowId: a.id, connectionIdentity: await storedIdentity(a), roleArn: a.role_arn, awsAccountId: a.account_id };
    await (service as any).recordScanSources(client, scan, '00000000-0000-4000-8000-000000000003', scanContext, { iam }, a.org_id, outcomes);
  } finally {
    client.release();
  }
}
const ALL_COMPLETE = ['ec2', 'ebs', 'rds', 's3', 'lambda', 'load-balancer', 'cloudfront', 'resource-explorer'].map((source) => ({ source, status: 'complete' }));
const fakeIam = () => ({ send: jest.fn().mockResolvedValue({ AttachedPolicies: [], PolicyNames: [], IsTruncated: false }) });

describe('refused sources (CP-D11, D1-D9)', () => {
  it('a refused EC2 listing is saved as denied and runs one policy compare on the scan IAM client, never the probes', async () => {
    const a = await orgWithConnection();
    const probes = jest.spyOn(permissionCheck, 'runPermissionCheck');
    const iam = fakeIam();
    await recordScanSources(a, [...ALL_COMPLETE.filter((o) => o.source !== 'ec2'), { source: 'ec2', status: 'denied' }, { source: 'dynamodb', status: 'denied' }], iam);
    const saved = (await row(a))!;
    expect(saved.scan_sources).toEqual({ ...Object.fromEntries(ALL_COMPLETE.map((o) => [o.source, 'complete'])), ec2: 'denied' }); // only the 8
    expect(saved.policy_trigger).toBe('scan_access_denied');
    expect(iam.send).toHaveBeenCalledTimes(2);
    expect(probes).not.toHaveBeenCalled();
    expect(connectionChecksView(saved, new Date()).refusedSources).toEqual({ scannedAt: expect.any(String), sources: [{ source: 'ec2', action: 'ec2:DescribeInstances' }] });
  });

  it('nothing refused: sources saved, no compare', async () => {
    const a = await orgWithConnection();
    const iam = fakeIam();
    await recordScanSources(a, ALL_COMPLETE, iam);
    expect(iam.send).not.toHaveBeenCalled();
    expect((await row(a))!.policy_checked_at).toBeNull();
    expect(connectionChecksView(await row(a), new Date()).refusedSources?.sources).toEqual([]);
  });

  it('a compare under an hour old: skipped; over an hour: runs', async () => {
    const a = await orgWithConnection();
    const id = await storedIdentity(a);
    await savePolicyResult(a.org_id, id, a.id, { result: { unreadable: true, contractVersion: 1 }, at: new Date(Date.now() - 30 * 60e3), trigger: 'connect' });
    const iam = fakeIam();
    await recordScanSources(a, [{ source: 's3', status: 'denied' }], iam);
    expect(iam.send).not.toHaveBeenCalled();
    await pool.query(`UPDATE aws_connection_checks SET policy_checked_at = now() - interval '61 minutes' WHERE aws_account_id = $1`, [a.id]);
    await recordScanSources(a, [{ source: 's3', status: 'denied' }], iam);
    expect(iam.send).toHaveBeenCalledTimes(2);
  });

  it('an older scan never replaces a newer one\'s sources', async () => {
    const a = await orgWithConnection();
    const client = await pool.connect();
    try {
      expect(await saveScanSources(client, a.org_id, a.id, { outcomes: [{ source: 'ec2', status: 'denied' }], jobId: '00000000-0000-4000-8000-000000000002', at: new Date('2026-11-11T07:00:00Z') })).toBe(true);
      expect(await saveScanSources(client, a.org_id, a.id, { outcomes: [{ source: 'ec2', status: 'complete' }], jobId: '00000000-0000-4000-8000-000000000001', at: new Date('2026-11-11T06:00:00Z') })).toBe(false);
    } finally {
      client.release();
    }
    expect((await row(a))!.scan_sources).toEqual({ ec2: 'denied' });
  });

  it('a Resource Explorer AccessDenied is denied (not failed); another failure stays failed', async () => {
    const service = new ResourceExplorerService();
    const failing = (error: Error) => ({ send: jest.fn().mockRejectedValue(error) }) as any;
    expect(await service.search(failing(Object.assign(new Error('no'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } })), 'us-east-1'))
      .toMatchObject({ success: false, status: 'denied' });
    expect(await service.search(failing(Object.assign(new Error('no index'), { name: 'UnauthorizedException', $metadata: { httpStatusCode: 401 } })), 'us-east-1'))
      .toMatchObject({ success: false, status: 'failed' });
  });
});

