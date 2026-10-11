/**
 * The platform's own STS client, and the one way it is used: sts:AssumeRole
 * into an organization's connected role.
 *
 * The client is built with a region only, so the SDK's default credential
 * chain supplies the platform identity (env keys where they are set, the
 * instance role in production). One client is kept per region for the life
 * of the process: each client memoizes the credentials its chain resolves,
 * so reusing it avoids a fresh chain -- and, on the instance role, fresh
 * instance-metadata calls -- for every AssumeRole.
 *
 * A failure to resolve or use the platform's own identity is not the
 * organization's problem: it is logged under PLATFORM_AWS_CREDENTIALS_UNAVAILABLE
 * and thrown as PlatformAwsCredentialsUnavailableError, never as
 * AWS_NOT_CONNECTED, so no caller tells a connected organization to reconnect.
 * Every other AssumeRole failure (AccessDenied, trust policy or ExternalId
 * mismatch, a deleted role) is rethrown unchanged for the caller to classify.
 */
import { STSClient, AssumeRoleCommand, type AssumeRoleCommandInput, type AssumeRoleCommandOutput } from '@aws-sdk/client-sts';

export const PLATFORM_AWS_CREDENTIALS_UNAVAILABLE = 'PLATFORM_AWS_CREDENTIALS_UNAVAILABLE';

/** What a connected organization is told when the platform's own AWS identity is unavailable. */
export const PLATFORM_AWS_UNAVAILABLE_MESSAGE = 'DevControl cannot reach AWS right now. This is not a problem with your AWS account or role; please try again shortly.';

export class PlatformAwsCredentialsUnavailableError extends Error {
  readonly code = PLATFORM_AWS_CREDENTIALS_UNAVAILABLE;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}: the platform's AWS identity could not be resolved or was rejected`);
    this.name = 'PlatformAwsCredentialsUnavailableError';
    this.cause = cause;
  }
}

export function isPlatformAwsCredentialsUnavailable(err: unknown): err is PlatformAwsCredentialsUnavailableError {
  return err instanceof PlatformAwsCredentialsUnavailableError;
}

/** Thrown by the SDK's credential providers (default chain, instance metadata, container metadata). */
const PROVIDER_ERROR_NAMES = new Set(['CredentialsProviderError', 'ProviderError', 'TokenProviderError']);
/** STS rejecting the caller's own credentials -- the platform's, not the organization's role. */
const PLATFORM_CREDENTIAL_REJECTED = new Set(['InvalidClientTokenId', 'ExpiredToken', 'ExpiredTokenException', 'SignatureDoesNotMatch']);

/**
 * Whether an error from a platform STS call means the platform's own identity
 * is unavailable: credentials could not be resolved, or STS rejected them.
 */
export function isPlatformCredentialFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (typeof name === 'string' && (PROVIDER_ERROR_NAMES.has(name) || PLATFORM_CREDENTIAL_REJECTED.has(name))) return true;
  return typeof message === 'string' && /Could not load credentials from any providers/.test(message);
}

const platformStsClients = new Map<string, STSClient>();

/** The process-wide platform STS client for a region: region only, no credentials. */
export function getPlatformStsClient(region: string): STSClient {
  let client = platformStsClients.get(region);
  if (!client) {
    client = new STSClient({ region });
    platformStsClients.set(region, client);
  }
  return client;
}

/** Tests only: forget the cached clients so each test constructs its own. */
export function resetPlatformStsClientsForTests(): void {
  platformStsClients.clear();
}

/**
 * sts:AssumeRole as the platform. `context` names the caller in the
 * PLATFORM_AWS_CREDENTIALS_UNAVAILABLE log line; it must carry no secret.
 */
export async function assumeRoleAsPlatform(region: string, input: AssumeRoleCommandInput, context: string): Promise<AssumeRoleCommandOutput> {
  try {
    return await getPlatformStsClient(region).send(new AssumeRoleCommand(input));
  } catch (err: unknown) {
    if (!isPlatformCredentialFailure(err)) throw err;
    const { name, message } = err as { name?: string; message?: string };
    console.error(`[${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}] ${context}: platform AWS identity unavailable`, { region, name, message });
    throw new PlatformAwsCredentialsUnavailableError(err);
  }
}
