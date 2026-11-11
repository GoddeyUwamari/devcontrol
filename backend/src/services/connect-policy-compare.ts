/**
 * The policy-set compare (AWS connect PR D1, CP-D4, CP-D8, D1-D8): which
 * policies the connected role has, against the recommended set the Connect
 * page shows (SecurityAudit, job-function/ViewOnlyAccess and the inline
 * DevControlReadExtras in lib/aws/customer-role-inline-policy.json).
 *
 * Three IAM reads on the role itself, all read-only and granted by
 * SecurityAudit (the two List calls also by ViewOnlyAccess); none is in the
 * inline policy's Deny (connect-d1-step1.md §3). No policy simulation, and
 * nothing here can see service control policies or permission boundaries.
 *
 * The only module that constructs these IAM commands. GetRolePolicy's
 * document is compared in memory and dropped: it is never stored, logged or
 * returned; the result holds fixed verdicts, AWS-managed policy names (public)
 * and counts only. Inline policy names and customer-managed policy ARNs are
 * the customer's own and are only counted.
 */
import { createHash } from 'crypto';
import { GetRolePolicyCommand, ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from '@aws-sdk/client-iam';
// A copy of lib/aws/customer-role-inline-policy.json (the backend builds from src/ only);
// connect-policy-compare.test.ts fails unless the two are identical.
import CUSTOMER_ROLE_INLINE_POLICY from '../config/customer-role-inline-policy.json';

export const SECURITY_AUDIT_ARN = 'arn:aws:iam::aws:policy/SecurityAudit';
export const VIEW_ONLY_ACCESS_ARN = 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess';
export const READ_ONLY_ACCESS_ARN = 'arn:aws:iam::aws:policy/ReadOnlyAccess';
export const READ_EXTRAS_POLICY_NAME = 'DevControlReadExtras';
const AWS_MANAGED_PREFIX = 'arn:aws:iam::aws:policy/';

/** At most this many pages per listing: a role holds at most 20 managed policies [U2]. */
export const MAX_PAGES = 3;
const PAGE_SIZE = 100;

/** The permission contract the compare checks against (D1-D8). D2's template v2 bumps it. */
export const CUSTOMER_ROLE_CONTRACT_VERSION = 1;

export type ReadExtrasVerdict = 'matches' | 'differs' | 'missing' | 'unreadable';

export type PolicyCompareResult =
  | {
      unreadable: false;
      securityAudit: 'attached' | 'missing';
      viewOnlyAccess: 'attached' | 'missing';
      readExtras: ReadExtrasVerdict;
      readOnlyAccess: boolean;
      /** Other AWS-managed policies attached, by name (public names). */
      otherAwsManaged: string[];
      /** Customer-managed policies and inline policies other than DevControlReadExtras. */
      otherCount: number;
      contractVersion: number;
    }
  | { unreadable: true; contractVersion: number };

/** A client that can send one IAM command. */
export type IamSender = { send: (command: any, options?: { abortSignal?: AbortSignal }) => Promise<any> };

/** The role name the IAM API takes: the last segment of the role ARN (a path is not part of it). */
export function roleNameOf(roleArn: string): string | null {
  const match = /^arn:aws:iam::\d{12}:role\/(?:.*\/)?([\w+=,.@-]+)$/.exec(roleArn);
  return match ? match[1] : null;
}

type Statement = { effect: string; actions: string[]; notActions: string[]; resources: string[]; notResources: string[]; condition: string };

const asList = (v: unknown): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

/** A key-sorted JSON rendering, for comparing Condition blocks. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * A policy document in a canonical form: statements in a fixed order, actions
 * lower-cased and sorted, a string equal to a one-element list, Sid ignored.
 * Null when the document is not a policy (not JSON, no Statement list).
 */
export function canonicalPolicy(document: unknown): string | null {
  if (!document || typeof document !== 'object') return null;
  const raw = (document as { Statement?: unknown }).Statement;
  const statements = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null;
  if (!statements) return null;
  const canon: Statement[] = [];
  for (const s of statements) {
    if (!s || typeof s !== 'object') return null;
    const st = s as Record<string, unknown>;
    canon.push({
      effect: String(st.Effect ?? ''),
      actions: asList(st.Action).map((a) => a.toLowerCase()).sort(),
      notActions: asList(st.NotAction).map((a) => a.toLowerCase()).sort(),
      resources: asList(st.Resource).sort(),
      notResources: asList(st.NotResource).sort(),
      condition: stableJson(st.Condition ?? null),
    });
  }
  return JSON.stringify(canon.map((c) => JSON.stringify(c)).sort());
}

/** The recommended DevControlReadExtras for `accountId`, canonical. */
export function expectedReadExtras(accountId: string): string {
  const doc = JSON.parse(JSON.stringify(CUSTOMER_ROLE_INLINE_POLICY).split('<ACCOUNT_ID>').join(accountId));
  return canonicalPolicy(doc)!;
}

/** SHA-256 of the canonical contract JSON (placeholder kept), pinned by a test to CUSTOMER_ROLE_CONTRACT_VERSION. */
export function contractFingerprint(): string {
  return createHash('sha256').update(canonicalPolicy(CUSTOMER_ROLE_INLINE_POLICY)!).digest('hex');
}

/** GetRolePolicy returns the document URL-encoded. Null when it does not parse. */
export function parsePolicyDocument(encoded: unknown): unknown | null {
  if (typeof encoded !== 'string') return null;
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    try {
      return JSON.parse(encoded);
    } catch {
      return null;
    }
  }
}

