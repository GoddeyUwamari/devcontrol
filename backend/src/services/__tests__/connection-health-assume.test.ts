/**
 * AWS connect PR D1a: how an AssumeRole outcome becomes recorded health, with no
 * database and no AWS (STS is spied at platform-sts, the repository is spied).
 *
 *   - Every classifyAssumeRoleError kind maps to its recorded result (D1-D2), and
 *     a failure on DevControl's own side (PlatformAwsCredentialsUnavailableError,
 *     either cause) is never recorded.
 *   - AwsAssumeRoleFailedError keeps the AWS_NOT_CONNECTED message byte for byte,
 *     so the callers that match on its prefix still match.
 *   - assumeAccountRole and checkConnectRole return the role ID from
 *     AssumedRoleUser.AssumedRoleId; a malformed or absent one is null.
 *   - ScanContext records the first AssumeRole and each refresh, and a failed
 *     record never changes the scan's own outcome.
 *   - Static: nothing outside tests ever writes aws_accounts with UPDATE (never
 *     auto-disconnect), and every AWS_NOT_CONNECTED matcher is a prefix/substring
 *     match the unchanged message satisfies.
 *
 * Placeholders only.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../config/database', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import * as platformSts from '../platform-sts';
import { PlatformAwsCredentialsUnavailableError } from '../platform-sts';
import { AWSClientFactory, AwsAssumeRoleFailedError, isAwsAssumeRoleFailed } from '../aws-client-factory.service';
import { classifyAssumeRoleError, checkConnectRole } from '../connect-role-check';
import { ASSUME_RESULT_FOR_KIND } from '../connection-health';
import * as checksRepository from '../../repositories/aws-connection-checks.repository';
import { recordScanAssumeFailure, recordScanAssumeSuccess } from '../connection-health-recorder';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = {
  id: '00000000-0000-4000-8000-0000000000b1',
  org_id: ORG,
  account_id: '123456789012',
  role_arn: 'arn:aws:iam::123456789012:role/DevControlRole',
  external_id: 'placeholder-external-id',
  region: 'us-east-1',
};
const ROLE_ID = 'AROAEXAMPLEROLEID0001';

const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`${name} placeholder`), { name, ...extra });
const OLD_MESSAGE = (org: string) => `AWS_NOT_CONNECTED: org ${org} has not connected an AWS account`;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('assume classification -> recorded result (D1-D2)', () => {
  it.each([
    [awsError('AccessDenied'), 'trust_denied', 'role_refused'],
    [awsError('AccessDeniedException'), 'trust_denied', 'role_refused'],
    [awsError('NoSuchEntity'), 'not_found', 'role_not_found'],
    [awsError('ValidationError', { $metadata: { httpStatusCode: 400 } }), 'permanent', 'role_error'],
    [awsError('Throttling'), 'transient', 'aws_unavailable'],
    [awsError('InternalFailure', { $metadata: { httpStatusCode: 500 } }), 'transient', 'aws_unavailable'],
    [Object.assign(new Error('socket'), { code: 'ECONNRESET' }), 'transient', 'aws_unavailable'],
    [awsError('TimeoutError'), 'transient', 'aws_unavailable'],
    [new PlatformAwsCredentialsUnavailableError(awsError('CredentialsProviderError')), 'platform', 'platform_unavailable'],
    [new PlatformAwsCredentialsUnavailableError(awsError('AccessDenied')), 'platform', 'platform_unavailable'],
  ])('%p is %s, recorded as %s', (error, kind, result) => {
    expect(classifyAssumeRoleError(error)).toBe(kind);
    expect(ASSUME_RESULT_FOR_KIND[kind as keyof typeof ASSUME_RESULT_FOR_KIND]).toBe(result);
  });
});

describe('AwsAssumeRoleFailedError keeps the AWS_NOT_CONNECTED message', () => {
  it('is byte-identical to the message before D1 and matched by every prefix matcher', () => {
    const err = new AwsAssumeRoleFailedError(ORG, 'trust_denied', new Date(), ACCOUNT);
    expect(err.message).toBe(OLD_MESSAGE(ORG));
    expect(err.name).toBe('Error');
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message).startsWith('AWS_NOT_CONNECTED')).toBe(true);    // stats, weekly summary, AI chat
    expect(err.message.startsWith('AWS_NOT_CONNECTED:')).toBe(true);           // services.routes
    expect(err.message.includes('AWS_NOT_CONNECTED')).toBe(true);              // cost recommendations
    expect(isAwsAssumeRoleFailed(err)).toBe(true);
    expect(isAwsAssumeRoleFailed(new Error(OLD_MESSAGE(ORG)))).toBe(false);
  });

  it('carries no AWS message, credential or External ID in its message or JSON', () => {
    const err = new AwsAssumeRoleFailedError(ORG, 'trust_denied', new Date(), { id: ACCOUNT.id, org_id: ORG, role_arn: ACCOUNT.role_arn });
    expect(err.message).not.toMatch(/placeholder-external-id|arn:aws|AccessDenied/);
  });
});

describe('AWSClientFactory.assumeAccountRole', () => {
  it('a success returns when it started and the role ID', async () => {
    const before = Date.now();
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example', Expiration: new Date(Date.now() + 3600e3) },
      AssumedRoleUser: { AssumedRoleId: `${ROLE_ID}:devcontrol-00000000`, Arn: 'arn:aws:sts::123456789012:assumed-role/DevControlRole/devcontrol-00000000' },
    } as any);
    const out = await AWSClientFactory.assumeAccountRole(ORG, ACCOUNT, 'us-east-1');
    expect(out.roleUniqueId).toBe(ROLE_ID);
    expect(out.attemptedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each([[undefined], ['malformed'], ['AROA-BAD:session']])('AssumedRoleId %p gives a null role ID, never a guess', async (assumedRoleId) => {
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example' },
      AssumedRoleUser: assumedRoleId === undefined ? undefined : { AssumedRoleId: assumedRoleId, Arn: 'x' },
    } as any);
    expect((await AWSClientFactory.assumeAccountRole(ORG, ACCOUNT, 'us-east-1')).roleUniqueId).toBeNull();
  });

  it.each([
    ['AccessDenied', 'trust_denied'],
    ['NoSuchEntity', 'not_found'],
    ['Throttling', 'transient'],
    ['ValidationError', 'permanent'],
  ])('%s throws AwsAssumeRoleFailedError(%s) with the account it tried and when', async (name, kind) => {
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockRejectedValue(awsError(name, { $metadata: { httpStatusCode: 400 } }));
    const err = await AWSClientFactory.assumeAccountRole(ORG, ACCOUNT, 'us-east-1').catch((e) => e);
    expect(isAwsAssumeRoleFailed(err)).toBe(true);
    expect(err).toMatchObject({ kind, account: ACCOUNT, message: OLD_MESSAGE(ORG) });
    expect(err.attemptedAt).toBeInstanceOf(Date);
  });

  it('a platform failure is rethrown unchanged (never AWS_NOT_CONNECTED)', async () => {
    const platform = new PlatformAwsCredentialsUnavailableError(awsError('CredentialsProviderError'));
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockRejectedValue(platform);
    await expect(AWSClientFactory.assumeAccountRole(ORG, ACCOUNT, 'us-east-1')).rejects.toBe(platform);
  });
});

describe('checkConnectRole returns the role ID and takes a session name', () => {
  it('ok: roleUniqueId from AssumedRoleId; the session name defaults to devcontrol-validation', async () => {
    const assume = jest.fn().mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example' },
      AssumedRoleUser: { AssumedRoleId: `${ROLE_ID}:devcontrol-validation`, Arn: 'x' },
    });
    const ok = await checkConnectRole({ region: 'us-east-1', roleArn: ACCOUNT.role_arn, externalId: 'placeholder-external-id', context: 't', assume });
    expect(ok).toMatchObject({ ok: true, roleUniqueId: ROLE_ID });
    expect(assume.mock.calls[0][0]).toMatchObject({ RoleSessionName: 'devcontrol-validation' });
    await checkConnectRole({ region: 'us-east-1', roleArn: ACCOUNT.role_arn, externalId: 'placeholder-external-id', context: 't', assume, sessionName: 'devcontrol-check' });
    expect(assume.mock.calls[1][0]).toMatchObject({ RoleSessionName: 'devcontrol-check' });
  });

  it('no AssumedRoleUser: roleUniqueId null', async () => {
    const assume = jest.fn().mockResolvedValue({ Credentials: { AccessKeyId: 'a', SecretAccessKey: 'b', SessionToken: 'c' } });
    expect(await checkConnectRole({ region: 'us-east-1', roleArn: ACCOUNT.role_arn, externalId: 'x', context: 't', assume })).toMatchObject({ ok: true, roleUniqueId: null });
  });
});

describe('connection-health-recorder', () => {
  const soft = () => jest.spyOn(checksRepository, 'recordAssumeOutcomeSoft').mockResolvedValue({ written: true, roleReplacedNow: false });

  it.each([
    ['trust_denied', 'role_refused'],
    ['not_found', 'role_not_found'],
    ['permanent', 'role_error'],
    ['transient', 'aws_unavailable'],
  ] as const)('a scan failure of kind %s is recorded as %s, fenced on the account it tried', async (kind, result) => {
    const spy = soft();
    const at = new Date('2026-11-11T06:00:00Z');
    await recordScanAssumeFailure(ORG, new AwsAssumeRoleFailedError(ORG, kind, at, ACCOUNT));
    expect(spy).toHaveBeenCalledTimes(1);
    const [org, identity, rowId, outcome] = spy.mock.calls[0];
    expect([org, rowId]).toEqual([ORG, ACCOUNT.id]);
    expect(identity).toBe(JSON.stringify([ACCOUNT.id, ACCOUNT.account_id, ACCOUNT.role_arn, 'us-east-1']));
    expect(outcome).toEqual({ attempt: { at, result }, source: 'scan' });
  });

  it.each([
    ['a platform failure (credentials)', new PlatformAwsCredentialsUnavailableError(awsError('CredentialsProviderError'))],
    ['a platform failure (platform IAM denied)', new PlatformAwsCredentialsUnavailableError(awsError('AccessDenied'))],
    ['a plain AWS_NOT_CONNECTED (no eligible account)', new Error(OLD_MESSAGE(ORG))],
    ['another organization\'s account', new AwsAssumeRoleFailedError(ORG, 'trust_denied', new Date(), { ...ACCOUNT, org_id: '00000000-0000-4000-8000-0000000000a2' })],
  ])('%s is not recorded', async (_label, error) => {
    const spy = soft();
    await recordScanAssumeFailure(ORG, error);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a scan success is recorded as ok with the role ID, source scan', async () => {
    const spy = soft();
    const at = new Date('2026-11-11T06:00:00Z');
    await recordScanAssumeSuccess({ organizationId: ORG, account: ACCOUNT, attemptedAt: at, roleUniqueId: ROLE_ID });
    expect(spy.mock.calls[0][3]).toEqual({ attempt: { at, result: 'ok' }, roleUniqueId: ROLE_ID, source: 'scan' });
  });

  it('a replaced role triggers one policy compare (D1-D7) on the scan IAM client, saved as role_replaced', async () => {
    jest.spyOn(checksRepository, 'recordAssumeOutcomeSoft').mockResolvedValue({ written: true, roleReplacedNow: true });
    const save = jest.spyOn(checksRepository, 'savePolicyResult').mockResolvedValue(true);
    const iam = { send: jest.fn().mockResolvedValue({ AttachedPolicies: [], PolicyNames: [], IsTruncated: false }) };
    await recordScanAssumeSuccess({ organizationId: ORG, account: ACCOUNT, attemptedAt: new Date(), roleUniqueId: ROLE_ID, iam });
    expect(iam.send).toHaveBeenCalledTimes(2); // the two listings; no inline DevControlReadExtras
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][3]).toMatchObject({ trigger: 'role_replaced', result: { unreadable: false } });
  });

  it('no compare when the role is the same', async () => {
    soft();
    const save = jest.spyOn(checksRepository, 'savePolicyResult');
    const iam = { send: jest.fn() };
    await recordScanAssumeSuccess({ organizationId: ORG, account: ACCOUNT, attemptedAt: new Date(), roleUniqueId: ROLE_ID, iam });
    expect(iam.send).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('a failing record never throws (fail-soft)', async () => {
    const { pool } = jest.requireMock('../../config/database');
    pool.connect.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    await expect(recordScanAssumeFailure(ORG, new AwsAssumeRoleFailedError(ORG, 'trust_denied', new Date(), ACCOUNT))).resolves.toBeUndefined();
    await expect(recordScanAssumeSuccess({ organizationId: ORG, account: ACCOUNT, attemptedAt: new Date(), roleUniqueId: null })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Static
// ---------------------------------------------------------------------------

const SRC = path.join(__dirname, '../..');
function nonTestSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['__tests__', 'node_modules'].includes(entry.name)) walk(full);
      } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        out.push({ file: path.relative(SRC, full), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('static', () => {
  const sources = nonTestSources();

  it('no non-test backend code writes aws_accounts with UPDATE (D1 never auto-disconnects)', () => {
    expect(sources.filter((s) => /UPDATE\s+(public\.)?aws_accounts\b/i.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('every AWS_NOT_CONNECTED matcher is a prefix or substring match on the message', () => {
    const matchers = sources.flatMap((s) =>
      [...s.text.matchAll(/(startsWith|includes)\(\s*'AWS_NOT_CONNECTED:?'\s*\)/g)].map((m) => `${s.file}:${m[1]}`));
    // stats, services.routes, weekly-summary, ai-chat-context, cost-recommendations (x2)
    expect(matchers.length).toBeGreaterThanOrEqual(6);
    for (const file of ['controllers/stats.controller.ts', 'routes/services.routes.ts', 'repositories/weekly-summary.repository.ts',
      'repositories/ai-chat-context.repository.ts', 'controllers/cost-recommendations.controller.ts']) {
      expect(matchers.some((m) => m.startsWith(file))).toBe(true);
    }
    // No matcher compares the whole message (an exact compare would break on any change).
    expect(sources.filter((s) => /===\s*['`]AWS_NOT_CONNECTED/.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('the scan context records health only through connection-health-recorder (D1-D3)', () => {
    const callers = sources.filter((s) => /recordScanAssume(Success|Failure)\(/.test(s.text) && !s.file.endsWith('connection-health-recorder.ts')).map((s) => s.file);
    expect(callers).toEqual(['services/scan-context.ts']);
  });
});
