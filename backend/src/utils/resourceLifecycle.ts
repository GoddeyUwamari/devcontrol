/**
 * Which resource types have a lifecycle status at all.
 *
 * An S3 bucket, an SNS topic and a VPC are not started, stopped or running: once
 * they exist they are simply there. Discovery used to store 'active' or 'available'
 * for them and the pages showed "running". They are stored with
 * NOT_APPLICABLE_STATUS instead, and every reader reports no lifecycle state for
 * them -- by type, so a row an earlier release wrote reads the same way before
 * discovery has rewritten it.
 *
 * NOT_APPLICABLE_STATUS is a stored value, not NULL: the inventory queries filter
 * `status != 'terminated'`, which a NULL status does not satisfy.
 */
export const NO_LIFECYCLE_RESOURCE_TYPES: readonly string[] = ['s3', 'sns', 'vpc'];

/** aws_resources.status for a resource type that has no lifecycle status. */
export const NOT_APPLICABLE_STATUS = 'not_applicable';

/** The stored status that means "this type has one, and it was not read". */
export const UNKNOWN_STATUS = 'unknown';

export function hasLifecycleStatus(resourceType: string): boolean {
  return !NO_LIFECYCLE_RESOURCE_TYPES.includes(resourceType);
}

/** What discovery stores as a resource's status: the AWS state, or NOT_APPLICABLE_STATUS for a type without one. */
export function storedStatusFor<T extends string>(resourceType: string, awsState: T): T | typeof NOT_APPLICABLE_STATUS {
  return hasLifecycleStatus(resourceType) ? awsState : NOT_APPLICABLE_STATUS;
}

/**
 * The lifecycle state to report for a stored row: null when the type has none,
 * and null when it has one that was not read. Never a default.
 */
export function lifecycleStateFor(resourceType: string, storedStatus: string | null | undefined): string | null {
  if (!hasLifecycleStatus(resourceType)) return null;
  if (!storedStatus || storedStatus === NOT_APPLICABLE_STATUS || storedStatus.toLowerCase() === UNKNOWN_STATUS) return null;
  return storedStatus;
}
