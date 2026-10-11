/**
 * The platform's own STS client, and the one way it is used: sts:AssumeRole
 * into an organization's connected role.
 *
 * The client is built with a region only, so the SDK's default credential
 * chain supplies the platform identity (env keys where they are set, the
 * instance role in production). A new client is built for every AssumeRole
 * and never kept: a long-lived client refreshes expiring credentials (the
 * instance role's) in the background, and a failed background refresh is an
 * unhandled promise rejection that ends the process. A fresh client always
 * resolves its credentials in the foreground, where a failure reaches the
 * caller and is classified below.
 *
 * A failure to resolve or use the platform's own identity is not the
 * organization's problem: it is logged under PLATFORM_AWS_CREDENTIALS_UNAVAILABLE
 * (or PLATFORM_AWS_IAM_DENIED, when the platform's own IAM policies refuse the
 * AssumeRole) and thrown as PlatformAwsCredentialsUnavailableError, never as
 * AWS_NOT_CONNECTED, so no caller tells a connected organization to reconnect.
 * Every other AssumeRole failure (an AccessDenied from the role's trust
 * policy or an ExternalId mismatch, a deleted role) is rethrown unchanged for
 * the caller to classify.
 */
import { STSClient, AssumeRoleCommand, type AssumeRoleCommandInput, type AssumeRoleCommandOutput } from '@aws-sdk/client-sts';

export const PLATFORM_AWS_CREDENTIALS_UNAVAILABLE = 'PLATFORM_AWS_CREDENTIALS_UNAVAILABLE';
/** Log tag for an AssumeRole refused by a policy evaluated on the platform's side. */
export const PLATFORM_AWS_IAM_DENIED = 'PLATFORM_AWS_IAM_DENIED';

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

const ACCESS_DENIED_NAMES = new Set(['AccessDenied', 'AccessDeniedException']);
/**
 * Policy types AWS names in an AccessDenied that are evaluated on the
 * caller's (the platform's) side. A resource control policy belongs to the
 * role's account, and a trust-policy refusal names no policy type, so
 * neither matches.
 */
const PLATFORM_SIDE_POLICY = /identity-based policy|permissions boundary|service control policy|session policy/i;

/**
 * Whether an AssumeRole AccessDenied was caused by the platform's own IAM
 * policies (e.g. its identity policy does not allow sts:AssumeRole on the
 * role) rather than by the organization's role.
 */
export function isPlatformIamDenial(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return typeof name === 'string' && ACCESS_DENIED_NAMES.has(name)
    && typeof message === 'string' && PLATFORM_SIDE_POLICY.test(message);
}

/**
 * sts:AssumeRole as the platform, on a new region-only STS client. `context`
 * names the caller in the log line; it must carry no secret.
 */
export async function assumeRoleAsPlatform(region: string, input: AssumeRoleCommandInput, context: string): Promise<AssumeRoleCommandOutput> {
  try {
    return await new STSClient({ region }).send(new AssumeRoleCommand(input));
  } catch (err: unknown) {
    const { name, message } = (err ?? {}) as { name?: string; message?: string };
    if (isPlatformIamDenial(err)) {
      // Server log only: the AWS message names the platform's own principal.
      console.error(`[${PLATFORM_AWS_IAM_DENIED}] ${context}: the platform's IAM policies refused sts:AssumeRole`, { region, name, message });
      throw new PlatformAwsCredentialsUnavailableError(err);
    }
    if (!isPlatformCredentialFailure(err)) throw err;
    console.error(`[${PLATFORM_AWS_CREDENTIALS_UNAVAILABLE}] ${context}: platform AWS identity unavailable`, { region, name, message });
    throw new PlatformAwsCredentialsUnavailableError(err);
  }
}
