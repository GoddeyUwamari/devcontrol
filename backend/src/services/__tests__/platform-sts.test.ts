/**
 * The platform's STS client and how its failures are classified.
 *
 *   - A new region-only client for every AssumeRole, never kept: a long-lived
 *     client refreshes expiring credentials in the background, and a failed
 *     background refresh is an unhandled rejection that ends the process.
 *   - A failure to resolve or use the platform's own identity -- including an
 *     AccessDenied from the platform's own IAM policies -- becomes
 *     PlatformAwsCredentialsUnavailableError, logged under
 *     PLATFORM_AWS_CREDENTIALS_UNAVAILABLE or PLATFORM_AWS_IAM_DENIED, and is
 *     never AWS_NOT_CONNECTED.
 *   - Every other AssumeRole failure is rethrown unchanged.
 *
 * No request leaves the process: send() is stubbed, except in the child
 * processes, where the real default chain runs with instance metadata
 * disabled and no profile or config file.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { STSClient } from '@aws-sdk/client-sts';
import {
  assumeRoleAsPlatform,
  isPlatformAwsCredentialsUnavailable,
  isPlatformCredentialFailure,
  isPlatformIamDenial,
  PlatformAwsCredentialsUnavailableError,
  PLATFORM_AWS_CREDENTIALS_UNAVAILABLE,
  PLATFORM_AWS_IAM_DENIED,
} from '../platform-sts';

const INPUT = { RoleArn: 'arn:aws:iam::123456789012:role/DevControlRole', RoleSessionName: 's', ExternalId: 'external-id-1' };

/** An error shaped as the SDK throws it: its class is carried in `name`. */
function sdkError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

// Placeholder principals only. The platform's caller is an instance-role session.
const CALLER = 'arn:aws:sts::111122223333:assumed-role/DevControlInstanceRole/i-0123456789abcdef0';
const ROLE = 'arn:aws:iam::123456789012:role/DevControlRole';
const DENIED = `User: ${CALLER} is not authorized to perform: sts:AssumeRole on resource: ${ROLE}`;

/** AccessDenied caused by a policy evaluated on the platform's own side. */
const PLATFORM_SIDE_DENIALS: Array<[string, string, string]> = [
  ['the platform identity policy (no allow)', 'AccessDenied', `${DENIED} because no identity-based policy allows the sts:AssumeRole action`],
  ['the platform identity policy (explicit deny)', 'AccessDenied', `${DENIED} with an explicit deny in an identity-based policy`],
  ['a permissions boundary', 'AccessDenied', `${DENIED} because no permissions boundary allows the sts:AssumeRole action`],
  ['a service control policy', 'AccessDenied', `${DENIED} with an explicit deny in a service control policy`],
  ['a session policy', 'AccessDenied', `${DENIED} because no session policy allows the sts:AssumeRole action`],
  ['the exception form of the name', 'AccessDeniedException', `${DENIED} because no identity-based policy allows the sts:AssumeRole action`],
  ['mixed case', 'AccessDenied', `${DENIED} because no Identity-Based Policy allows the sts:AssumeRole action`],
];

/** AccessDenied the organization's role is responsible for: existing handling. */
const ORGANIZATION_SIDE_DENIALS: Array<[string, string, string]> = [
  ['the role trust policy or ExternalId', 'AccessDenied', DENIED],
  ['a resource control policy on the role account', 'AccessDenied', `${DENIED} with an explicit deny in a resource control policy`],
  ['a resource-based policy', 'AccessDenied', `${DENIED} because no resource-based policy allows the sts:AssumeRole action`],
];

let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the platform STS client', () => {
  it('is a new region-only client for every AssumeRole, never one held across calls', async () => {
    const send = jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => ({}));
    await assumeRoleAsPlatform('us-east-1', INPUT, 'test');
    await assumeRoleAsPlatform('us-east-1', INPUT, 'test');
    await assumeRoleAsPlatform('eu-west-1', INPUT, 'test');

    expect(send).toHaveBeenCalledTimes(3);
    const clients = send.mock.contexts as STSClient[];
    expect(new Set(clients).size).toBe(3);
    expect(await Promise.all(clients.map((c) => c.config.region()))).toEqual(['us-east-1', 'us-east-1', 'eu-west-1']);
  });
});

