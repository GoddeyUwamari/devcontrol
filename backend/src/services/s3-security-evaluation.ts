/**
 * S3 bucket security evaluation: public access (bucket policy, ACL) and
 * HTTPS-only enforcement.
 *
 * Every control evaluates to exactly one of:
 *   - 'pass'    -- the evidence proves the control is in place;
 *   - 'fail'    -- the evidence proves the control is missing or an exposure exists;
 *   - 'unknown' -- the evidence is unavailable (AccessDenied, any API error, a client
 *                  that was not provided) or inconclusive.
 * Only 'fail' produces a finding. 'unknown' never does, and is never reported as a
 * pass: the caller carries a previous finding forward as unverified instead (see
 * carryForwardUnverifiedS3Findings).
 *
 * The presence of a bucket policy, a wildcard principal, or an ACL grant is not by
 * itself proof of exposure. Policy publicness comes from AWS's own evaluation
 * (GetBucketPolicyStatus), and both access paths are checked against Block Public
 * Access at bucket and account level and against Object Ownership.
 *
 * The evaluation functions are pure; collectS3SecurityEvidence() is the only part
 * that calls AWS.
 */
import {
  S3Client,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  GetBucketOwnershipControlsCommand,
  Grant,
  PublicAccessBlockConfiguration,
} from '@aws-sdk/client-s3';
import {
  S3ControlClient,
  GetPublicAccessBlockCommand as GetAccountPublicAccessBlockCommand,
} from '@aws-sdk/client-s3-control';
import { ComplianceIssue } from '../types/aws-resources.types';
import { S3_FINDING_KEYS, S3FindingKey } from '../utils/s3FindingKeys';

export { S3_FINDING_KEYS };
export type { S3FindingKey };

export const S3_FINDING_TEXTS = {
  publicPolicy: 'S3 bucket policy allows public access',
  publicAclRead: 'S3 bucket ACL allows public read access',
  publicAclOther: 'S3 bucket ACL grants permissions to all users',
  httpsOnly: 'S3 bucket does not enforce HTTPS-only access',
} as const;

/**
 * Issue texts written before findings carried a stable key, and the key each one now
 * maps to. When a control evaluates to 'unknown', a matching legacy finding is carried
 * forward under that key, marked unverified (SOC 2 then reports UNKNOWN, not
 * CONTRADICTS); only a verified pass clears it. That includes the legacy
 * wildcard-principal policy text: it was a weak signal, but it can be a true positive,
 * and dropping it on an unverified re-scan would leave a possibly public bucket with
 * no finding at all.
 *
 * Deliberately NOT listed (approved decision, 2026-10-08): the legacy
 * "HIPAA: S3 must have encryption in transit for PHI data" text. It came only from
 * a tag lookup on tags S3 discovery never collected, so it never described the bucket.
 * It is dropped on the first re-scan whatever the HTTPS-only result is.
 */
export const LEGACY_S3_FINDING_KEYS: Readonly<Record<string, S3FindingKey>> = {
  'S3 bucket ACL allows public read access': S3_FINDING_KEYS.publicAcl,
  'S3 bucket is publicly accessible': S3_FINDING_KEYS.publicAcl,
  'S3 bucket policy allows public access (wildcard principal)': S3_FINDING_KEYS.publicPolicy,
};

export type EvaluationStatus = 'pass' | 'fail' | 'unknown';

/**
 * Machine-readable reason for an 'unknown' that may hide real exposure, counted
 * separately in the per-scan tally so lost detection is visible in the logs.
 */
export const ACCOUNT_BPA_UNAVAILABLE_PUBLIC_POLICY = 'account_bpa_unavailable_public_policy';
export type S3ReasonCode = typeof ACCOUNT_BPA_UNAVAILABLE_PUBLIC_POLICY;

export interface S3ControlResult {
  key: S3FindingKey;
  status: EvaluationStatus;
  reason: string;
  reasonCode?: S3ReasonCode;
}

export interface S3SecurityEvaluation {
  publicPolicy: S3ControlResult;
  publicAcl: S3ControlResult & { readAccess?: boolean };
  httpsOnly: S3ControlResult;
}

/** One AWS read: a value, a confirmed "not configured", or no usable answer. */
export type Observed<T> =
  | { state: 'present'; value: T }
  | { state: 'absent' }
  | { state: 'unavailable'; reason: string };

