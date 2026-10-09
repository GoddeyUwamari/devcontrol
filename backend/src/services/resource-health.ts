/**
 * Resource health for Services Intelligence, read from the Resource checks
 * evaluator's own results (cloudwatch.service.ts). Nothing here evaluates a
 * resource or calls AWS: this is one pure mapping from an evaluator row
 * (CloudWatchServiceHealth) to a state, so the Dashboard's Resource checks and
 * the intelligence endpoint cannot disagree about the same row.
 *
 * States:
 *   checks_passing  the evaluator's check returned a passing result
 *   check_failing   the evaluator's check returned a failing result
 *   no_signal       checks exist for the type, but no result is available
 *   not_supported   no checks exist for this resource (type)
 *
 * Missing or undetermined data is never passing and never failing.
 *
 * The one deliberate difference from the Dashboard: the evaluator reports a
 * resource that is not running as 'down', which the Dashboard counts as "with
 * issues". No check returned a failing result for such a resource, so here it
 * is no_signal with reason not_running -- unless its recorded lifecycle state
 * is itself a failure (FAILED_LIFECYCLE_STATES), which is check_failing.
 */
import type { CloudWatchMetrics, CloudWatchServiceHealth } from './cloudwatch.service';

export type ResourceHealthState = 'checks_passing' | 'check_failing' | 'no_signal' | 'not_supported';
export type CheckResult = 'passing' | 'failing' | 'undetermined';
export type NoSignalReason = 'no_telemetry' | 'undetermined' | 'not_running' | 'evaluation_unavailable';
export type HealthCheckKind = 'aws_status_check' | 'cloudwatch_metric' | 'control_plane';

export const RESOURCE_HEALTH_STATES: readonly ResourceHealthState[] = [
  'checks_passing', 'check_failing', 'no_signal', 'not_supported',
];

/** Where an evaluation was read from. There is one source today. */
export const RESOURCE_HEALTH_SOURCE = 'resource_checks_cache';
/** The evaluator range that is read: the one the Dashboard and /admin/monitoring share. */
export const RESOURCE_HEALTH_RANGE = '1h';
/** An evaluation older than this is not reported; the resource is no_signal instead. */
export const RESOURCE_HEALTH_MAX_AGE_MS = 15 * 60 * 1000;

export interface ResourceHealthCheck {
  name: string;
  result: CheckResult;
  /** When the evaluation that produced this result ran. */
  observed_at: string;
}

export interface EvaluatedResourceHealth {
  state: ResourceHealthState;
  checks: ResourceHealthCheck[];
  reasons: Array<{ kind: NoSignalReason }>;
  evaluated_at: string | null;
  source: typeof RESOURCE_HEALTH_SOURCE | null;
}

type EvaluatedType = CloudWatchServiceHealth['resourceType'];

interface SupportedChecks {
  kind: HealthCheckKind;
  /** Every check name the evaluator can report for the type; the first is its primary check. */
  checks: readonly string[];
}

/**
 * What the evaluator checks per type, keyed by its own resourceType union so a
 * type added there cannot be forgotten here. null = the evaluator lists the
 * type but has no check for it (RDS is inventory-only: always monitored:false).
 * The evaluator yields one result per resource, so each resource reports one
 * check: the one that produced its status.
 */
const SUPPORTED_CHECKS: Record<EvaluatedType, SupportedChecks | null> = {
  // StatusCheckFailed when it has datapoints, else the CPU threshold.
  ec2: { kind: 'aws_status_check', checks: ['ec2_status_check', 'ec2_cpu_threshold'] },
  ebs: { kind: 'aws_status_check', checks: ['ebs_volume_status_check'] },
  rds: null,
  'load-balancer': { kind: 'cloudwatch_metric', checks: ['alb_response_time_threshold'] },
  lambda: { kind: 'cloudwatch_metric', checks: ['lambda_error_rate_threshold'] },
  dynamodb: { kind: 'cloudwatch_metric', checks: ['dynamodb_errors_and_throttling'] },
  ecs: { kind: 'control_plane', checks: ['ecs_service_tasks'] },
  eks: { kind: 'control_plane', checks: ['eks_cluster_status'] },
  cloudfront: { kind: 'cloudwatch_metric', checks: ['cloudfront_error_rate_threshold'] },
  aurora: { kind: 'cloudwatch_metric', checks: ['aurora_cluster_status_and_thresholds'] },
};