describe('isPlatformCredentialFailure', () => {
  it.each([
    ['the default chain finding nothing', sdkError('CredentialsProviderError', 'Could not load credentials from any providers')],
    ['an instance metadata timeout', sdkError('ProviderError', 'TimeoutError from instance metadata service')],
    ['instance metadata unreachable', sdkError('ProviderError', 'Unable to connect to instance metadata service')],
    ['a token provider failure', sdkError('TokenProviderError', 'token unavailable')],
    ['the chain message under another name', new Error('Could not load credentials from any providers')],
    ['STS rejecting the platform key', sdkError('InvalidClientTokenId', 'The security token included in the request is invalid.')],
    ['an expired platform session', sdkError('ExpiredToken', 'The security token included in the request is expired')],
    ['an expired platform session (exception form)', sdkError('ExpiredTokenException', 'The security token included in the request is expired')],
    ['a wrong platform secret', sdkError('SignatureDoesNotMatch', 'The request signature we calculated does not match')],
  ])('is true for %s', (_label, err) => {
    expect(isPlatformCredentialFailure(err)).toBe(true);
  });

  it.each([
    ['AccessDenied (trust policy or ExternalId mismatch)', sdkError('AccessDenied', 'User is not authorized to perform: sts:AssumeRole')],
    ['a missing role', sdkError('NoSuchEntity', 'The role cannot be found')],
    ['a region STS is not enabled in', sdkError('RegionDisabledException', 'STS is not activated in this region')],
    ['a plain error', new Error('socket hang up')],
    ['not an error', 'Could not load'],
    ['nothing', undefined],
  ])('is false for %s', (_label, err) => {
    expect(isPlatformCredentialFailure(err)).toBe(false);
  });
});

describe('isPlatformIamDenial', () => {
  it.each(PLATFORM_SIDE_DENIALS)('is true for %s', (_label, name, message) => {
    expect(isPlatformIamDenial(sdkError(name, message))).toBe(true);
  });

  it.each([
    ...ORGANIZATION_SIDE_DENIALS,
    ['another error name with a platform-side phrase', 'NoSuchEntity', 'no identity-based policy allows'],
  ])('is false for %s', (_label, name, message) => {
    expect(isPlatformIamDenial(sdkError(name, message))).toBe(false);
  });

  it('is false for things that are not errors', () => {
    expect(isPlatformIamDenial(undefined)).toBe(false);
    expect(isPlatformIamDenial('AccessDenied: no identity-based policy allows')).toBe(false);
  });
});

