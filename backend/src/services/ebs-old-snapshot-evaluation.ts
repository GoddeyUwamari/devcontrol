/**
 * The old EBS snapshot rule (config/ebs-old-snapshot-rule.ts) applied to what
 * was read from AWS. Pure: no AWS calls, no database, no clock (the caller
 * passes `now`).
 */
import type { Snapshot } from '@aws-sdk/client-ec2';
import { EBS_OLD_SNAPSHOT_RULE } from '../config/ebs-old-snapshot-rule';
import { ebsSnapshotStandardPricePerGbMonth } from '../config/aws-pricing';
import type { RecommendationSeverity } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The volume id AWS gives a snapshot that was copied or imported: no source volume is recorded. */
export const UNRECORDED_SOURCE_VOLUME_ID = 'vol-ffffffff';

/** Out of scope from DescribeSnapshots alone: not a candidate at all. */
export type SnapshotNotFlaggedReason = 'not_completed' | 'archive_tier' | 'too_recent';
/** Something manages or protects the snapshot, so deleting it is not the advice. */
export type SnapshotExcludedReason = 'ami' | 'aws_backup' | 'dlm' | 'locked';
export type SnapshotExclusionReason = SnapshotNotFlaggedReason | SnapshotExcludedReason;
/**
 * The exclusion read that could not answer. When more than one fails, the
 * candidates are counted under the first in this order: ami, aws_backup,
 * locks, volumes.
 */
export type SnapshotCouldntCheckReason = 'ami_unreadable' | 'aws_backup_unreadable' | 'locks_unreadable' | 'volumes_unreadable';

/**
 * What one run of the rule decided, by reason (Stage A §6/§7), stored on the
 * run's check as `old_snapshots`. Counts only, never snapshot identifiers.
 * Every listed own snapshot is counted exactly once: evaluated = flagged +
 * not_flagged + couldnt_check + excluded (each summed over its reasons).
 */
export interface OldSnapshotCheckCounts {
  evaluated: number;
  flagged: number;
  not_flagged: Record<SnapshotNotFlaggedReason, number>;
  couldnt_check: Record<SnapshotCouldntCheckReason, number>;
  excluded: Record<SnapshotExcludedReason, number>;
}

export function emptyOldSnapshotCounts(): OldSnapshotCheckCounts {
  return {
    evaluated: 0,
    flagged: 0,
    not_flagged: { not_completed: 0, archive_tier: 0, too_recent: 0 },
    couldnt_check: { ami_unreadable: 0, aws_backup_unreadable: 0, locks_unreadable: 0, volumes_unreadable: 0 },
    excluded: { ami: 0, aws_backup: 0, dlm: 0, locked: 0 },
  };
}

/** Counts one verdict that is not a finding under its reason. */
export function countSnapshotExclusion(counts: OldSnapshotCheckCounts, reason: SnapshotExclusionReason): void {
  if (reason === 'not_completed' || reason === 'archive_tier' || reason === 'too_recent') counts.not_flagged[reason] += 1;
  else counts.excluded[reason] += 1;
}

export type SourceVolumeState = 'deleted' | 'exists' | 'not_recorded';

/** What the exclusion reads found. Each is the complete answer for the home region. */
export interface SnapshotExclusionFacts {
  amiSnapshotIds: ReadonlySet<string>;
  backupSnapshotIds: ReadonlySet<string>;
  /** Own snapshots under a lock that still prevents deletion (any lock state but `expired`). */
  lockedSnapshotIds: ReadonlySet<string>;
  existingVolumeIds: ReadonlySet<string>;
}

export type SnapshotVerdict =
  | { kind: 'excluded'; reason: SnapshotExclusionReason }
  | { kind: 'old'; ageDays: number; sourceVolume: SourceVolumeState };

function isDlmTag(key: string | undefined): boolean {
  if (!key) return false;
  const { tag_keys, tag_key_prefix } = EBS_OLD_SNAPSHOT_RULE.exclusions.dlm;
  return (tag_keys as readonly string[]).includes(key) || key.startsWith(tag_key_prefix);
}

/** Whole days since the snapshot started, or null without a valid start time. */
export function snapshotAgeDays(startTime: Date | undefined, now: Date): number | null {
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) return null;
  return Math.floor((now.getTime() - startTime.getTime()) / DAY_MS);
}

/**
 * The checks that need no other read: state, tier, age and DLM tags. A snapshot
 * that passes is a candidate for the AMI and AWS Backup checks.
 */
