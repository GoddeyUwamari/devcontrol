/**
 * The wording of Infrastructure's red card.
 *
 * The card's number is the count of resources that need attention (stopped, failed,
 * or carrying a High or Critical finding). It used to be titled "Critical Issues",
 * which the number never was: it could read 4 with no Critical finding anywhere.
 * The title now says what is counted, and the line under it gives the real number
 * of findings at each of the two severities that put a resource there. A severity
 * with no findings is not named, so the card says "critical" only when there is a
 * Critical finding.
 */
export interface FindingsBySeverity {
  critical: number
  high: number
  medium: number
  low: number
}

export interface AttentionCard {
  label: string
  /** null while the counts are unknown (loading, failed, or an older backend). */
  severityLine: string | null
  action: string
}

const plural = (n: number, word: string) => `${n} ${word}`

export function describeAttentionCard(findings: FindingsBySeverity | null | undefined): AttentionCard {
  const label = 'Needs Attention'
  if (!findings) return { label, severityLine: null, action: 'Review →' }

  const parts = [
    findings.critical > 0 ? plural(findings.critical, 'critical') : null,
    findings.high > 0 ? plural(findings.high, 'high') : null,
  ].filter((part): part is string => part !== null)

  if (parts.length === 0) return { label, severityLine: 'No high-severity findings', action: 'Review →' }

  const total = findings.critical + findings.high
  return {
    label,
    severityLine: `${parts.join(' · ')} finding${total === 1 ? '' : 's'}`,
    action: findings.critical > 0 ? 'Resolve now →' : 'Review →',
  }
}