/**
 * Recorded lifecycle states (aws_resources.status) that are themselves a
 * failure, per type. A 'down' row whose resource is in one of these is
 * check_failing; any other 'down' row is a resource that is not running.
 * The evaluator does not report 'down' for a failed Aurora cluster today (it
 * reports 'unknown'), so the Aurora entry only takes effect if it starts to.
 */
const FAILED_LIFECYCLE_STATES: Partial<Record<EvaluatedType, readonly string[]>> = {
  ebs: ['error'],
  lambda: ['Failed'],
  aurora: ['failed', 'inaccessible-encryption-credentials', 'incompatible-parameters', 'incompatible-restore'],
};

export interface HealthSubject {
  /** aws_resources.resource_type */
  type: string;
  /** aws_resources.status */
  lifecycleState: string | null;
  /** aws_resources.metadata->>'type' (the load balancer kind) */
  metadataType: string | null;
}

/** The evaluator's checks for a resource type, or null when it has none. */
export function supportedChecksForType(type: string): SupportedChecks | null {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CHECKS, type) ? SUPPORTED_CHECKS[type as EvaluatedType] : null;
}

/**
 * Whether the evaluator has a check for this particular resource. Only
 * application load balancers are evaluated (computeMetrics() filters on
 * metadata.type === 'application'); any other load balancer has no check.
 */
function supportedChecksFor(subject: HealthSubject): SupportedChecks | null {
  const supported = supportedChecksForType(subject.type);
  if (!supported) return null;
  if (subject.type === 'load-balancer' && subject.metadataType !== 'application') return null;
  return supported;
}

function checkNameFor(supported: SupportedChecks, row: CloudWatchServiceHealth): string {
  // The evaluator reports a numeric uptime only on EC2's status-check path;
  // a status with no uptime came from the CPU threshold.
  if (row.resourceType === 'ec2' && row.uptime === null && row.monitored) return 'ec2_cpu_threshold';
  return supported.checks[0];
}

const NOT_SUPPORTED: EvaluatedResourceHealth = {
  state: 'not_supported', checks: [], reasons: [], evaluated_at: null, source: null,
};

/**
 * `evaluation` is the evaluator's cached result for the resource's
 * organization (null = none available). `row` is that result's row for this
 * resource, matched by aws_resources.id (undefined = it has none).
 */
export function resourceHealthFrom(
  subject: HealthSubject,
  evaluation: Pick<CloudWatchMetrics, 'capturedAt'> | null,
  row: CloudWatchServiceHealth | undefined
): EvaluatedResourceHealth {
  const supported = supportedChecksFor(subject);
  if (!supported) return NOT_SUPPORTED;

  if (!evaluation) {
    return { state: 'no_signal', checks: [], reasons: [{ kind: 'evaluation_unavailable' }], evaluated_at: null, source: null };
  }

  const evaluated = { evaluated_at: evaluation.capturedAt, source: RESOURCE_HEALTH_SOURCE } as const;
  // The evaluation ran but has no row: its type's block failed, or the
  // resource could not be mapped to a metric dimension.
  if (!row) {
    return { state: 'no_signal', checks: [], reasons: [{ kind: 'evaluation_unavailable' }], ...evaluated };
  }

  const check = (result: CheckResult): ResourceHealthCheck[] => [
    { name: checkNameFor(supported, row), result, observed_at: evaluation.capturedAt },
  ];
  const noSignal = (kind: NoSignalReason): EvaluatedResourceHealth => ({
    state: 'no_signal', checks: check('undetermined'), reasons: [{ kind }], ...evaluated,
  });

  if (row.status === 'down') {
    const failed = FAILED_LIFECYCLE_STATES[row.resourceType]?.includes(subject.lifecycleState ?? '') ?? false;
    return failed
      ? { state: 'check_failing', checks: check('failing'), reasons: [], ...evaluated }
      : noSignal('not_running');
  }
  if (!row.monitored) return noSignal('no_telemetry');
  if (row.status === 'healthy') return { state: 'checks_passing', checks: check('passing'), reasons: [], ...evaluated };
  if (row.status === 'degraded' || row.status === 'critical') {
    return { state: 'check_failing', checks: check('failing'), reasons: [], ...evaluated };
  }
  // 'unknown', and anything the evaluator may report in future that is not a
  // known result: undetermined, never passing.
  return noSignal('undetermined');
}

export type ResourceHealthCounts = Record<ResourceHealthState, number>;

export function countByState(states: ResourceHealthState[]): ResourceHealthCounts {
  const counts: ResourceHealthCounts = { checks_passing: 0, check_failing: 0, no_signal: 0, not_supported: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
}