describe('assumeRoleAsPlatform', () => {
  it('turns a platform credential failure into PlatformAwsCredentialsUnavailableError, never AWS_NOT_CONNECTED, and logs it greppably', async () => {
    const cause = sdkError('CredentialsProviderError', 'Could not load credentials from any providers');
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => { throw cause; });

    const thrown = await assumeRoleAsPlatform('us-east-1', INPUT, 'Unit test org 1').catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(PlatformAwsCredentialsUnavailableError);
    expect(isPlatformAwsCredentialsUnavailable(thrown)).toBe(true);
    const error = thrown as PlatformAwsCredentialsUnavailableError;
    expect(error.code).toBe(PLATFORM_AWS_CREDENTIALS_UNAVAILABLE);
    expect(error.message.startsWith(`${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}:`)).toBe(true);
    expect(error.message).not.toContain('AWS_NOT_CONNECTED');
    expect(error.cause).toBe(cause);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [line, detail] = consoleError.mock.calls[0];
    expect(line).toBe(`[${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}] Unit test org 1: platform AWS identity unavailable`);
    expect(detail).toEqual({ region: 'us-east-1', name: 'CredentialsProviderError', message: 'Could not load credentials from any providers' });
  });

  it.each(PLATFORM_SIDE_DENIALS)('an AccessDenied from %s: PlatformAwsCredentialsUnavailableError, logged under PLATFORM_AWS_IAM_DENIED with the AWS message', async (_label, name, message) => {
    const denied = sdkError(name, message);
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => { throw denied; });

    const thrown = await assumeRoleAsPlatform('us-east-1', INPUT, 'Unit test org 2').catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(PlatformAwsCredentialsUnavailableError);
    expect((thrown as Error).message).not.toContain('AWS_NOT_CONNECTED');
    expect((thrown as PlatformAwsCredentialsUnavailableError).cause).toBe(denied);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [line, detail] = consoleError.mock.calls[0];
    expect(line).toBe(`[${PLATFORM_AWS_IAM_DENIED}] Unit test org 2: the platform's IAM policies refused sts:AssumeRole`);
    expect(detail).toEqual({ region: 'us-east-1', name, message });
  });

  it.each(ORGANIZATION_SIDE_DENIALS)('an AccessDenied from %s: rethrown unchanged for the existing handling, nothing logged here', async (_label, name, message) => {
    const denied = sdkError(name, message);
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => { throw denied; });

    await expect(assumeRoleAsPlatform('us-east-1', INPUT, 'test')).rejects.toBe(denied);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('rethrows an AssumeRole failure unchanged and logs nothing under the platform marker', async () => {
    const denied = sdkError('AccessDenied', 'User is not authorized to perform: sts:AssumeRole');
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => { throw denied; });

    await expect(assumeRoleAsPlatform('us-east-1', INPUT, 'test')).rejects.toBe(denied);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('in the local stack (DEVCONTROL_LOCAL_STACK=1), refuses before any STS request, as a platform credential failure', async () => {
    const send = jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => ({}));
    process.env.DEVCONTROL_LOCAL_STACK = '1';
    try {
      const err = await assumeRoleAsPlatform('us-east-1', INPUT, 'test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformAwsCredentialsUnavailableError);
      expect(isPlatformAwsCredentialsUnavailable(err)).toBe(true);
      expect(send).not.toHaveBeenCalled();
      expect(consoleError.mock.calls[0][0]).toContain(`[${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}] test: AWS is disabled in the local stack`);
    } finally {
      delete process.env.DEVCONTROL_LOCAL_STACK;
    }
  });

  it('with every credential source switched off, the real default chain fails in a shape classified as a platform credential failure', () => {
    // Run in a plain Node process: under Jest the chain's dynamic imports fail
    // with a TypeError of Jest's own. No keys, no readable profile or config
    // file, no web identity or container credentials, and instance metadata
    // disabled: the chain fails locally, without a network call.
    const script = `
      const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
      new STSClient({ region: 'ap-southeast-2' })
        .send(new AssumeRoleCommand(${JSON.stringify(INPUT)}))
        .then(() => console.log(JSON.stringify({ resolved: true })), (e) => console.log(JSON.stringify({ name: e.name, message: e.message })));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        PATH: process.env.PATH,
        HOME: '/nonexistent/devcontrol-test',
        AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/devcontrol-test/credentials',
        AWS_CONFIG_FILE: '/nonexistent/devcontrol-test/config',
        AWS_EC2_METADATA_DISABLED: 'true',
      },
    });
    const failure = JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}');

    expect(failure).toEqual({ name: 'CredentialsProviderError', message: 'Could not load credentials from any providers' });
    expect(isPlatformCredentialFailure(sdkError(failure.name, failure.message))).toBe(true);
  });
});

describe('expiring platform credentials whose source then disappears (the instance role failing to refresh)', () => {
  // The SDK refreshes credentials that are within five minutes of expiry in
  // the background on a client it has already resolved them for; if that
  // refresh fails, nothing handles the rejection and Node ends the process.
  // A plain Node child process (not Jest, which would intercept the
  // rejection) runs the scenario: credentials that expire in two minutes,
  // one call, the credential source removed, another call, then a pause
  // long enough for any background refresh to settle.
  const CHILD = `
    const fs = require('fs');
    const Module = require('module');
    const path = require('path');
    const ts = require('typescript');
    const { STSClient } = require('@aws-sdk/client-sts');

    // Every send() records its client, resolves that client's credentials as
    // signing would, then answers locally: nothing leaves the process.
    const clients = new Set();
    STSClient.prototype.send = async function () {
      clients.add(this);
      await this.config.credentials();
      return { Credentials: { AccessKeyId: 'ASIATEMPORARYEXAMPLE', SecretAccessKey: 'temporary', SessionToken: 'temporary' } };
    };

    Object.assign(process.env, {
      AWS_ACCESS_KEY_ID: 'ASIAPLATFORMEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'platform-secret-not-a-credential',
      AWS_SESSION_TOKEN: 'platform-session-not-a-credential',
      AWS_CREDENTIAL_EXPIRATION: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    const removeCredentialSource = () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AWS_SESSION_TOKEN;
    };
    const INPUT = ${JSON.stringify(INPUT)};
    const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

    (async () => {
      const results = [];
      if (process.env.SCENARIO === 'platform-sts') {
        const src = process.env.PLATFORM_STS_SOURCE;
        const js = ts.transpileModule(fs.readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const platformSts = new Module(src);
        platformSts.filename = src;
        platformSts.paths = Module._nodeModulePaths(path.dirname(src));
        platformSts._compile(js, src);
        const { assumeRoleAsPlatform } = platformSts.exports;
        const call = () => assumeRoleAsPlatform('us-east-1', INPUT, 'child').then(() => 'ok', (e) => e.name);
        results.push(await call());
        results.push(await call());
        removeCredentialSource();
        results.push(await call());
      } else {
        // Control: the pattern this replaced -- one client held across calls.
        const held = new STSClient({ region: 'us-east-1' });
        const call = () => held.send({}).then(() => 'ok', (e) => e.name);
        results.push(await call());
        removeCredentialSource();
        results.push(await call());
      }
      await settle();
      console.log(JSON.stringify({ results, clients: clients.size, alive: true }));
    })();
  `;

  function runChild(scenario: 'platform-sts' | 'held-client') {
    const result = spawnSync(process.execPath, ['-e', CHILD], {
      cwd: path.join(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      timeout: 60000,
      env: {
        PATH: process.env.PATH,
        HOME: '/nonexistent/devcontrol-test',
        AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/devcontrol-test/credentials',
        AWS_CONFIG_FILE: '/nonexistent/devcontrol-test/config',
        AWS_EC2_METADATA_DISABLED: 'true',
        SCENARIO: scenario,
        PLATFORM_STS_SOURCE: path.join(__dirname, '..', 'platform-sts.ts'),
      },
    });
    const last = result.stdout.trim().split('\n').pop() ?? '';
    return { status: result.status, stderr: result.stderr, report: last.startsWith('{') ? JSON.parse(last) : null };
  }

  it('assumeRoleAsPlatform builds a client per call, reports the failure to the caller, and the process stays alive and exits 0', () => {
    const { status, report, stderr } = runChild('platform-sts');

    expect([status, stderr.includes('Unhandled') ? stderr : '']).toEqual([0, '']);
    expect(report).toEqual({
      results: ['ok', 'ok', 'PlatformAwsCredentialsUnavailableError'],
      clients: 3, // a distinct client for each of the three calls
      alive: true,
    });
  });

  it('control: a client held across calls is ended by the failed background refresh (proves the test above can fail)', () => {
    const { status, report, stderr } = runChild('held-client');

    expect(status).not.toBe(0);
    expect(report).toBeNull();
    expect(stderr).toContain('Could not load credentials from any providers');
  });
});
