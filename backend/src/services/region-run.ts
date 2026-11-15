/**
 * One region of a multi-region discovery scan (multi-region PR 1): its deadline,
 * its throttle breaker, its call counts, how its failures are classified and the
 * status written for it.
 *
 * DEADLINE (A2). A region that started has REGION_DEADLINE_MS. When it passes, the
 * region's AbortSignal fires with RegionDeadlineError: every call of the region's
 * clients in flight is abandoned and no new one starts (utils/awsCallPolicy.ts),
 * and the listing that was running has no answer. The region is then timed_out
 * with code region_deadline, and nothing in it is reconciled. Other regions go on.
 *
 * THROTTLE BREAKER (A1). Every THROTTLE_BREAKER_STEP throttled attempts in the
 * region halve its resource pool (8 -> 4 -> 2), never below the floor. Its
 * listings slow down; they are never stopped for being throttled.
 *
 * REASON CODES (A2), stored in aws_account_regions.last_error_code. Each failure
 * keeps its own code; none is merged into another:
 *
 *   status     code                cause
 *   denied     access_denied       the role was refused a listing in this region
 *   denied     access_denied_scp   ... and AWS said a service control policy refused it
 *   failed     region_not_ready    AuthFailure / UnrecognizedClient / OptInRequired:
 *                                  the region is enabled but not usable yet (still
 *                                  enabling), not a permission refusal
 *   timed_out  region_deadline     the region started and ran past its deadline
 *   timed_out  throttled           a listing failed after its throttle retries
 *   timed_out  call_timeout        one call ran past the 15 s call limit
 *   timed_out  scan_budget         the region never started: the scan budget ran out
 *   failed     error               any other failure
 *   partial    discovery_listing_truncated / deletion_detection_paused_truncated_index
 *
 * AWS's error text is read to tell a service control policy apart and nothing
 * else; it is never stored or logged.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { AwsCallPolicy, AwsCallTimeoutError, isAccessDeniedError, isThrottlingError } from '../utils/awsCallPolicy';
import { THROTTLE_BREAKER_FLOOR, THROTTLE_BREAKER_STEP } from '../config/discovery-concurrency';
import { SourceOutcome, SourceStatus } from './source-outcome';
import { HOME_REGION_SOURCES, HomeRegionScanResult, homeRegionScanStatus } from './region-scan-status';

export const REGION_CODE_ACCESS_DENIED = 'access_denied';
export const REGION_CODE_ACCESS_DENIED_SCP = 'access_denied_scp';
export const REGION_CODE_NOT_READY = 'region_not_ready';
export const REGION_CODE_DEADLINE = 'region_deadline';
export const REGION_CODE_THROTTLED = 'throttled';
export const REGION_CODE_CALL_TIMEOUT = 'call_timeout';
export const REGION_CODE_SCAN_BUDGET = 'scan_budget';
export const REGION_CODE_ERROR = 'error';

/** The region's deadline passed: its calls stop, and the region is timed_out (region_deadline). */
export class RegionDeadlineError extends Error {
  constructor(readonly region: string) {
    super(`REGION_DEADLINE: region ${region} ran past its deadline`);
    this.name = 'RegionDeadlineError';
  }
}

export function isRegionDeadline(error: unknown): error is RegionDeadlineError {
  return error instanceof RegionDeadlineError;
}

/**
 * The whole scan's deadline passed (PR 1b, review M-2): a step after the regions was
 * not started, or was stopped. Distinct from a region's own deadline
 * (RegionDeadlineError, region_deadline), the scan budget (scan_budget, a region never
 * started), a lost lease (LeaseLostError) and a genuine failure: it is recorded as the
 * warning scan_deadline on a completed job.
 */
export class ScanDeadlineError extends Error {
  constructor(readonly step: string) {
    super(`SCAN_DEADLINE: the scan deadline passed (${step})`);
    this.name = 'ScanDeadlineError';
  }
}

export function isScanDeadline(error: unknown): error is ScanDeadlineError {
  return error instanceof ScanDeadlineError;
}

/** A source outcome inside a region, with why it failed (one of the codes above). */
export interface RegionSourceOutcome extends SourceOutcome {
  reason?: string;
}