/** Whether the inline document matches the contract for `accountId`. Only the verdict leaves this function. */
export function readExtrasVerdict(encodedDocument: unknown, accountId: string): 'matches' | 'differs' {
  const canonical = canonicalPolicy(parsePolicyDocument(encodedDocument));
  return canonical !== null && canonical === expectedReadExtras(accountId) ? 'matches' : 'differs';
}

class PageCapExceeded extends Error {}

async function listAll<T>(fetchPage: (marker: string | undefined) => Promise<{ items: T[]; truncated: boolean; marker?: string }>): Promise<T[]> {
  const all: T[] = [];
  let marker: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(marker);
    all.push(...result.items);
    if (!result.truncated || !result.marker) return all;
    marker = result.marker;
  }
  throw new PageCapExceeded('listing exceeded its page cap');
}

/** Error names AWS uses for "your permissions do not allow this" (the probes' narrow rule). */
const DENIED = new Set(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation']);
const isDenied = (error: unknown) => {
  const e = (error ?? {}) as { name?: unknown; Code?: unknown };
  return [e.name, e.Code].some((n) => typeof n === 'string' && DENIED.has(n));
};

/** Each call is cancelled after this long; the IAM client is built with maxAttempts 1. */
export const COMPARE_CALL_TIMEOUT_MS = 5_000;

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(`IAM call exceeded ${timeoutMs} ms`), { name: 'TimeoutError' }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Compares the role's policies with the recommended set. Never throws: any
 * failure to list the role's policies is `unreadable`; a refused or failed read
 * of DevControlReadExtras alone is readExtras `unreadable`. `context` names the
 * caller in logs (no secret); errors are logged by name only.
 */
export async function compareRolePolicies(params: {
  iam: IamSender;
  roleArn: string;
  accountId: string;
  context: string;
  timeoutMs?: number;
}): Promise<PolicyCompareResult> {
  const timeoutMs = params.timeoutMs ?? COMPARE_CALL_TIMEOUT_MS;
  const unreadable: PolicyCompareResult = { unreadable: true, contractVersion: CUSTOMER_ROLE_CONTRACT_VERSION };
  const roleName = roleNameOf(params.roleArn);
  if (!roleName || !/^\d{12}$/.test(params.accountId)) return unreadable;
  const send = (command: unknown) => withTimeout((signal) => params.iam.send(command, { abortSignal: signal }), timeoutMs);
  const logFailure = (what: string, error: unknown) => {
    const name = (error as { name?: unknown } | null)?.name;
    console.warn(`[Policy compare] ${what}: ${isDenied(error) ? 'denied' : 'failed'} (${typeof name === 'string' ? name.slice(0, 64) : 'unknown error'}) for ${params.context}`);
  };

  let attachedArns: string[];
  let inlineNames: string[];
  try {
    attachedArns = await listAll<string>(async (marker) => {
      const page = await send(new ListAttachedRolePoliciesCommand({ RoleName: roleName, Marker: marker, MaxItems: PAGE_SIZE }));
      return {
        items: (page?.AttachedPolicies ?? []).map((p: { PolicyArn?: string }) => String(p?.PolicyArn ?? '')),
        truncated: page?.IsTruncated === true,
        marker: page?.Marker,
      };
    });
    inlineNames = await listAll<string>(async (marker) => {
      const page = await send(new ListRolePoliciesCommand({ RoleName: roleName, Marker: marker, MaxItems: PAGE_SIZE }));
      return { items: (page?.PolicyNames ?? []).map(String), truncated: page?.IsTruncated === true, marker: page?.Marker };
    });
  } catch (error: unknown) {
    logFailure('listing the role policies', error);
    return unreadable;
  }

  let readExtras: ReadExtrasVerdict = 'missing';
  if (inlineNames.includes(READ_EXTRAS_POLICY_NAME)) {
    try {
      const policy = await send(new GetRolePolicyCommand({ RoleName: roleName, PolicyName: READ_EXTRAS_POLICY_NAME }));
      readExtras = readExtrasVerdict(policy?.PolicyDocument, params.accountId);
    } catch (error: unknown) {
      logFailure('reading DevControlReadExtras', error);
      readExtras = 'unreadable';
    }
  }

  const known = new Set([SECURITY_AUDIT_ARN, VIEW_ONLY_ACCESS_ARN, READ_ONLY_ACCESS_ARN]);
  const otherManaged = attachedArns.filter((arn) => !known.has(arn));
  const otherAwsManaged = otherManaged
    .filter((arn) => arn.startsWith(AWS_MANAGED_PREFIX))
    .map((arn) => arn.slice(arn.lastIndexOf('/') + 1))
    .filter((name) => /^[\w+=,.@-]{1,128}$/.test(name))
    .sort();
  const otherCount = otherManaged.length - otherAwsManaged.length + inlineNames.filter((n) => n !== READ_EXTRAS_POLICY_NAME).length;

  return {
    unreadable: false,
    securityAudit: attachedArns.includes(SECURITY_AUDIT_ARN) ? 'attached' : 'missing',
    viewOnlyAccess: attachedArns.includes(VIEW_ONLY_ACCESS_ARN) ? 'attached' : 'missing',
    readExtras,
    readOnlyAccess: attachedArns.includes(READ_ONLY_ACCESS_ARN),
    otherAwsManaged,
    otherCount,
    contractVersion: CUSTOMER_ROLE_CONTRACT_VERSION,
  };
}
