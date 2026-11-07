/**
 * Whether DevControl may stop an EC2 instance (remediation action
 * stop_instance). One rule, used by every path that can reach the stop:
 * RemediationService (create, approve, execute, and again immediately before
 * the AWS call) and the Services Intelligence response that advertises the
 * action.
 *
 * An allow-list: a stop is permitted only for a workflow that points at its
 * organization's ACTIVE EC2 "Idle Instance" finding for the same instance,
 * and only when that finding carries a positive marker,
 * metadata.rule_version, set to a version listed below. Only the multi-signal
 * low-activity rule sets that marker. A missing, unknown or older marker, a
 * missing finding, or a workflow with no finding at all is refused. The
 * finding's own evaluation must also be recent (FP2b-Q13): its
 * metadata.low_activity.evaluated_at no more than
 * LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS old, so a row that survived a
 * failed scan is never acted on.
 *
 * The finding is read from the database each time it is judged; a result is
 * never carried from one stage to the next.
 */
import { ISSUE_EC2_IDLE_INSTANCE } from '../config/optimization-rules';
import { LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS } from '../config/low-activity-rule';

/** metadata.rule_version values whose findings may be acted on. Exact numbers only. */
export const STOP_ELIGIBLE_IDLE_RULE_VERSIONS: readonly number[] = [2];

/** Internal refusal text starts with this; callers only ever see the public message. */
export const STOP_NOT_ELIGIBLE_PREFIX = 'STOP_NOT_ELIGIBLE:';

/** What every caller is told when a stop is refused (founder-approved copy). */
export const STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE =
  "DevControl can't stop this instance. Stopping is only offered for low-activity findings confirmed by DevControl's current checks, and this one isn't. No change was made in AWS.";

export type StopRefusalReason =
  | 'no_finding'
  | 'finding_not_found'
  | 'finding_mismatch'
  | 'finding_not_active'
  | 'marker_missing'
  | 'marker_not_allowed'
  | 'evidence_stale';

/** The cost_recommendations columns the rule reads. */
export interface StopFindingRow {
  id: string;
  resource_id: string;
  resource_type: string;
  issue: string;
  status: string;
  metadata: unknown;
}

export type StopEligibility = { eligible: true } | { eligible: false; reason: StopRefusalReason };

/** A query function: a pg Pool, PoolClient or test double. */
export interface StopFindingReader {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export function isStopRefusal(message: unknown): boolean {
  return typeof message === 'string' && message.startsWith(STOP_NOT_ELIGIBLE_PREFIX);
}

/** The marker's own verdict: absent, present but not allowed, or allowed. */
export function judgeStopMarker(metadata: unknown): StopEligibility {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { eligible: false, reason: 'marker_missing' };
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, 'rule_version')) {
    return { eligible: false, reason: 'marker_missing' };
  }
  const version = (metadata as Record<string, unknown>).rule_version;
  if (version === undefined || version === null) return { eligible: false, reason: 'marker_missing' };
  if (typeof version !== 'number' || !STOP_ELIGIBLE_IDLE_RULE_VERSIONS.includes(version)) {
    return { eligible: false, reason: 'marker_not_allowed' };
  }
  return { eligible: true };
}

/** A clock skew allowance for an evaluation time slightly ahead of this process's clock. */
const EVALUATED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The evidence's own verdict (condition 7): metadata.low_activity.evaluated_at
 * is an ISO time at most LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS before `now`
 * (and not more than a few minutes after it). Missing or unparseable is stale.
 */
export function judgeStopEvidenceFreshness(metadata: unknown, now: Date): StopEligibility {
  const lowActivity = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).low_activity
    : undefined;
  const evaluatedAt = lowActivity && typeof lowActivity === 'object' && !Array.isArray(lowActivity)
    ? (lowActivity as Record<string, unknown>).evaluated_at
    : undefined;
  if (typeof evaluatedAt !== 'string') return { eligible: false, reason: 'evidence_stale' };
  const at = Date.parse(evaluatedAt);
  if (!Number.isFinite(at)) return { eligible: false, reason: 'evidence_stale' };
  const age = now.getTime() - at;
  if (age > LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS * 60 * 60 * 1000) return { eligible: false, reason: 'evidence_stale' };
  if (age < -EVALUATED_AT_FUTURE_TOLERANCE_MS) return { eligible: false, reason: 'evidence_stale' };
  return { eligible: true };
}

/**
 * The rule itself, on rows already read. `recommendationId` is the workflow's
 * (or request's) reference; `finding` is what the database returned for it in
 * the caller's organization (null when nothing was found).
 */
export function judgeStopEligibility(input: {
  resourceId: string;
  recommendationId: string | null | undefined;
  finding: StopFindingRow | null | undefined;
  /** When the rule is judged; the evidence must be recent at this moment. */
  now?: Date;
}): StopEligibility {
  const { resourceId, recommendationId, finding } = input;
  const now = input.now ?? new Date();

  // A stop must be backed by a finding.
  if (recommendationId === null || recommendationId === undefined || recommendationId === '') {
    return { eligible: false, reason: 'no_finding' };
  }
  if (!finding || finding.id !== recommendationId) return { eligible: false, reason: 'finding_not_found' };

  // ...for the same instance...
  if (finding.resource_id !== resourceId) return { eligible: false, reason: 'finding_mismatch' };

  // ...that is an EC2 Idle Instance finding...
  if (finding.resource_type !== 'EC2' || finding.issue !== ISSUE_EC2_IDLE_INSTANCE) {
    return { eligible: false, reason: 'finding_mismatch' };
  }

  // ...still open (a RESOLVED or DISMISSED row is a past decision, never a reason to act)...
  if (finding.status !== 'ACTIVE') return { eligible: false, reason: 'finding_not_active' };

  // ...produced by a rule on the allow-list...
  const marker = judgeStopMarker(finding.metadata);
  if (!marker.eligible) return marker;

  // ...from a recent evaluation.
  return judgeStopEvidenceFreshness(finding.metadata, now);
}

/** Reads the finding fresh, scoped to the organization. */
export async function readStopFinding(
  reader: StopFindingReader,
  organizationId: string,
  recommendationId: string
): Promise<StopFindingRow | null> {
  const result = await reader.query(
    `SELECT id, resource_id, resource_type, issue, status, metadata
       FROM cost_recommendations
      WHERE id = $1 AND organization_id = $2`,
    [recommendationId, organizationId]
  );
  return (result.rows[0] as StopFindingRow | undefined) ?? null;
}

/** Reads the finding now and judges it. */
export async function checkStopEligibility(
  reader: StopFindingReader,
  organizationId: string,
  resourceId: string,
  recommendationId: string | null | undefined
): Promise<StopEligibility> {
  if (recommendationId === null || recommendationId === undefined || recommendationId === '') {
    return judgeStopEligibility({ resourceId, recommendationId, finding: null });
  }
  const finding = await readStopFinding(reader, organizationId, recommendationId);
  return judgeStopEligibility({ resourceId, recommendationId, finding });
}
