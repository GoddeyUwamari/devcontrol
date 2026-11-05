/**
 * The one rule for choosing the Dashboard's Top Risk from account-level
 * security findings (security groups, IAM). Pure: no database or AWS call.
 *
 * Eligible: an active finding of critical, high or medium severity that the
 * customer has not marked accepted risk or dismissed. Acknowledged stays
 * eligible: it says someone has seen the finding, not that it no longer needs
 * action. A low finding is never the Top Risk.
 *
 * Order: most severe first. Findings of equal severity keep the order they
 * were given in -- AccountSecurityFindingsRepository.getActive() returns newest
 * detection first, so the newest of the most severe wins, as before.
 *
 * Choosing nothing is not "no risk": what the Dashboard shows instead depends
 * on the rest of the evidence (AISummaryService.topRiskFor).
 */

export type TopRiskSeverity = 'critical' | 'high' | 'medium';

/** Severities a Top Risk can have, most severe first. */
export const TOP_RISK_SEVERITIES: readonly TopRiskSeverity[] = ['critical', 'high', 'medium'];

/** Dispositions that take a finding out of Top Risk (founder decision D-B3). */
export const TOP_RISK_EXCLUDED_DISPOSITIONS: readonly string[] = ['accepted_risk', 'dismissed'];

/** The fields of an account finding this rule reads. */
export interface TopRiskCandidate {
  title: string;
  severity: string;
  disposition?: string | null;
}

/** A critical, high or medium finding the customer marked accepted risk or dismissed. */
export function isReviewedUrgent(finding: TopRiskCandidate): boolean {
  return (TOP_RISK_SEVERITIES as readonly string[]).includes(finding.severity)
    && !!finding.disposition && TOP_RISK_EXCLUDED_DISPOSITIONS.includes(finding.disposition);
}

export function isTopRiskEligible(finding: TopRiskCandidate): boolean {
  if (!(TOP_RISK_SEVERITIES as readonly string[]).includes(finding.severity)) return false;
  return !(finding.disposition && TOP_RISK_EXCLUDED_DISPOSITIONS.includes(finding.disposition));
}

/** The Top Risk finding, or null when no finding is eligible. */
export function selectTopRiskFinding(findings: readonly TopRiskCandidate[]): { title: string; severity: TopRiskSeverity } | null {
  for (const severity of TOP_RISK_SEVERITIES) {
    const top = findings.find((finding) => finding.severity === severity && isTopRiskEligible(finding));
    if (top) return { title: top.title, severity };
  }
  return null;
}

/**
 * W11 (founder-approved, Nov 4): shown only when the latest security evaluation
 * completed and is current, and no critical, high or medium finding is open at
 * all -- an accepted or dismissed one is still open, so it keeps W11 away (the
 * text would otherwise be false). `count` is every finding still open, all of
 * them low.
 */
export function noUrgentFindingsLine(count: number): string {
  return `No critical, high or medium findings open. ${count} lower-priority finding${count === 1 ? '' : 's'} on the Security page.`;
}

/**
 * W11b (founder-approved, Nov 4): shown only when the latest security evaluation
 * completed and is current, no critical, high or medium finding is open that the
 * customer has not reviewed, and `count` (at least one) critical, high or medium
 * findings are open that the customer accepted or dismissed. Never names a finding.
 */
export function reviewedFindingsLine(count: number): string {
  return `No critical, high or medium findings need attention. ${count} you accepted or dismissed ${count === 1 ? 'is' : 'are'} on the Security page.`;
}
