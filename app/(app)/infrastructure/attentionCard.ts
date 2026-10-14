/**
 * The wording of Infrastructure's red card.
 *
 * The card's number is the count of resources that need attention: those carrying a
 * Critical or High finding, those there through a cost recommendation, and those
 * stopped, degraded or failed. It used to be titled "Critical Issues", which the
 * number never was: it could read 4 with no Critical finding anywhere.
 *
 * The title now says what is counted, and the line under it says why, from the
 * same computation that produced the count:
 *   "2 high findings · 1 stopped or degraded · 1 cost recommendation"
 * A cause with nothing behind it is not named, so the card says "critical" only
 * when there is a Critical finding, and it never says there are no findings beside
 * a count that some other cause explains.
 */
export interface FindingsBySeverity {
  critical: number
  high: number
  medium: number
  low: number
}

export interface AttentionReasons {
  with_finding: number
  with_cost_recommendation: number
  stopped_or_degraded: number
  failed: number
}

export interface AttentionCard {
  label: string
  /** null when there is nothing truthful to add: counts unknown, or a count the reasons do not explain. */
  reasonLine: string | null
  action: string
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function describeAttentionCard(
  needsAttention: number | null | undefined,
  findings: FindingsBySeverity | null | undefined,
  reasons: AttentionReasons | null | undefined
): AttentionCard {
  const label = 'Needs Attention'
  const action = findings && findings.critical > 0 ? 'Resolve now →' : 'Review →'
  // Loading, a failed request, or a backend that does not send the breakdown.
  if (needsAttention == null || !findings || !reasons) return { label, reasonLine: null, action: 'Review →' }
  if (needsAttention === 0) return { label, reasonLine: 'No resources flagged', action: 'Review →' }

  const parts = [
    // Findings are named only when a resource is counted because of one.
    reasons.with_finding > 0 && findings.critical > 0 ? count(findings.critical, 'critical finding', 'critical findings') : null,
    reasons.with_finding > 0 && findings.high > 0 ? count(findings.high, 'high finding', 'high findings') : null,
    reasons.failed > 0 ? `${reasons.failed} failed` : null,
    reasons.stopped_or_degraded > 0 ? `${reasons.stopped_or_degraded} stopped or degraded` : null,
    reasons.with_cost_recommendation > 0 ? count(reasons.with_cost_recommendation, 'cost recommendation', 'cost recommendations') : null,
  ].filter((part): part is string => part !== null)

  // A non-zero count with no cause reported is left unexplained rather than explained wrongly.
  return { label, reasonLine: parts.length > 0 ? parts.join(' · ') : null, action }
}
