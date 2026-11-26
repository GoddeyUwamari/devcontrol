/**
 * The home region's scan status (multi-region plan M5b, m5-plan.md §13): one
 * status per scan, from how the home region's inventory listings fared
 * (source-outcome.ts).
 *
 * Which sources count: the EC2, EBS, RDS, Lambda and load-balancer listings and
 * the Resource Explorer search, all made through the home region's endpoint.
 * Not the S3 listing (every region), CloudFront or IAM (global), the
 * security-group scan (findings, not inventory), enrichment or any cleanup step.
 * A source the organization's tier does not include (skipped_tier) is left out.
 *
 * The worst outcome wins: denied > timed_out > failed > partial > ok. `denied`
 * means at least one source was denied, not the whole region. Only `partial`
 * carries a code, one of the two existing truncation codes or (region-access PR (b))
 * one of the three Resource Explorer codes.
 *
 * Region-access PR (b): Resource Explorer is an OPTIONAL source. When one of its calls
 * failed (the outcome names the call: `operation`) and every other counted source (the
 * core listings) completed or was only cut off, the Resource Explorer failure does not
 * win: the region is `partial`. Its code is the core truncation code when a core listing
 * was cut off (founder ruling Q2: core evidence wins), otherwise the Resource Explorer
 * code of the failure (resourceExplorerFailureCode), with that call's diagnostic. A core
 * failure still wins exactly as before (a refused EC2 or RDS listing is `denied`), and a
 * Resource Explorer outcome with no `operation` (its results could not be stored) or a
 * region with no counted core source keeps the worst-wins rule.
 */
import { SourceOutcome, SourceStatus } from './source-outcome';
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  RESOURCE_EXPLORER_FAILURE_CODES,
} from './discovery-warnings';

/** One of the three Resource Explorer failure codes (discovery-warnings.ts). */
export type ResourceExplorerFailureCode = (typeof RESOURCE_EXPLORER_FAILURE_CODES)[number];

/** The source name of the home region's Resource Explorer search. */
export const RESOURCE_EXPLORER_SOURCE = 'resource-explorer';

/** The sources the home region's status is made of. */
export const HOME_REGION_SOURCES: readonly string[] = ['ec2', 'ebs', 'rds', 'lambda', 'load-balancer', RESOURCE_EXPLORER_SOURCE];

export type HomeRegionScanStatus = 'ok' | 'partial' | 'failed' | 'denied' | 'timed_out';

export interface HomeRegionScanResult {
  status: HomeRegionScanStatus;
  /**
   * The home region's status (M5b): set for `partial` only, which listing was cut off.
   * A multi-region scan's region (region-run.ts) also sets it for a failure (its reason
   * code) and, on an `ok` region, for its Resource Explorer warning (PR 2, RR-M2).
   */
  errorCode: string | null;
  /**
   * Region-access PR 1: the failing call that set a failure's code, as
   * `<source>:<operation>:<AWS error name>` (region-log-context.ts sourceDiagnostic), when
   * that call is known; stored in last_error_message. Absent otherwise. Never AWS text.
   */
  diagnostic?: string;
}

/** Failure statuses, worst first: a source's status is the region's. */
const FAILURES = ['denied', 'timed_out', 'failed'] as const satisfies readonly (SourceStatus & HomeRegionScanStatus)[];

/**
 * What the status rule reads of an outcome besides its source and status (region-run.ts
 * RegionSourceOutcome): the reason code, the failed call's diagnostic, and (region-access
 * PR (b)) which Resource Explorer call failed.
 */
export interface ScanStatusOutcome extends SourceOutcome {
  reason?: string;
  diagnostic?: string;
  operation?: string;
}

/**
 * The Resource Explorer code of a failed Resource Explorer call (region-access PR (b)),
 * from its reason code (region-run.ts classifyRegionFailure; the literals are pinned
 * against REGION_CODE_* in region-diagnostic.test.ts): refused -> denied, throttled ->
 * throttled, anything else (a call timeout included) -> failed. Without a reason, a
 * `denied` status is a refusal and anything else a failure.
 */
