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
  if (resourceType?.toLowerCase() === 'ebs' && status === 'available') return 'available (unattached)'
  return status
}
