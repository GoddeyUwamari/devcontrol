/**
 * The platform's shared STS client and how its failures are classified.
 *
 *   - One client per region for the life of the process, built with a region
 *     only, so the SDK's default chain (and its memoized credentials) is
 *     reused rather than rebuilt for every AssumeRole.
 *   - A failure to resolve or use the platform's own identity becomes
 *     PlatformAwsCredentialsUnavailableError, logged under
 *     PLATFORM_AWS_CREDENTIALS_UNAVAILABLE, and is never AWS_NOT_CONNECTED.
 *   - Every other AssumeRole failure is rethrown unchanged.
 *
 * No request leaves the process: send() is stubbed, except in the one test
 * that lets the real default chain fail, in a child process, with every
 * credential source switched off.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { STSClient } from '@aws-sdk/client-sts';
import {
  assumeRoleAsPlatform,
  getPlatformStsClient,
  isPlatformAwsCredentialsUnavailable,
  isPlatformCredentialFailure,
  PlatformAwsCredentialsUnavailableError,
  PLATFORM_AWS_CREDENTIALS_UNAVAILABLE,
  resetPlatformStsClientsForTests,
} from '../platform-sts';

const INPUT = { RoleArn: 'arn:aws:iam::123456789012:role/DevControlRole', RoleSessionName: 's', ExternalId: 'external-id-1' };

/** An error shaped as the SDK throws it: its class is carried in `name`. */
function sdkError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  resetPlatformStsClientsForTests();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getPlatformStsClient', () => {
  it('returns the same client for the same region, every time', () => {
    const first = getPlatformStsClient('us-east-1');
    expect(first).toBeInstanceOf(STSClient);
    expect(getPlatformStsClient('us-east-1')).toBe(first);
  });

  it('returns a different client for a different region, each on its own region', async () => {
    const east = getPlatformStsClient('us-east-1');
    const west = getPlatformStsClient('eu-west-1');
    expect(west).not.toBe(east);
    expect(await east.config.region()).toBe('us-east-1');
    expect(await west.config.region()).toBe('eu-west-1');
  });

  it('sends every AssumeRole for a region through that one client', async () => {
    const send = jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => ({}));
    await assumeRoleAsPlatform('us-east-1', INPUT, 'test');
    await assumeRoleAsPlatform('us-east-1', INPUT, 'test');
    await assumeRoleAsPlatform('eu-west-1', INPUT, 'test');

    expect(send).toHaveBeenCalledTimes(3);
    const clients = send.mock.contexts;
    expect(clients[0]).toBe(getPlatformStsClient('us-east-1'));
    expect(clients[1]).toBe(clients[0]);
    expect(clients[2]).toBe(getPlatformStsClient('eu-west-1'));
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

  it('rethrows an AssumeRole failure unchanged and logs nothing under the platform marker', async () => {
    const denied = sdkError('AccessDenied', 'User is not authorized to perform: sts:AssumeRole');
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => { throw denied; });

    await expect(assumeRoleAsPlatform('us-east-1', INPUT, 'test')).rejects.toBe(denied);
    expect(consoleError).not.toHaveBeenCalled();
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
