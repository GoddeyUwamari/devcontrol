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
 * carries a code, one of the two existing truncation codes; no code is new.
 */
import { SourceOutcome, SourceStatus } from './source-outcome';
import { DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_TRUNCATED_INDEX } from './discovery-warnings';

/** The source name of the home region's Resource Explorer search. */
export const RESOURCE_EXPLORER_SOURCE = 'resource-explorer';

/** The sources the home region's status is made of. */
export const HOME_REGION_SOURCES: readonly string[] = ['ec2', 'ebs', 'rds', 'lambda', 'load-balancer', RESOURCE_EXPLORER_SOURCE];

export type HomeRegionScanStatus = 'ok' | 'partial' | 'failed' | 'denied' | 'timed_out';

export interface HomeRegionScanResult {
  status: HomeRegionScanStatus;
  /** Set for `partial` only: which listing was cut off. */
  errorCode: string | null;
}

/** Failure statuses, worst first: a source's status is the region's. */
const FAILURES = ['denied', 'timed_out', 'failed'] as const satisfies readonly (SourceStatus & HomeRegionScanStatus)[];

/**
 * The home region's status from the scan's source outcomes, or null when no
 * source counts (nothing is then written). Outcomes of other sources are ignored.
 */
export function homeRegionScanStatus(outcomes: readonly SourceOutcome[]): HomeRegionScanResult | null {
  const counted = outcomes.filter((o) => HOME_REGION_SOURCES.includes(o.source) && o.status !== 'skipped_tier');
  if (counted.length === 0) return null;

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
