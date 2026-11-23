/**
 * The old EBS snapshot rule (C1): the one place its scope, threshold and
 * exclusions live.
 *
 * A snapshot is an old snapshot only when:
 *   - the account owns it (DescribeSnapshots is always called with
 *     OwnerIds=['self']: public and shared-in snapshots are never listed),
 *   - its state is `completed` and it is in the standard tier (archived
 *     snapshots are a deliberate act with a 90-day minimum and are excluded),
 *   - it was started more than 180 days before the evaluation, and
 *   - none of the following uses it:
 *       an AMI the account owns, including deprecated and disabled AMIs
 *         (DescribeImages Owners=['self'], IncludeDeprecated, IncludeDisabled):
 *         AWS refuses to delete such a snapshot while the AMI is registered;
 *       AWS Backup: its snapshot is a recovery point in one of the region's
 *         backup vaults (ListBackupVaults + ListRecoveryPointsByBackupVault,
 *         ResourceType EBS). AWS documents an EBS recovery point's ARN as
 *         arn:aws:ec2:<region>::snapshot/<snapshot-id> (AWS Backup Developer
 *         Guide, access-control.html) and says such snapshots can't be deleted
 *         through Amazon EC2 (EBS User Guide, ebs-deleting-snapshot.html);
 *       Amazon Data Lifecycle Manager: the snapshot carries one of the system
 *         tags DLM "applies ... to all snapshots and AMIs created by a policy"
 *         (EBS User Guide, dlm-elements.html): aws:dlm:lifecycle-policy-id,
 *         aws:dlm:lifecycle-schedule-name. Any other aws:dlm: key is treated
 *         the same (the aws: prefix is reserved for AWS);
 *       a snapshot lock (version 2): the snapshot is listed by
 *         DescribeLockedSnapshots in any lock state but `expired`. "While a
 *         snapshot is locked, it can't be deleted by any user, regardless of
 *         their IAM permissions" (EBS User Guide, ebs-snapshot-lock.html); the
 *         compliance, governance and compliance-cooloff states "can't be
 *         deleted", an expired lock "is not locked and can be deleted" (EC2 API
 *         Reference, LockedSnapshotsInfo).
 *     A read that could not answer (AMIs, backup vaults, snapshot locks,
 *     volumes) makes every candidate "couldn't check" -- never an old-snapshot
 *     finding.
 *
 * Savings: an upper bound. volume size x the snapshot's region's standard
 * snapshot storage price (config/aws-pricing.ts); snapshots are incremental,
 * so deleting one frees only the blocks no other snapshot uses. A region with
 * no price in the table, or no volume size, gives no dollar figure. Severity
 * follows the upper bound but never goes above Medium.
 *
 * EBS_OLD_SNAPSHOT_RULE is copied verbatim into every finding it produces
 * (metadata.rule). Any change to it must bump `version`: the snapshot test in
 * config/__tests__/c1-rule-identity.test.ts enforces that.
 *
 * Pure data: no AWS calls, no database.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export const EBS_OLD_SNAPSHOT_RULE = deepFreeze({
  id: 'ebs_old_snapshots',
  version: 2,
  owner_ids: ['self'],
  min_age_days: 180,
  state: 'completed',
  excluded_storage_tiers: ['archive'],
  exclusions: {
    ami: { owners: ['self'], include_deprecated: true, include_disabled: true },
    aws_backup: { source: 'recovery_point_in_backup_vault', resource_type: 'EBS' },
    dlm: { tag_keys: ['aws:dlm:lifecycle-policy-id', 'aws:dlm:lifecycle-schedule-name'], tag_key_prefix: 'aws:dlm:' },
    locked: { source: 'describe_locked_snapshots', deletable_lock_states: ['expired'] },
    on_read_failure: 'couldnt_check',
  },
  savings: { basis: 'ceiling', price: 'regional_standard_snapshot_storage', missing_price: 'no_estimate', severity_cap: 'MEDIUM' },
} as const);

export type EbsOldSnapshotRule = typeof EBS_OLD_SNAPSHOT_RULE;

/** cost_recommendations.resource_type of an old-snapshot finding. */
export const EBS_SNAPSHOT_RESOURCE_TYPE = 'EBS Snapshot';
