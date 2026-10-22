/**
 * The lifecycle state a resource row shows, as discovered: running / stopped /
 * pending, or an EBS volume's own state. "—" when there is none to show (an S3
 * bucket, an SNS topic, a VPC, or a state that was not read) -- never "running".
 *
 * An EBS volume's 'available' is AWS's word for "not attached to any instance",
 * which reads like "fine" on its own, so it is shown with that meaning beside it.
 * Only for EBS: an 'available' of any other type is not a volume state.
 */
export function lifecycleStateLabel(resourceType: string | null | undefined, status: string | null | undefined): string {
  if (!status) return '—'
  if (isEbs(resourceType) && status === 'available') return 'available (unattached)'
  return status
}

/** An EBS volume's two normal states: attached ('in-use') and unattached ('available'). */
const EBS_NORMAL_STATES: readonly string[] = ['in-use', 'available']

function isEbs(resourceType: string | null | undefined): boolean {
  return resourceType?.toLowerCase() === 'ebs'
}

/**
 * Whether a row belongs under the Needs Attention card's click filter, the
 * "Stopped or pending" filter, and the top of Sort: Impact.
 *
 * Stopped or pending, as before -- and an EBS volume in any state but its two
 * normal ones (error, creating, deleting...). That is the card's own rule for a
 * volume (backend services.routes.ts mapStatus: in-use / available healthy,
 * error critical, anything else warning), so the card's count and the rows its
 * filter shows agree. An attached or unattached volume is never stopped.
 */
export function isStoppedOrPendingState(resourceType: string | null | undefined, status: string | null | undefined): boolean {
  if (!status) return false
  if (isEbs(resourceType)) return !EBS_NORMAL_STATES.includes(status)
  return status === 'stopped' || status === 'pending'
}

/**
 * Whether a row belongs under the No Flagged Issues card's click filter by its
 * state: running -- or an EBS volume in one of its two normal states, which the
 * card counts as healthy.
 */
export function isRunningOrNormalState(resourceType: string | null | undefined, status: string | null | undefined): boolean {
  if (!status) return false
  if (isEbs(resourceType)) return EBS_NORMAL_STATES.includes(status)
  return status === 'running'
}
