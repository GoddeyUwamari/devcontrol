/**
 * Discovery warnings: a run that completed, but with one of its checks
 * deliberately not run. Unlike an error, a warning does not fail the job, so
 * every "last refreshed" reader (which reads status = 'completed') advances.
 *
 * resource_discovery_jobs has no warnings column, so warnings are stored as
 * fixed codes in error_message, joined with the same '; ' separator as error
 * segments (DISCOVERY_ERROR_SEPARATOR in observability-readiness.service.ts).
 * splitDiscoveryMessage() separates them again: GET /discovery/jobs returns
 * them as `warnings`, and the readiness gate ignores them.
 */

/**
 * The Resource Explorer search may have been cut off (see SearchResult in
 * resourceExplorer.service.ts), so no resource was counted missing or
 * terminated from it this run.
 */
export const DISCOVERY_WARNING_TRUNCATED_INDEX = 'deletion_detection_paused_truncated_index';

export const DISCOVERY_WARNINGS = [DISCOVERY_WARNING_TRUNCATED_INDEX] as const;

export type DiscoveryWarning = (typeof DISCOVERY_WARNINGS)[number];

const SEPARATOR = '; ';

function isDiscoveryWarning(segment: string): segment is DiscoveryWarning {
  return (DISCOVERY_WARNINGS as readonly string[]).includes(segment);
}

/** The stored error_message for a run's errors and warnings: null when there are neither. */
export function joinDiscoveryMessage(errors: string[], warnings: DiscoveryWarning[]): string | null {
  const segments = [...errors, ...warnings];
  return segments.length > 0 ? segments.join(SEPARATOR) : null;
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