export interface S3SecurityEvidence {
  bucketName: string;
  /** GetBucketPolicy. absent = NoSuchBucketPolicy. */
  policy: Observed<string>;
  /** GetBucketPolicyStatus -> PolicyStatus.IsPublic. absent = NoSuchBucketPolicy. */
  policyIsPublic: Observed<boolean>;
  /** GetPublicAccessBlock (bucket). absent = NoSuchPublicAccessBlockConfiguration. */
  bucketPublicAccessBlock: Observed<PublicAccessBlockConfiguration>;
  /** S3 Control GetPublicAccessBlock (account). absent = NoSuchPublicAccessBlockConfiguration. */
  accountPublicAccessBlock: Observed<PublicAccessBlockConfiguration>;
  /** GetBucketOwnershipControls -> ObjectOwnership. absent = OwnershipControlsNotFoundError. */
  objectOwnership: Observed<string>;
  /** GetBucketAcl -> Grants. Every bucket has an ACL, so there is no absent state. */
  aclGrants: Observed<Grant[]>;
}

const ALL_USERS_URI = 'http://acs.amazonaws.com/groups/global/AllUsers';
const AUTHENTICATED_USERS_URI = 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers';

// ─── Evidence collection (the only part that calls AWS) ─────────────────────

async function observe<T>(
  read: () => Promise<T | undefined>,
  absentErrorNames: readonly string[]
): Promise<Observed<T>> {
  try {
    const value = await read();
    if (value === undefined) return { state: 'unavailable', reason: 'empty response' };
    return { state: 'present', value };
  } catch (error: any) {
    if (absentErrorNames.includes(error?.name)) return { state: 'absent' };
    return { state: 'unavailable', reason: error?.name || error?.message || 'error' };
  }
}

/**
 * Account-level Block Public Access. It is the same for every bucket in the account,
 * so callers fetch it once per scan and pass the result to collectS3SecurityEvidence.
 * Never throws: a failed lookup is 'unavailable', which evaluates to unknown.
 */
export async function fetchAccountPublicAccessBlock(
  s3Control?: S3ControlClient,
  accountId?: string
): Promise<Observed<PublicAccessBlockConfiguration>> {
  if (!s3Control || !accountId) {
    return { state: 'unavailable', reason: 'account-level lookup not available' };
  }
  return observe(
    async () =>
      (await s3Control.send(new GetAccountPublicAccessBlockCommand({ AccountId: accountId })))
        .PublicAccessBlockConfiguration,
    ['NoSuchPublicAccessBlockConfiguration']
  );
}

export async function collectS3SecurityEvidence(
  bucketName: string,
  s3: S3Client,
  accountPublicAccessBlock: Observed<PublicAccessBlockConfiguration>
): Promise<S3SecurityEvidence> {
  const Bucket = bucketName;
  const [policy, policyIsPublic, bucketPublicAccessBlock, objectOwnership, aclGrants] =
    await Promise.all([
      observe(async () => (await s3.send(new GetBucketPolicyCommand({ Bucket }))).Policy, ['NoSuchBucketPolicy']),
      observe(
        async () => (await s3.send(new GetBucketPolicyStatusCommand({ Bucket }))).PolicyStatus?.IsPublic,
        ['NoSuchBucketPolicy']
      ),
      observe(
        async () => (await s3.send(new GetPublicAccessBlockCommand({ Bucket }))).PublicAccessBlockConfiguration,
        ['NoSuchPublicAccessBlockConfiguration']
      ),
      observe(
        async () =>
          (await s3.send(new GetBucketOwnershipControlsCommand({ Bucket }))).OwnershipControls?.Rules?.[0]
            ?.ObjectOwnership,
        ['OwnershipControlsNotFoundError']
      ),
      observe(async () => (await s3.send(new GetBucketAclCommand({ Bucket }))).Grants ?? [], []),
    ]);

  return {
    bucketName,
    policy,
    policyIsPublic,
    bucketPublicAccessBlock,
    accountPublicAccessBlock,
    objectOwnership,
    aclGrants,
  };
}

// ─── Evaluation (pure) ──────────────────────────────────────────────────────

/** true / false when the setting is verified; null when it cannot be established. */
function blockSetting(
  observed: Observed<PublicAccessBlockConfiguration>,
  setting: 'RestrictPublicBuckets' | 'IgnorePublicAcls'
): boolean | null {
  if (observed.state === 'absent') return false;
  if (observed.state === 'unavailable') return null;
  return observed.value[setting] === true;
}

