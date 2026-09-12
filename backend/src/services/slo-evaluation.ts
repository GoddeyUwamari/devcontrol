/**
 * SLO 3A — pure SLI/error-budget methodology. No AWS or database imports on purpose:
 * this module is the one place the actual math lives, so cloudwatch.service.ts,
 * slo.service.ts, and any future consumer (frontend, a report, an alert) all go through
 * the exact same formulas instead of each re-deriving slightly different ones. See the
 * completed 3A audit's §21 ("API / Calculation Separation") for why this boundary
 * exists.
 *
 * Methodology, stated once here rather than scattered across call sites:
 *
 *   - ec2_availability: observed = EC2 uptime% from CloudWatch StatusCheckFailed
 *     (Average over the window). This is a control-plane status-check signal, NOT
 *     application-level uptime — DevControl has no visibility into whether the
 *     workload running on the instance is itself healthy.
 *   - alb_latency_avg: observed = ALB TargetResponseTime (Average over the window), in
 *     milliseconds. This is an AVERAGE, never a percentile — there is no p95/p99
 *     computation anywhere in this codebase's CloudWatch layer, so none is claimed here.
 *   - alb_error_rate / lambda_error_rate: observed = HTTP 5xx / Lambda function errors
 *     as a percentage of requests/invocations over the window.
 *
 * Error budget only applies to the three percentage-based SLIs, and only because their
 * `target_value` is defined as a required SUCCESS rate (e.g. 99.9 = 99.9% of requests
 * must succeed). For those three:
 *
 *   allowed_failure_rate  = 1 - target / 100                        (a fraction, e.g. 0.001)
 *   observed_failure_rate = 1 - observedSuccessPercent / 100
 *   consumed_fraction     = observed_failure_rate / allowed_failure_rate
 *   remaining_fraction    = 1 - consumed_fraction
 *
 * consumed_fraction can exceed 1 (and remaining_fraction can go negative) when the SLO
 * is breached — that is reported as-is, never clamped to look better than it is.
 *
 * alb_latency_avg has NO error budget: a single-window average latency figure cannot
 * support a ratio-based failure-budget calculation the way a percentage-of-successful-
 * requests figure can (there's no "fraction of requests that were too slow" without
 * per-request data this codebase doesn't collect). Its evaluation is a direct
 * observed <= target comparison only. `errorBudget.applicable` is false for this SLI,
 * always — never a fabricated number.
 */

export type SloResourceType = 'ec2' | 'load-balancer' | 'lambda'
export type SloIndicator = 'ec2_availability' | 'alb_latency_avg' | 'alb_error_rate' | 'lambda_error_rate'
export type SloWindow = '24h' | '7d'
export type SloUnit = 'percent' | 'ms'

export const SLI_RESOURCE_TYPE: Record<SloIndicator, SloResourceType> = {
  ec2_availability: 'ec2',
  alb_latency_avg: 'load-balancer',
  alb_error_rate: 'load-balancer',
  lambda_error_rate: 'lambda',
}

export const SLI_UNIT: Record<SloIndicator, SloUnit> = {
  ec2_availability: 'percent',
  alb_latency_avg: 'ms',
  alb_error_rate: 'percent',
  lambda_error_rate: 'percent',
}

export const SUPPORTED_SLIS = Object.keys(SLI_RESOURCE_TYPE) as SloIndicator[]
export const SUPPORTED_WINDOWS: SloWindow[] = ['24h', '7d']

export type SloEvaluationStatus =
  | 'healthy'
  | 'breached'
  | 'insufficient_data'
  | 'resource_not_found'
  | 'aws_not_connected'

export interface SloErrorBudget {
  applicable: boolean
  allowedFailureRate: number | null
  observedFailureRate: number | null
  consumedFraction: number | null
  remainingFraction: number | null
}

export interface SloEvaluationResult {
  status: SloEvaluationStatus
  observedValue: number | null
  targetValue: number
  unit: SloUnit
  errorBudget: SloErrorBudget
}

