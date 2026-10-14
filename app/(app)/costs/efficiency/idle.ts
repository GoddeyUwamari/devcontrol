import type { InfrastructureResource } from '@/lib/types'

/**
 * Whether a resource is known not to be running. Only an observed 'stopped' or
 * 'pending' state says so. A null status (an S3 bucket, an SNS topic or a VPC has
 * no lifecycle state; another type's may not have been read) says nothing, and is
 * never idle.
 */
export function isNotRunning(r: Pick<InfrastructureResource, 'status'>): boolean {
  return r.status === 'stopped' || r.status === 'pending'
}
