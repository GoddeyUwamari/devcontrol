/**
 * Discovery warnings: a run that completed, but with one of its checks
 * deliberately not run. Unlike an error, a warning does not fail the job, so
 * every "last refreshed" reader (which reads status = 'completed') advances.
 *
 * Warnings are stored as fixed codes in resource_discovery_jobs.warnings (a JSONB
 * array, added by the multi-region M3 admin migration). For one release the codes
 * that existed before that column (LEGACY_MESSAGE_WARNINGS) are also still
 * appended to error_message, joined with the same '; ' separator as error segments
 * (DISCOVERY_ERROR_SEPARATOR in observability-readiness.service.ts), so a rollback
 * to code that reads only error_message still shows them. splitDiscoveryMessage()
 * separates them again: readers take the column when it is set and fall back to
 * error_message for older rows (jobWarnings()), and the readiness gate ignores them.
 * A code added after the column (DISCOVERY_WARNING_LISTING_TRUNCATED,
 * DISCOVERY_WARNING_SCAN_LEASE_LOST, DISCOVERY_WARNING_CONNECTION_CHANGED and the
 * multi-region PR 1 codes) is written to the column only, never to error_message.
 */

/**
 * The Resource Explorer search may have been cut off (see SearchResult in
 * resourceExplorer.service.ts), so no resource was counted missing or
 * terminated from it this run.
 */
export const DISCOVERY_WARNING_TRUNCATED_INDEX = 'deletion_detection_paused_truncated_index';

/**
 * A discovery listing stopped at its page limit (listAllPages in
 * utils/awsCallPolicy.ts): what it read was stored, but nothing it speaks for was
 * counted missing or terminated this run. Internal: no page renders it.
 */
export const DISCOVERY_WARNING_LISTING_TRUNCATED = 'discovery_listing_truncated';

/**
 * The scan stopped because another scan took over its lease (multi-region plan M4b,
 * Q3); its job row carries the approved lease-lost text. Internal: no page renders it.
 */
export const DISCOVERY_WARNING_SCAN_LEASE_LOST = 'scan_lease_lost';

/**
 * The scan stopped because the organization's AWS connection changed while it ran
 * (AWS connect PR B, prB-plan.md D4): nothing more from the old connection was
 * written, and its job row carries the approved interrupted text. Internal: no page
 * renders it.
 */
export const DISCOVERY_WARNING_CONNECTION_CHANGED = 'connection_changed';

/**
 * Multi-region PR 1 (MR-D6, A3): at least one enabled region could not be checked
 * completely on this scan (denied, timed out, failed, or never started because of
 * the scan budget). The job still completed: what was checked was recorded, each
 * region's own status is in aws_account_regions, and nothing in a region that was
 * not checked completely was reconciled.
 */
export const DISCOVERY_WARNING_REGION_INCOMPLETE = 'region_incomplete';

/**
 * Multi-region PR 1 (A2): the 45-minute scan budget ran out, so at least one
 * enabled region was never started on this scan. Each such region's status carries
 * the same code (aws_account_regions.last_error_code = 'scan_budget').
 */
export const DISCOVERY_WARNING_SCAN_BUDGET = 'scan_budget';

/**
 * Multi-region PR 1 (A5, founder decision Nov 14): a region scanned has no active
 * Resource Explorer index, so no Search was made there (a Search can create an
 * index in the customer's account). The generic types (VPC, SQS, SNS, ...) were not
 * listed or reconciled in that region; every own listing still ran. Not an error,
 * not a region failure. Applies with the multi-region flag on and off.
 */
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX = 'resource_explorer_no_index';

/**
 * Multi-region PR 1 (review M-3, founder decision Nov 14): a region scanned has an
 * active Resource Explorer index, but its Search was refused with 401
 * UnauthorizedException: the region has no default view, or the role cannot use it
 * (Step 1 §A3; AWS Resource Explorer API Reference, Search). Handled as "not indexed":
 * the generic types were not listed or reconciled in that region; every own listing
 * still ran. Not an error, not a region failure, with the multi-region flag on and off.
 * A code of its own because the cause and the remedy (a default view) differ from
 * resource_explorer_no_index.
 */
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW = 'resource_explorer_no_view';

export const DISCOVERY_WARNINGS = [
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_SCAN_LEASE_LOST,
  DISCOVERY_WARNING_CONNECTION_CHANGED,
  DISCOVERY_WARNING_REGION_INCOMPLETE,
  DISCOVERY_WARNING_SCAN_BUDGET,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
] as const;

export type DiscoveryWarning = (typeof DISCOVERY_WARNINGS)[number];

/** The codes that are also still written to error_message (see the module comment). */
export const LEGACY_MESSAGE_WARNINGS: readonly DiscoveryWarning[] = [DISCOVERY_WARNING_TRUNCATED_INDEX];

const SEPARATOR = '; ';

function isDiscoveryWarning(segment: string): segment is DiscoveryWarning {
  return (DISCOVERY_WARNINGS as readonly string[]).includes(segment);
}

/**
 * The stored error_message for a run's errors and warnings: null when there are
 * neither. Only LEGACY_MESSAGE_WARNINGS are appended; the column holds them all.
 */
export function joinDiscoveryMessage(errors: string[], warnings: DiscoveryWarning[]): string | null {
  const segments = [...errors, ...warnings.filter((warning) => LEGACY_MESSAGE_WARNINGS.includes(warning))];
  return segments.length > 0 ? segments.join(SEPARATOR) : null;
}

/** The stored warnings column for a run: a JSON array of its codes, or null when it has none. */
export function discoveryWarningsColumn(warnings: DiscoveryWarning[]): string | null {
  const codes = [...new Set(warnings)];
  return codes.length > 0 ? JSON.stringify(codes) : null;
}

/** A stored error_message split back into its error text (null when none) and its warnings. */
export function splitDiscoveryMessage(message: string | null | undefined): {
  errorMessage: string | null;
  warnings: DiscoveryWarning[];
} {
  if (!message) return { errorMessage: message ?? null, warnings: [] };
  const segments = message.split(SEPARATOR);
  const warnings = segments.filter(isDiscoveryWarning);
  if (warnings.length === 0) return { errorMessage: message, warnings: [] };
  const errors = segments.filter((segment) => !isDiscoveryWarning(segment));
  return { errorMessage: errors.length > 0 ? errors.join(SEPARATOR) : null, warnings };
}

/**
 * A job row's warnings: the warnings column when it is set (only known codes are
 * passed on, never free text), otherwise the codes encoded in its error_message
 * (rows written before the column, or where the column does not exist).
 */
export function jobWarnings(column: unknown, errorMessage: string | null | undefined): DiscoveryWarning[] {
  if (Array.isArray(column)) {
    return [...new Set(column.filter((code): code is DiscoveryWarning => typeof code === 'string' && isDiscoveryWarning(code)))];
  }
  return splitDiscoveryMessage(errorMessage).warnings;
}
