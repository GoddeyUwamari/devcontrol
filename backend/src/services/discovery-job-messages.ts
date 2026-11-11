import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from './platform-sts';
import { DISCOVERY_INTERRUPTED_MESSAGE, DISCOVERY_LEASE_LOST_MESSAGE } from './scan-session';

/**
 * The text a discovery job's error_message may show its organization.
 *
 * resource_discovery_jobs.error_message keeps the full text discovery wrote,
 * including raw provider errors from individual steps ("EC2: <AWS error>"), for
 * diagnostics. GET /api/aws-resources/discovery/jobs returns it only through
 * publicDiscoveryErrorMessage(): a segment that is exactly one of the approved
 * fixed messages passes through, and anything else becomes one fixed line.
 * No prefix or substring match: an approved prefix followed by raw text is
 * still raw text.
 */

/** What a fatally failed discovery job stores in error_message, for the organization to read (B2, approved copy, AWS connect PR D1). */
export const DISCOVERY_FAILED_MESSAGE = 'Discovery could not complete. Check the AWS connection on the Connect AWS page, then try again.';

/**
 * Texts earlier releases stored, shown as today's text when read (CP-D12 note):
 * rows already in resource_discovery_jobs keep their text, and no data migration
 * rewrites them. Exact match only, like every approved message.
 */
export const LEGACY_DISCOVERY_MESSAGES: Readonly<Record<string, string>> = {
  'Discovery could not complete. Check the AWS connection in Settings, then try again.': DISCOVERY_FAILED_MESSAGE,
};

/** The job's error text when no cost detector completed (approved, PR 1 #5). */
export const COST_NO_CHECK_COMPLETED = 'none of the checks completed.';
export const COST_NO_CHECK_COMPLETED_MESSAGE = `Cost analysis: ${COST_NO_CHECK_COMPLETED}`;

/** What every other error segment reads as (founder-approved, PR 2). */
export const DISCOVERY_STEPS_INCOMPLETE_MESSAGE = "Some discovery steps didn't complete.";

const SEPARATOR = '; ';

/** Read at call time, so an import cycle can never leave an entry undefined. */
export function approvedDiscoveryMessages(): readonly string[] {
  return [
    DISCOVERY_FAILED_MESSAGE,
    PLATFORM_AWS_UNAVAILABLE_MESSAGE,
    DISCOVERY_LEASE_LOST_MESSAGE,
    DISCOVERY_INTERRUPTED_MESSAGE,
    COST_NO_CHECK_COMPLETED_MESSAGE,
  ];
}

/**
 * A job's error text as the API returns it. Takes the error part only (warning
 * codes already removed by splitDiscoveryMessage). Null stays null. Each
 * segment is kept only if it is exactly an approved message; every other
 * segment is replaced, and the replacement appears once.
 *
 * An approved message may itself contain the separator (the platform message
 * does), so at each position an approved message is matched whole first, and
 * only otherwise is the text up to the next separator taken as one segment.
 */
export function publicDiscoveryErrorMessage(errorMessage: string | null | undefined): string | null {
  if (errorMessage === null || errorMessage === undefined || errorMessage === '') return null;
  const approved = [...approvedDiscoveryMessages(), ...Object.keys(LEGACY_DISCOVERY_MESSAGES)];
  const out: string[] = [];
  const add = (shown: string) => {
    if (!out.includes(shown)) out.push(shown);
  };
  let rest = errorMessage;
  while (rest.length > 0) {
    const whole = approved.find((message) => rest === message || rest.startsWith(message + SEPARATOR));
    if (whole) {
      add(LEGACY_DISCOVERY_MESSAGES[whole] ?? whole);
      rest = rest.slice(whole.length + SEPARATOR.length);
      continue;
    }
    add(DISCOVERY_STEPS_INCOMPLETE_MESSAGE);
    const next = rest.indexOf(SEPARATOR);
    rest = next < 0 ? '' : rest.slice(next + SEPARATOR.length);
  }
  return out.join(SEPARATOR);
}
