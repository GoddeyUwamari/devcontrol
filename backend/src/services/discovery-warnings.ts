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
 * DISCOVERY_WARNING_SCAN_LEASE_LOST) is written to the column only, never to
 * error_message.
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

export const DISCOVERY_WARNINGS = [
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_SCAN_LEASE_LOST,
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