export function resourceExplorerFailureCode(outcome: Pick<ScanStatusOutcome, 'status' | 'reason'>): ResourceExplorerFailureCode {
  const reason = outcome.reason;
  if (reason === 'access_denied' || reason === 'access_denied_scp') return DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED;
  if (reason === 'throttled') return DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED;
  if (reason === undefined && outcome.status === 'denied') return DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED;
  return DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED;
}

/**
 * The optional Resource Explorer failure of a region (region-access PR (b)): its failed
 * Resource Explorer outcome when that outcome names a failed call and every other counted
 * source completed or was cut off (at least one of them counted); otherwise null, and the
 * worst-wins rule applies as before.
 */
export function optionalResourceExplorerFailure(
  outcomes: readonly ScanStatusOutcome[],
  sources: readonly string[] = HOME_REGION_SOURCES
): { outcome: ScanStatusOutcome; coreTruncated: boolean } | null {
  const counted = outcomes.filter((o) => sources.includes(o.source) && o.status !== 'skipped_tier');
  const explorer = counted.find(
    (o) => o.source === RESOURCE_EXPLORER_SOURCE && (FAILURES as readonly string[]).includes(o.status) && typeof o.operation === 'string'
  );
  if (!explorer) return null;
  const core = counted.filter((o) => o.source !== RESOURCE_EXPLORER_SOURCE);
  if (core.length === 0 || !core.every((o) => o.status === 'complete' || o.status === 'truncated')) return null;
  return { outcome: explorer, coreTruncated: core.some((o) => o.status === 'truncated') };
}

/**
 * The home region's status from the scan's source outcomes, or null when no
 * source counts (nothing is then written). Outcomes of other sources are ignored.
 * `sources`: which sources count (a non-home region of a multi-region scan also
 * counts its security-group listing, region-run.ts NON_HOME_REGION_SOURCES).
 */
export function homeRegionScanStatus(outcomes: readonly ScanStatusOutcome[], sources: readonly string[] = HOME_REGION_SOURCES): HomeRegionScanResult | null {
  const counted = outcomes.filter((o) => sources.includes(o.source) && o.status !== 'skipped_tier');
  if (counted.length === 0) return null;

  // Region-access PR (b): an optional Resource Explorer failure never wins over the core.
  const optional = optionalResourceExplorerFailure(outcomes, sources);
  if (optional) {
    // Founder ruling Q2: a cut-off core listing's code wins (the call is still logged,
    // saved with the scan's sources for the home region, and a job warning).
    if (optional.coreTruncated) return { status: 'partial', errorCode: DISCOVERY_WARNING_LISTING_TRUNCATED };
    const { diagnostic } = optional.outcome;
    const errorCode = resourceExplorerFailureCode(optional.outcome);
    return diagnostic ? { status: 'partial', errorCode, diagnostic } : { status: 'partial', errorCode };
  }

  const statuses = new Set<SourceStatus>(counted.map((o) => o.status));
  for (const failure of FAILURES) {
    if (statuses.has(failure)) return { status: failure, errorCode: null };
  }
  // A status that is neither complete nor truncated (none is produced today) is a failure, never ok.
  if (counted.some((o) => o.status !== 'complete' && o.status !== 'truncated')) return { status: 'failed', errorCode: null };

  const truncated = counted.filter((o) => o.status === 'truncated');
  if (truncated.length === 0) return { status: 'ok', errorCode: null };
  return {
    status: 'partial',
    errorCode: truncated.some((o) => o.source === RESOURCE_EXPLORER_SOURCE)
      ? DISCOVERY_WARNING_TRUNCATED_INDEX
      : DISCOVERY_WARNING_LISTING_TRUNCATED,
  };
}
