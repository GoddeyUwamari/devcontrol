/** Whether a service's own status is a reason for attention: a known warning or critical one, never 'unknown'. */
export function statusNeedsAttention(s: { status?: string | null }): boolean {
  return s.status === 'warning' || s.status === 'critical'
}