const NOT_APPLICABLE_BUDGET: SloErrorBudget = {
  applicable: false,
  allowedFailureRate: null,
  observedFailureRate: null,
  consumedFraction: null,
  remainingFraction: null,
}

/**
 * The single "is this healthy" comparison, unit-aware:
 *   - percent SLIs: observed must be >= target (a required success rate).
 *   - ms SLIs: observed must be <= target (a maximum allowed latency).
 */
function isHealthy(unit: SloUnit, observedValue: number, targetValue: number): boolean {
  return unit === 'ms' ? observedValue <= targetValue : observedValue >= targetValue
}

/**
 * Error budget for a percentage-based SLI only. Callers must not invoke this for
 * alb_latency_avg — validated by the sli parameter's type, and by the DB CHECK
 * constraint (slo_definitions_target_value_valid) that keeps target in (0, 100)
 * exclusive, which guarantees allowedFailureRate is always strictly between 0 and 1
 * here (no division-by-zero case to guard).
 */
export function computeErrorBudget(
  sli: Exclude<SloIndicator, 'alb_latency_avg'>,
  observedSuccessPercent: number,
  targetPercent: number
): SloErrorBudget {
  const allowedFailureRate = 1 - targetPercent / 100
  const observedFailureRate = 1 - observedSuccessPercent / 100
  const consumedFraction = observedFailureRate / allowedFailureRate
  return {
    applicable: true,
    allowedFailureRate,
    observedFailureRate,
    consumedFraction,
    remainingFraction: 1 - consumedFraction,
  }
}

/**
 * Raw per-resource observation shape expected from
 * CloudWatchService.evaluateResourceForSlo — duplicated here (rather than imported)
 * to keep this module free of any dependency on the AWS-facing service, per the
 * calculation/AWS-call separation this module exists to enforce.
 */
export interface SloRawObservation {
  resourceExists: boolean
  monitored: boolean
  uptime: number | null
  avgLatencyMs: number | null
  errorRatePercent: number | null
}

/**
 * Turns a raw CloudWatch-derived observation into a fully classified SLO evaluation.
 * This is the one function that decides healthy vs. breached vs. every "we don't
 * actually know" state — never called with AWS/DB access itself, so it's trivially
 * unit-testable against constructed observations.
 */
export function evaluateSlo(
  sli: SloIndicator,
  targetValue: number,
  awsConnected: boolean,
  observation: SloRawObservation | null
): SloEvaluationResult {
  const unit = SLI_UNIT[sli]

  if (!awsConnected || observation === null) {
    return { status: 'aws_not_connected', observedValue: null, targetValue, unit, errorBudget: NOT_APPLICABLE_BUDGET }
  }

  if (!observation.resourceExists) {
    return { status: 'resource_not_found', observedValue: null, targetValue, unit, errorBudget: NOT_APPLICABLE_BUDGET }
  }

  const rawValue =
    sli === 'ec2_availability' ? observation.uptime :
    sli === 'alb_latency_avg' ? observation.avgLatencyMs :
    observation.errorRatePercent // alb_error_rate | lambda_error_rate

  if (rawValue === null || !observation.monitored) {
    return { status: 'insufficient_data', observedValue: null, targetValue, unit, errorBudget: NOT_APPLICABLE_BUDGET }
  }

  if (sli === 'alb_latency_avg') {
    const status = isHealthy(unit, rawValue, targetValue) ? 'healthy' : 'breached'
    return { status, observedValue: rawValue, targetValue, unit, errorBudget: NOT_APPLICABLE_BUDGET }
  }

  // Percent-based SLIs: convert error-rate SLIs to a success-percent so
  // computeErrorBudget() and isHealthy() have one uniform "higher is better" shape.
  const observedSuccessPercent = sli === 'ec2_availability' ? rawValue : 100 - rawValue
  const status = isHealthy(unit, observedSuccessPercent, targetValue) ? 'healthy' : 'breached'
  const errorBudget = computeErrorBudget(sli, observedSuccessPercent, targetValue)

  return { status, observedValue: observedSuccessPercent, targetValue, unit, errorBudget }
}