/** Enabled in the account's list, but AWS does not accept the session there yet. */
const NOT_READY_ERROR_NAMES = new Set(['AuthFailure', 'UnrecognizedClientException', 'OptInRequired', 'InvalidClientTokenId']);

const SERVICE_CONTROL_POLICY = /service control polic/i;

function errorName(error: unknown): string | undefined {
  const e = error as { name?: unknown; Code?: unknown; code?: unknown } | null | undefined;
  return [e?.name, e?.Code, e?.code].find((name): name is string => typeof name === 'string');
}

/** How a listing that threw `error` in a region is recorded: its status and its reason code. */
export function classifyRegionFailure(error: unknown): { status: SourceStatus; reason: string } {
  if (isRegionDeadline(error)) return { status: 'timed_out', reason: REGION_CODE_DEADLINE };
  if (error instanceof AwsCallTimeoutError) return { status: 'timed_out', reason: REGION_CODE_CALL_TIMEOUT };
  if (isThrottlingError(error)) return { status: 'timed_out', reason: REGION_CODE_THROTTLED };
  const name = errorName(error);
  if (name && NOT_READY_ERROR_NAMES.has(name)) return { status: 'failed', reason: REGION_CODE_NOT_READY };
  if (isAccessDeniedError(error)) {
    const message = (error as { message?: unknown })?.message;
    return {
      status: 'denied',
      reason: typeof message === 'string' && SERVICE_CONTROL_POLICY.test(message) ? REGION_CODE_ACCESS_DENIED_SCP : REGION_CODE_ACCESS_DENIED,
    };
  }
  return { status: 'failed', reason: REGION_CODE_ERROR };
}

/**
 * A region's status from its own listings (the same sources and worst-wins rule as
 * the home region's, region-scan-status.ts), with the failure's reason code. A
 * region whose deadline passed is timed_out with region_deadline whatever else
 * happened in it: it did not finish. Null when no source counts.
 */
export function regionScanResult(
  outcomes: readonly RegionSourceOutcome[],
  deadlineHit: boolean,
  sources: readonly string[] = HOME_REGION_SOURCES
): HomeRegionScanResult | null {
  if (deadlineHit) return { status: 'timed_out', errorCode: REGION_CODE_DEADLINE };
  const base = homeRegionScanStatus(outcomes, sources);
  if (!base || base.status === 'ok' || base.status === 'partial') return base;
  const counted = outcomes.filter((o) => sources.includes(o.source) && o.status === base.status);
  // An organization policy refusing the region explains every other refusal in it.
  const reasons = counted.map((o) => o.reason).filter((reason): reason is string => !!reason);
  const reason = reasons.includes(REGION_CODE_ACCESS_DENIED_SCP) ? REGION_CODE_ACCESS_DENIED_SCP : reasons[0];
  return { status: base.status, errorCode: reason ?? defaultCode(base.status) };
}

function defaultCode(status: HomeRegionScanResult['status']): string {
  if (status === 'denied') return REGION_CODE_ACCESS_DENIED;
  if (status === 'timed_out') return REGION_CODE_CALL_TIMEOUT;
  return REGION_CODE_ERROR;
}

/** The source name of a region's security-group listing (DescribeSecurityGroups). */
export const SECURITY_GROUPS_SOURCE = 'security-groups';

/**
 * The sources a NON-home region's status is made of (PR 1b, review M-4): the home
 * region's sources plus its security-group listing, so a region whose security groups
 * could not be read is not checked completely (region_incomplete) and its networking
 * findings are not resolved. The home region's status keeps the M5b sources
 * (region-scan-status.ts): a home security-group failure is the job's
 * (compliance_scan_completed = false), as before.
 */
export const NON_HOME_REGION_SOURCES: readonly string[] = [...HOME_REGION_SOURCES, SECURITY_GROUPS_SOURCE];

/** The status of an enabled region the scan never started (the scan budget ran out). */
export const SCAN_BUDGET_RESULT: HomeRegionScanResult = { status: 'timed_out', errorCode: REGION_CODE_SCAN_BUDGET };

