/**
 * The connect flow's role check: sts:AssumeRole into the role an owner pasted,
 * with the organization's External ID, retried only where waiting can help.
 *
 * Every failure is classified (classifyAssumeRoleError) before anything is retried:
 *
 *   platform      the platform's own AWS identity is unavailable or its IAM
 *                 policies refused (platform-sts.ts). Never retried, and never
 *                 the customer's problem.
 *   trust_denied  AccessDenied from the role's side. AWS answers this one way for
 *                 four different causes: a role that IAM is still propagating, an
 *                 ExternalId that does not match, a trust policy that does not
 *                 name DevControl's account, and a role that does not exist. The
 *                 error carries nothing that separates them, so it is retried
 *                 for a bounded window (founder decision, 2026-11-03). A real
 *                 mismatch therefore fails after that window, with the same safe
 *                 message.
 *   transient     throttling, an AWS 5xx, a network error or an attempt that hit
 *                 its time limit. Retried in the same window.
 *   not_found     NoSuchEntity. Never retried.
 *   permanent     anything else (validation errors, a disabled region, a
 *                 malformed request). Never retried.
 *
 * An ARN that is malformed or does not name a DevControlRole is refused before
 * this module runs (aws.routes.ts, devcontrolRoleArn.ts), so it is never retried.
 *
 * Backoff: baseDelayMs * 2^(n-1), capped at maxDelayMs, with jitter (50-100 % of
 * that value). A retry is made only if it can START within maxElapsedMs of the
 * first attempt; each attempt is cancelled after attemptTimeoutMs. Worst case
 * the check therefore takes maxElapsedMs + attemptTimeoutMs. The caller's
 * AbortSignal (the HTTP client went away) stops it between and during attempts.
 *
 * Logs carry the error's name, code, HTTP status, request ID and the attempt
 * number, and, for the attempt the check gives up on only, AWS's message (server
 * log only, as before). Never the ExternalId or credentials.
 */
import { assumeRoleAsPlatform, isPlatformAwsCredentialsUnavailable } from './platform-sts';
import { isThrottlingError } from '../utils/awsCallPolicy';

/** The AssumeRole request and response, as platform-sts.ts (the one STS module) types them. */
type AssumeRoleCommandInput = Parameters<typeof assumeRoleAsPlatform>[1];
type AssumeRoleCommandOutput = Awaited<ReturnType<typeof assumeRoleAsPlatform>>;

export type AssumeRoleErrorKind = 'platform' | 'trust_denied' | 'transient' | 'not_found' | 'permanent';

export type RoleCheckFailure =
  /** The platform's own AWS identity is unavailable. */
  | 'platform_unavailable'
  /** AccessDenied on every attempt in the window. */
  | 'role_not_assumable'
  /** AWS was throttling, failing or unreachable for the whole window. */
  | 'aws_unavailable'
  /** NoSuchEntity. */
  | 'role_not_found'
  /** A permanent AWS refusal other than the above. */
  | 'role_check_failed'
  /** The caller cancelled (the HTTP client disconnected). */
  | 'cancelled';

export interface TemporaryRoleCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export type RoleCheckResult =
  | { ok: true; attempts: number; credentials: TemporaryRoleCredentials | null }
  | { ok: false; failure: RoleCheckFailure; attempts: number };

export interface RoleCheckPolicy {
  /** A retry is started only if it can start within this many ms of the first attempt. */
  maxElapsedMs: number;
  /** Each attempt is aborted after this many ms. */
  attemptTimeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** In [0, 1). */
  random: () => number;
  now: () => number;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export const DEFAULT_ROLE_CHECK_POLICY: RoleCheckPolicy = {
  maxElapsedMs: 20_000,
  attemptTimeoutMs: 5_000,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
  random: Math.random,
  now: Date.now,
  sleep: abortableSleep,
};

/** The wait before retry `retry` (1-based): exponential, capped, jittered to 50-100 % of the value. */
export function roleCheckBackoffMs(retry: number, policy: Pick<RoleCheckPolicy, 'baseDelayMs' | 'maxDelayMs' | 'random'>): number {
  const capped = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (retry - 1));
  return Math.round(capped * (0.5 + policy.random() * 0.5));
}

const TRUST_DENIED_NAMES = new Set(['AccessDenied', 'AccessDeniedException']);
const NETWORK_ERROR_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutException', 'NetworkingError', 'AbortError']);
const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH']);