export function evaluatePublicPolicy(evidence: S3SecurityEvidence): S3ControlResult {
  const key = S3_FINDING_KEYS.publicPolicy;
  const bucketRestrict = blockSetting(evidence.bucketPublicAccessBlock, 'RestrictPublicBuckets');
  const accountRestrict = blockSetting(evidence.accountPublicAccessBlock, 'RestrictPublicBuckets');

  if (bucketRestrict === true || accountRestrict === true) {
    return { key, status: 'pass', reason: 'Block Public Access RestrictPublicBuckets is enabled' };
  }
  if (evidence.policy.state === 'absent' || evidence.policyIsPublic.state === 'absent') {
    return { key, status: 'pass', reason: 'Bucket has no bucket policy' };
  }
  if (evidence.policyIsPublic.state === 'unavailable') {
    return { key, status: 'unknown', reason: `Policy status unavailable (${evidence.policyIsPublic.reason})` };
  }
  if (evidence.policyIsPublic.value === false) {
    return { key, status: 'pass', reason: 'AWS evaluates the bucket policy as not public' };
  }
  if (bucketRestrict === false && accountRestrict === false) {
    return {
      key,
      status: 'fail',
      reason: 'AWS evaluates the bucket policy as public and RestrictPublicBuckets is off at bucket and account level',
    };
  }
  if (accountRestrict === null) {
    return {
      key,
      status: 'unknown',
      reason: 'AWS evaluates the bucket policy as public, but account-level Block Public Access could not be read',
      reasonCode: ACCOUNT_BPA_UNAVAILABLE_PUBLIC_POLICY,
    };
  }
  return {
    key,
    status: 'unknown',
    reason: 'AWS evaluates the bucket policy as public, but bucket-level Block Public Access could not be read',
  };
}

export function evaluatePublicAcl(evidence: S3SecurityEvidence): S3ControlResult & { readAccess?: boolean } {
  const key = S3_FINDING_KEYS.publicAcl;
  const ownership = evidence.objectOwnership;
  if (ownership.state === 'present' && ownership.value === 'BucketOwnerEnforced') {
    return { key, status: 'pass', reason: 'ACLs are disabled (Object Ownership: BucketOwnerEnforced)' };
  }

  const bucketIgnore = blockSetting(evidence.bucketPublicAccessBlock, 'IgnorePublicAcls');
  const accountIgnore = blockSetting(evidence.accountPublicAccessBlock, 'IgnorePublicAcls');
  if (bucketIgnore === true || accountIgnore === true) {
    return { key, status: 'pass', reason: 'Block Public Access IgnorePublicAcls is enabled' };
  }

  if (evidence.aclGrants.state !== 'present') {
    const reason = evidence.aclGrants.state === 'unavailable' ? evidence.aclGrants.reason : 'no ACL';
    return { key, status: 'unknown', reason: `Bucket ACL unavailable (${reason})` };
  }

  const publicGrants = evidence.aclGrants.value.filter(
    (g) => g.Grantee?.URI === ALL_USERS_URI || g.Grantee?.URI === AUTHENTICATED_USERS_URI
  );
  if (publicGrants.length === 0) {
    return { key, status: 'pass', reason: 'Bucket ACL grants nothing to AllUsers or AuthenticatedUsers' };
  }

  const aclsEffective = ownership.state === 'absent' || ownership.state === 'present';
  if (aclsEffective && bucketIgnore === false && accountIgnore === false) {
    const readAccess = publicGrants.some((g) => g.Permission === 'READ' || g.Permission === 'FULL_CONTROL');
    const grantees = Array.from(new Set(publicGrants.map((g) => (g.Grantee?.URI ?? '').split('/').pop())));
    return {
      key,
      status: 'fail',
      reason: `Bucket ACL grants ${publicGrants.map((g) => g.Permission).join(', ')} to ${grantees.join(', ')}`,
      readAccess,
    };
  }
  return {
    key,
    status: 'unknown',
    reason: 'Bucket ACL has a public grant, but Object Ownership or Block Public Access could not be read',
  };
}