/** Whether a region's result counts as not checked (for region_incomplete and "every region failed"). */
export function regionFailed(result: HomeRegionScanResult | null): boolean {
  return !!result && result.status !== 'ok' && result.status !== 'partial';
}

export interface RegionRunOptions {
  deadlineMs: number;
  resourcePool: number;
  now?: () => number;
}

/** One region's run: started when constructed, stopped with stop(). */
export class RegionRun {
  readonly startedAt: number;
  throttles = 0;
  calls = 0;
  /** Listings started in this region (sources run). */
  listings = 0;
  /** Metrics requested through CloudWatch GetMetricData (each one is billed), attempts included. */
  getMetricDataMetrics = 0;
  /** CloudWatch GetMetricStatistics requests, attempts included. */
  getMetricStatisticsRequests = 0;

  private pool: number;
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private readonly now: () => number;

  constructor(readonly region: string, options: RegionRunOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.pool = options.resourcePool;
    this.timer = setTimeout(() => this.controller.abort(new RegionDeadlineError(region)), options.deadlineMs);
    this.timer.unref?.();
  }

  /** The signal every call of this region's clients is made under. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get deadlineHit(): boolean {
    return this.controller.signal.aborted;
  }

  /** Throws RegionDeadlineError once the deadline has passed (between steps). */
  checkDeadline(): void {
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
  }

  /** The region's resource pool now (the breaker may have lowered it). */
  readonly concurrency = (): number => this.pool;

  readonly onThrottle = (): void => {
    this.throttles++;
    if (this.throttles % THROTTLE_BREAKER_STEP === 0) {
      this.pool = Math.max(Math.min(THROTTLE_BREAKER_FLOOR, this.pool), Math.floor(this.pool / 2));
    }
  };

  readonly onCall = (command: unknown): void => {
    this.calls++;
    const name = (command as { constructor?: { name?: string } } | null)?.constructor?.name;
    if (name === 'GetMetricDataCommand') {
      const queries = (command as { input?: { MetricDataQueries?: unknown[] } }).input?.MetricDataQueries;
      this.getMetricDataMetrics += Array.isArray(queries) ? queries.length : 0;
    } else if (name === 'GetMetricStatisticsCommand') {
      this.getMetricStatisticsRequests++;
    }
  };

  /** `base` with this region's deadline, breaker and counts. */
  policy(base: AwsCallPolicy): AwsCallPolicy {
    return { ...base, signal: this.signal, onThrottle: this.onThrottle, onCall: this.onCall };
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /**
   * The one structured line logged after the region (A7): the organization's
   * internal id only, never an AWS account ID, ARN, resource or bucket name.
   */
  logLine(organizationId: string, result: HomeRegionScanResult | null): string {
    return JSON.stringify({
      event: 'discovery_region_scan',
      organization_id: organizationId,
      region: this.region,
      duration_ms: this.now() - this.startedAt,
      listings: this.listings,
      calls: this.calls,
      throttles: this.throttles,
      resource_pool: this.pool,
      outcome: result?.status ?? 'not_recorded',
      reason: result?.errorCode ?? null,
      get_metric_data_metrics: this.getMetricDataMetrics,
      get_metric_statistics_requests: this.getMetricStatisticsRequests,
    });
  }
}

/** The structured line for a region the scan never started (scan budget). */
export function notStartedLogLine(organizationId: string, region: string): string {
  return JSON.stringify({
    event: 'discovery_region_scan',
    organization_id: organizationId,
    region,
    duration_ms: 0,
    listings: 0,
    calls: 0,
    throttles: 0,
    resource_pool: null,
    outcome: SCAN_BUDGET_RESULT.status,
    reason: SCAN_BUDGET_RESULT.errorCode,
    get_metric_data_metrics: 0,
    get_metric_statistics_requests: 0,
  });
}

/**
 * Runs `start` for each region, at most `size` at a time, in the order given (the
 * home region first). Before a region is started, `budgetExpired()` is asked: once
 * it is true no region is started again, and every region not yet started is passed
 * to `notStarted` instead. A region's own failure is its own (`start` settles it);
 * if `start` throws (a lost lease, a changed connection), no further region starts
 * and the first such error is rethrown once the running ones have ended.
 */
export async function runRegionPool(
  regions: readonly string[],
  size: number,
  start: (region: string) => Promise<void>,
  budgetExpired: () => boolean,
  notStarted: (region: string) => void
): Promise<void> {
  let next = 0;
  let stopped: unknown;
  const worker = async () => {
    while (next < regions.length && stopped === undefined) {
      if (budgetExpired()) {
        while (next < regions.length) notStarted(regions[next++]);
        return;
      }
      const region = regions[next++];
      try {
        await start(region);
      } catch (error) {
        stopped ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, regions.length)) }, worker));
  if (stopped !== undefined) throw stopped;
}