/** Which of the five kinds an AssumeRole failure is. */
export function classifyAssumeRoleError(error: unknown): AssumeRoleErrorKind {
  if (isPlatformAwsCredentialsUnavailable(error)) return 'platform';
  const e = (error ?? {}) as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } };
  const names = [e.name, e.Code, e.code].filter((n): n is string => typeof n === 'string');
  if (names.some((n) => TRUST_DENIED_NAMES.has(n))) return 'trust_denied';
  if (names.includes('NoSuchEntity')) return 'not_found';
  if (isThrottlingError(error)) return 'transient';
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === 'number' && status >= 500) return 'transient';
  if (names.some((n) => NETWORK_ERROR_NAMES.has(n) || NETWORK_ERROR_CODES.has(n))) return 'transient';
  return 'permanent';
}

type AssumeFn = (input: AssumeRoleCommandInput, abortSignal: AbortSignal) => Promise<AssumeRoleCommandOutput>;

/** One AssumeRole attempt, aborted after `timeoutMs` or when `outer` aborts. */
async function attemptWithTimeout(assume: AssumeFn, input: AssumeRoleCommandInput, timeoutMs: number, outer?: AbortSignal): Promise<AssumeRoleCommandOutput> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      assume(input, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const timeout = new Error(`AssumeRole attempt exceeded ${timeoutMs} ms`);
          timeout.name = 'TimeoutError';
          reject(timeout);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * A retried attempt is logged by name only. The attempt the check gives up on is
 * logged as before this module existed, AWS's message included: server log only,
 * where it shows which policy refused. It names the platform principal and the
 * role ARN, never the ExternalId.
 */
function logAttempt(context: string, attempt: number, kind: AssumeRoleErrorKind, error: unknown, final: boolean): void {
  const e = (error ?? {}) as { name?: unknown; Code?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown; requestId?: unknown } };
  const fields = { name: e.name, code: e.Code, httpStatusCode: e.$metadata?.httpStatusCode, requestId: e.$metadata?.requestId };
  if (final) {
    console.error('[Connect AWS] STS validation failed:', { ...fields, message: e.message, kind, attempts: attempt, context });
  } else {
    console.error(`[Connect AWS] Role check attempt ${attempt} failed (${kind}), retrying, for ${context}:`, fields);
  }
}

const FAILURE_FOR_KIND: Record<AssumeRoleErrorKind, RoleCheckFailure> = {
  platform: 'platform_unavailable',
  trust_denied: 'role_not_assumable',
  transient: 'aws_unavailable',
  not_found: 'role_not_found',
  permanent: 'role_check_failed',
};

const RETRIED: ReadonlySet<AssumeRoleErrorKind> = new Set(['trust_denied', 'transient']);

/**
 * Checks that DevControl can assume `roleArn` with `externalId`. Never throws for
 * an AWS failure; returns the classified outcome. `context` names the caller in
 * logs and must carry no secret.
 */
export async function checkConnectRole(params: {
  region: string;
  roleArn: string;
  externalId: string;
  context: string;
  signal?: AbortSignal;
  policy?: RoleCheckPolicy;
  assume?: AssumeFn;
}): Promise<RoleCheckResult> {
  const policy = params.policy ?? DEFAULT_ROLE_CHECK_POLICY;
  const assume: AssumeFn = params.assume
    ?? ((input, abortSignal) => assumeRoleAsPlatform(params.region, input, params.context, { abortSignal }));
  const input: AssumeRoleCommandInput = {
    RoleArn: params.roleArn,
    RoleSessionName: 'devcontrol-validation',
    ExternalId: params.externalId,
    DurationSeconds: 900,
  };
  const startedAt = policy.now();

  for (let attempt = 1; ; attempt++) {
    if (params.signal?.aborted) return { ok: false, failure: 'cancelled', attempts: attempt - 1 };
    try {
      const output = await attemptWithTimeout(assume, input, policy.attemptTimeoutMs, params.signal);
      const c = output?.Credentials;
      const credentials = c?.AccessKeyId && c.SecretAccessKey && c.SessionToken
        ? { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken }
        : null;
      return { ok: true, attempts: attempt, credentials };
    } catch (error: unknown) {
      if (params.signal?.aborted) return { ok: false, failure: 'cancelled', attempts: attempt };
      const kind = classifyAssumeRoleError(error);
      const delay = roleCheckBackoffMs(attempt, policy);
      const canRetry = RETRIED.has(kind) && policy.now() - startedAt + delay <= policy.maxElapsedMs;
      if (kind !== 'platform') logAttempt(params.context, attempt, kind, error, !canRetry);
      if (!canRetry) return { ok: false, failure: FAILURE_FOR_KIND[kind], attempts: attempt };
      await policy.sleep(delay, params.signal);
    }
  }
}