// HTTPS-only: the relevant access paths a Deny on aws:SecureTransport=false must
// cover. Object read, write and delete, and bucket listing. An action outside this
// set is not, on its own, treated as a gap.
const HTTPS_RELEVANT_ACCESS: ReadonlyArray<{ action: string; target: 'object' | 'bucket' }> = [
  { action: 's3:GetObject', target: 'object' },
  { action: 's3:PutObject', target: 'object' },
  { action: 's3:DeleteObject', target: 'object' },
  { action: 's3:ListBucket', target: 'bucket' },
];

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * IAM-style wildcard match: '*' matches any sequence (including empty), '?' exactly
 * one character. Policy patterns are customer-controlled, so this never builds a
 * RegExp from them: a two-pointer scan that, on a mismatch, backs up only to the most
 * recent '*'. Worst case O(pattern length x value length), never exponential.
 */
export function wildcardMatch(pattern: string, value: string, caseInsensitive: boolean): boolean {
  const p = caseInsensitive ? pattern.toLowerCase() : pattern;
  const v = caseInsensitive ? value.toLowerCase() : value;
  let pi = 0;
  let vi = 0;
  let starPi = -1;
  let starVi = 0;

  while (vi < v.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === v[vi])) {
      pi++;
      vi++;
    } else if (pi < p.length && p[pi] === '*') {
      starPi = pi++;
      starVi = vi;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      vi = ++starVi;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

/** "*", or a principal block whose AWS entry includes "*" (every AWS principal). */
function isWildcardPrincipal(principal: unknown): boolean {
  if (principal === '*') return true;
  if (principal && typeof principal === 'object' && !Array.isArray(principal)) {
    return toArray((principal as Record<string, unknown>).AWS).includes('*');
  }
  return false;
}

type StatementClass = 'qualifying' | 'inconclusive' | 'irrelevant';

/**
 * 'qualifying': a Deny, for every principal, of requests where aws:SecureTransport is
 * false, with no other condition and no Not* element.
 * 'inconclusive': a Deny that mentions aws:SecureTransport but in a form this check
 * cannot evaluate (extra conditions, Not* elements, an unrecognised operator or value).
 * 'irrelevant': anything else, including a Deny for named principals only, which
 * conclusively leaves every other principal uncovered.
 */
function classifyHttpsStatement(statement: Record<string, any>): StatementClass {
  const conditions = statement.Condition && typeof statement.Condition === 'object' ? statement.Condition : {};
  let secureTransportFalse = false;
  let mentionsSecureTransport = false;
  let otherConditions = 0;

  for (const [operator, block] of Object.entries(conditions as Record<string, any>)) {
    if (!block || typeof block !== 'object') {
      otherConditions++;
      continue;
    }
    for (const [conditionKey, conditionValue] of Object.entries(block as Record<string, unknown>)) {
      if (conditionKey.toLowerCase() === 'aws:securetransport') {
        mentionsSecureTransport = true;
        const values = toArray(conditionValue);
        if (
          (operator === 'Bool' || operator === 'BoolIfExists') &&
          values.length > 0 &&
          values.every((v) => String(v).toLowerCase() === 'false')
        ) {
          secureTransportFalse = true;
          continue;
        }
      }
      otherConditions++;
    }
  }

  if (!mentionsSecureTransport || statement.Effect !== 'Deny') return 'irrelevant';
  if (
    !secureTransportFalse ||
    otherConditions > 0 ||
    statement.NotPrincipal !== undefined ||
    statement.NotAction !== undefined ||
    statement.NotResource !== undefined
  ) {
    return 'inconclusive';
  }
  return isWildcardPrincipal(statement.Principal) ? 'qualifying' : 'irrelevant';
}

/** Could this (inconclusive) statement apply to the action on the target? Not*
 * elements cannot be ruled out, so they count as "could". */
function statementCouldCover(statement: Record<string, any>, action: string, target: 'object' | 'bucket', bucketName: string): boolean {
  if (statement.NotAction !== undefined || statement.NotResource !== undefined) return true;
  return statementCovers(statement, action, target, bucketName);
}

function statementCovers(statement: Record<string, any>, action: string, target: 'object' | 'bucket', bucketName: string): boolean {
  const actions = toArray(statement.Action).filter((a): a is string => typeof a === 'string');
  if (!actions.some((pattern) => wildcardMatch(pattern, action, true))) return false;

  const resources = toArray(statement.Resource).filter((r): r is string => typeof r === 'string');
  const bucketArn = `arn:aws:s3:::${bucketName}`;
  return resources.some((pattern) =>
    target === 'bucket'
      ? wildcardMatch(pattern, bucketArn, false)
      : // A pattern covers every object when it ends in '*' and already matches the
        // object-key prefix: the trailing '*' then absorbs any key.
        pattern.endsWith('*') && wildcardMatch(pattern, `${bucketArn}/`, false)
  );
}

export function evaluateHttpsOnly(evidence: S3SecurityEvidence): S3ControlResult {
  const key = S3_FINDING_KEYS.httpsOnly;
  if (evidence.policy.state === 'absent') {
    return { key, status: 'fail', reason: 'Bucket has no bucket policy, so non-HTTPS requests are not denied' };
  }
  if (evidence.policy.state === 'unavailable') {
    return { key, status: 'unknown', reason: `Bucket policy unavailable (${evidence.policy.reason})` };
  }

  let document: any;
  try {
    document = JSON.parse(evidence.policy.value);
  } catch {
    return { key, status: 'unknown', reason: 'Bucket policy could not be parsed' };
  }
  const statements = toArray(document?.Statement).filter(
    (s): s is Record<string, any> => !!s && typeof s === 'object' && !Array.isArray(s)
  );
  if (statements.length === 0) {
    return { key, status: 'unknown', reason: 'Bucket policy has no readable statements' };
  }

  const classified = statements.map((s) => ({ statement: s, kind: classifyHttpsStatement(s) }));
  const qualifying = classified.filter((c) => c.kind === 'qualifying').map((c) => c.statement);
  const uncovered = HTTPS_RELEVANT_ACCESS.filter(
    ({ action, target }) => !qualifying.some((s) => statementCovers(s, action, target, evidence.bucketName))
  );

  if (uncovered.length === 0) {
    return { key, status: 'pass', reason: 'Bucket policy denies requests where aws:SecureTransport is false' };
  }

  // A gap is conclusive only when no inconclusive statement could be covering it.
  const inconclusive = classified.filter((c) => c.kind === 'inconclusive').map((c) => c.statement);
  const conclusiveGaps = uncovered.filter(
    ({ action, target }) => !inconclusive.some((s) => statementCouldCover(s, action, target, evidence.bucketName))
  );
  if (conclusiveGaps.length === 0) {
    return {
      key,
      status: 'unknown',
      reason: 'Bucket policy has a SecureTransport deny that cannot be evaluated (extra conditions, Not* elements, or an unrecognised form)',
    };
  }
  if (qualifying.length === 0 && inconclusive.length === 0) {
    return { key, status: 'fail', reason: 'No bucket policy statement denies requests where aws:SecureTransport is false' };
  }
  return {
    key,
    status: 'fail',
    reason: `HTTPS-only deny does not cover: ${conclusiveGaps.map((u) => u.action).join(', ')}`,
  };
}

export function evaluateS3Security(evidence: S3SecurityEvidence): S3SecurityEvaluation {
  return {
    publicPolicy: evaluatePublicPolicy(evidence),
    publicAcl: evaluatePublicAcl(evidence),
    httpsOnly: evaluateHttpsOnly(evidence),
  };
}

/** Every control unknown, for when evidence collection itself failed. */
export function unknownS3Evaluation(reason: string): S3SecurityEvaluation {
  return {
    publicPolicy: { key: S3_FINDING_KEYS.publicPolicy, status: 'unknown', reason },
    publicAcl: { key: S3_FINDING_KEYS.publicAcl, status: 'unknown', reason },
    httpsOnly: { key: S3_FINDING_KEYS.httpsOnly, status: 'unknown', reason },
  };
}

// ─── Per-scan counts (logged, not persisted) ────────────────────────────────

export type S3EvaluationTally = { buckets: number; reasons: Record<S3ReasonCode, number> } & Record<
  S3FindingKey,
  Record<EvaluationStatus, number>
>;

export function newS3EvaluationTally(): S3EvaluationTally {
  const zero = () => ({ pass: 0, fail: 0, unknown: 0 });
  return {
    buckets: 0,
    reasons: { [ACCOUNT_BPA_UNAVAILABLE_PUBLIC_POLICY]: 0 },
    [S3_FINDING_KEYS.publicPolicy]: zero(),
    [S3_FINDING_KEYS.publicAcl]: zero(),
    [S3_FINDING_KEYS.httpsOnly]: zero(),
  } as S3EvaluationTally;
}

export function addToS3EvaluationTally(tally: S3EvaluationTally, evaluation: S3SecurityEvaluation): void {
  tally.buckets++;
  for (const result of [evaluation.publicPolicy, evaluation.publicAcl, evaluation.httpsOnly]) {
    tally[result.key][result.status]++;
    if (result.reasonCode) tally.reasons[result.reasonCode]++;
  }
}

export function formatS3EvaluationTally(tally: S3EvaluationTally): string {
  const keys = [S3_FINDING_KEYS.publicPolicy, S3_FINDING_KEYS.publicAcl, S3_FINDING_KEYS.httpsOnly];
  const parts = keys.map((k) => `${k} pass=${tally[k].pass} fail=${tally[k].fail} unknown=${tally[k].unknown}`);
  const reasons = Object.entries(tally.reasons).map(([code, count]) => `${code}=${count}`);
  return `${tally.buckets} bucket(s); ${parts.join('; ')}; ${reasons.join('; ')}`;
}

// ─── Findings ───────────────────────────────────────────────────────────────

/** Verified findings: one per failing control, never one for pass or unknown. */
export function s3FindingsFromEvaluation(resourceArn: string, evaluation: S3SecurityEvaluation): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  if (evaluation.publicPolicy.status === 'fail') {
    issues.push({
      severity: 'critical',
      category: 'public_access',
      issue: S3_FINDING_TEXTS.publicPolicy,
      recommendation: 'Remove public grants from the bucket policy, or enable S3 Block Public Access (RestrictPublicBuckets).',
      resource_arn: resourceArn,
      provenance: 'OBSERVED',
      findingKey: S3_FINDING_KEYS.publicPolicy,
    });
  }

  if (evaluation.publicAcl.status === 'fail') {
    issues.push({
      severity: 'critical',
      category: 'public_access',
      issue: evaluation.publicAcl.readAccess ? S3_FINDING_TEXTS.publicAclRead : S3_FINDING_TEXTS.publicAclOther,
      recommendation: 'Remove AllUsers/AuthenticatedUsers grants from the bucket ACL, or disable ACLs (Object Ownership: BucketOwnerEnforced) and enable S3 Block Public Access.',
      resource_arn: resourceArn,
      provenance: 'OBSERVED',
      findingKey: S3_FINDING_KEYS.publicAcl,
    });
  }

  if (evaluation.httpsOnly.status === 'fail') {
    issues.push({
      severity: 'high',
      category: 'encryption',
      issue: S3_FINDING_TEXTS.httpsOnly,
      recommendation: 'Add a bucket policy statement that denies s3:* on the bucket and its objects for all principals when aws:SecureTransport is false.',
      resource_arn: resourceArn,
      provenance: 'OBSERVED',
      findingKey: S3_FINDING_KEYS.httpsOnly,
    });
  }

  return issues;
}