export function judgeSnapshotBasics(snapshot: Snapshot, now: Date): { kind: 'excluded'; reason: SnapshotExclusionReason } | { kind: 'candidate'; ageDays: number } {
  if (snapshot.State !== EBS_OLD_SNAPSHOT_RULE.state) return { kind: 'excluded', reason: 'not_completed' };
  if (snapshot.StorageTier && (EBS_OLD_SNAPSHOT_RULE.excluded_storage_tiers as readonly string[]).includes(snapshot.StorageTier)) {
    return { kind: 'excluded', reason: 'archive_tier' };
  }
  const ageDays = snapshotAgeDays(snapshot.StartTime, now);
  // Older than 180 days: more than exactly 180 x 24 hours since it started.
  if (ageDays === null || now.getTime() - (snapshot.StartTime as Date).getTime() <= EBS_OLD_SNAPSHOT_RULE.min_age_days * DAY_MS) {
    return { kind: 'excluded', reason: 'too_recent' };
  }
  if ((snapshot.Tags ?? []).some((tag) => isDlmTag(tag.Key))) return { kind: 'excluded', reason: 'dlm' };
  return { kind: 'candidate', ageDays };
}

/** The full verdict for a snapshot, given complete exclusion reads. */
export function judgeOldSnapshot(snapshot: Snapshot & { SnapshotId: string }, now: Date, facts: SnapshotExclusionFacts): SnapshotVerdict {
  const basics = judgeSnapshotBasics(snapshot, now);
  if (basics.kind === 'excluded') return basics;
  if (facts.amiSnapshotIds.has(snapshot.SnapshotId)) return { kind: 'excluded', reason: 'ami' };
  if (facts.backupSnapshotIds.has(snapshot.SnapshotId)) return { kind: 'excluded', reason: 'aws_backup' };
  if (facts.lockedSnapshotIds.has(snapshot.SnapshotId)) return { kind: 'excluded', reason: 'locked' };
  return { kind: 'old', ageDays: basics.ageDays, sourceVolume: sourceVolumeState(snapshot.VolumeId, facts.existingVolumeIds) };
}

export function sourceVolumeState(volumeId: string | undefined, existingVolumeIds: ReadonlySet<string>): SourceVolumeState {
  if (!volumeId || volumeId === UNRECORDED_SOURCE_VOLUME_ID) return 'not_recorded';
  return existingVolumeIds.has(volumeId) ? 'exists' : 'deleted';
}

/**
 * Whether a DescribeLockedSnapshots entry still prevents deletion. AWS
 * (LockedSnapshotsInfo): compliance, governance and compliance-cooloff
 * snapshots "can't be deleted"; an `expired` lock "is not locked and can be
 * deleted". Any other or missing state is treated as locked, so a state AWS adds
 * later never turns into a deletion recommendation.
 */
export function lockPreventsDeletion(lockState: string | undefined): boolean {
  return !(EBS_OLD_SNAPSHOT_RULE.exclusions.locked.deletable_lock_states as readonly string[]).includes(lockState ?? '');
}

/**
 * The snapshot id of an AWS Backup recovery point, from its ARN, when it is an
 * EBS snapshot (arn:<partition>:ec2:<region>::snapshot/<snapshot-id>, as AWS
 * documents for an EBS recovery point). Anything else: null.
 */
export function snapshotIdFromRecoveryPointArn(arn: string | undefined): string | null {
  if (!arn) return null;
  const match = /^arn:[a-z-]+:ec2:[a-z0-9-]*:[0-9]*:snapshot\/(snap-[0-9a-f]+)$/.exec(arn);
  return match ? match[1] : null;
}

/** The upper bound and its price, or null when the region has no price or the size is unknown. */
export function snapshotUpperBound(volumeSizeGb: number | undefined, region: string): { monthly: number; pricePerGbMonth: number } | null {
  const price = ebsSnapshotStandardPricePerGbMonth(region);
  if (price === null) return null;
  if (typeof volumeSizeGb !== 'number' || !Number.isFinite(volumeSizeGb) || volumeSizeGb <= 0) return null;
  return { monthly: volumeSizeGb * price, pricePerGbMonth: price };
}

/** Severity from the upper bound (as S3's), never above Medium. */
export function snapshotSeverity(upperBound: number | null): RecommendationSeverity {
  if (upperBound === null) return 'LOW';
  if (upperBound >= 50) return 'MEDIUM';
  return 'LOW';
}

export function snapshotDescription(input: { ageDays: number; sizeGb: number | null; sourceVolume: SourceVolumeState }): string {
  const size = input.sizeGb !== null ? `${input.sizeGb} GB ` : '';
  const source =
    input.sourceVolume === 'deleted' ? 'The volume it was taken from no longer exists.'
    : input.sourceVolume === 'exists' ? 'The volume it was taken from still exists; check whether newer snapshots replace this one.'
    : 'It was copied or imported, so AWS records no source volume.';
  return `This ${size}snapshot is ${input.ageDays} days old, and no registered AMI, AWS Backup plan or Data Lifecycle Manager policy uses it. ${source} Check with its owner before deleting it. Snapshots are incremental: deleting one frees only the data no other snapshot shares, so the real saving is usually lower than the upper bound shown.`;
}