/** A region database step asked for another step from inside itself (StepLimiter): a programming error, never retried. */
export class NestedRegionStepError extends Error {
  constructor() {
    super('NESTED_REGION_STEP: a region database step may not start another one');
    this.name = 'NestedRegionStepError';
  }
}

/**
 * At most `size` of a scan's region database steps at a time (multi-region PR 1b,
 * review M-1). A region worker holds no database connection of its own: each of its
 * database steps (a fenced write, its status write, its security-group findings)
 * checks one out for that step only, and this limiter bounds how many such steps of
 * one scan hold a connection at once. Steps run in the order they asked.
 *
 * No deadlock: a step's body runs database statements on its own connection only
 * (it never waits for another region's step), so every holder finishes (statement and
 * idle-in-transaction timeouts bound it) and hands its slot on in `finally`. A step
 * started from inside a step is refused (NestedRegionStepError), never queued.
 */
export class StepLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  // Set inside a step: a step that asked for another step from within itself would
  // wait for a slot it holds (a deadlock at size 1); it is refused instead.
  private readonly inStep = new AsyncLocalStorage<true>();

  constructor(private readonly size: number) {}

  async run<T>(step: () => Promise<T>): Promise<T> {
    if (this.inStep.getStore()) throw new NestedRegionStepError();
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await this.inStep.run(true, step);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** How a step after the regions ended against the scan deadline. */
export interface PostRegionTimeout {
  step: string;
  /** not_started: the deadline had passed before it; not_finished: it was stopped. */
  phase: 'not_started' | 'not_finished';
}

/**
 * A multi-region scan's whole-scan deadline (PR 1b, review M-2), measured from the
 * lease's acquisition: `deadlineMs` after `startedAt` by `now()`, and by a real timer
 * that aborts `signal` then, so AWS calls made under policy() are stopped. Each step
 * after the regions asks expired() before it starts and again when it ends; what it
 * reports is kept in `timeouts`.
 */
export class ScanDeadline {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  readonly timeouts: PostRegionTimeout[] = [];

  constructor(private readonly deadlineMs: number, private readonly startedAt: number, private readonly now: () => number = Date.now) {
    const remaining = Math.max(0, deadlineMs - (now() - startedAt));
    this.timer = setTimeout(() => this.abort('timer'), remaining);
    this.timer.unref?.();
  }

  private abort(step: string): void {
    if (!this.controller.signal.aborted) this.controller.abort(new ScanDeadlineError(step));
  }

  /** Whether the deadline has passed (by the clock or the timer). */
  expired(): boolean {
    if (!this.controller.signal.aborted && this.now() - this.startedAt >= this.deadlineMs) this.abort('clock');
    return this.controller.signal.aborted;
  }

  /** Milliseconds left (0 once passed). */
  remainingMs(): number {
    return this.expired() ? 0 : Math.max(0, this.deadlineMs - (this.now() - this.startedAt));
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** `base` with this deadline: its calls are aborted when it passes. */
  policy(base: AwsCallPolicy): AwsCallPolicy {
    return { ...base, signal: this.signal };
  }

  /** Before a step: false (and recorded as not_started) when the deadline has passed. */
  mayStart(step: string): boolean {
    if (!this.expired()) return true;
    this.timeouts.push({ step, phase: 'not_started' });
    return false;
  }

  /** After a step that started: true (and recorded as not_finished) when the deadline passed while it ran. */
  stoppedDuring(step: string): boolean {
    if (!this.expired()) return false;
    this.timeouts.push({ step, phase: 'not_finished' });
    return true;
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