/**
 * For each control that evaluated to 'unknown', keep the previous snapshot's finding
 * for the same key, marked unverified. A 'pass' carries nothing forward, so the
 * finding leaves the next snapshot. Previous findings without a key are carried only
 * when they are a listed legacy text (see LEGACY_S3_FINDING_KEYS). Malformed entries
 * (null, non-objects) are skipped, never thrown on: this runs inside the per-resource
 * scan loop, including its error fallback.
 */
export function carryForwardUnverifiedS3Findings(
  previousIssues: unknown,
  evaluation: S3SecurityEvaluation
): ComplianceIssue[] {
  const unknownKeys = new Set(
    [evaluation.publicPolicy, evaluation.publicAcl, evaluation.httpsOnly]
      .filter((r) => r.status === 'unknown')
      .map((r) => r.key)
  );
  if (unknownKeys.size === 0 || !Array.isArray(previousIssues)) return [];

  const carried: ComplianceIssue[] = [];
  const seen = new Set<string>();
  for (const item of previousIssues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const issue = item as ComplianceIssue;
    let key: string | undefined = typeof issue.findingKey === 'string' ? issue.findingKey : undefined;
    if (!key && typeof issue.issue === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_S3_FINDING_KEYS, issue.issue)) {
      key = LEGACY_S3_FINDING_KEYS[issue.issue];
    }
    if (!key || !unknownKeys.has(key as S3FindingKey) || seen.has(key)) continue;
    seen.add(key);
    carried.push({ ...issue, findingKey: key, verification: 'unverified' });
  }
  return carried;
}
