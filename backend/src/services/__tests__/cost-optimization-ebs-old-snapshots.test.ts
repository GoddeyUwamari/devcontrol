/**
 * C1: the old EBS snapshot detector (config/ebs-old-snapshot-rule.ts,
 * ebs-old-snapshot-evaluation.ts) against fake EC2 and AWS Backup answers. No network.
 *
 * Covers: the 180-day boundary; archive tier; AMI, AWS Backup and DLM exclusions;
 * OwnerIds=['self'] on every DescribeSnapshots call (non-owned snapshots are never
 * listed); deleted / existing / unrecorded source volume evidence; regional pricing,
 * a region with no price and no size (no estimate); the upper-bound calculation and
 * label; the Medium severity cap; rule id/version; failed or incomplete exclusion
 * reads (never a finding); locked snapshots (C1 review S-3); the next-page token on
 * every paged listing; the run's counts by reason (S-1); listing failures.
 */
import costOptimizationService from '../cost-optimization.service';
import { lockPreventsDeletion, snapshotIdFromRecoveryPointArn, snapshotSeverity, sourceVolumeState } from '../ebs-old-snapshot-evaluation';
import { EBS_OLD_SNAPSHOT_RULE } from '../../config/ebs-old-snapshot-rule';
import { ISSUE_EBS_OLD_SNAPSHOT } from '../../config/optimization-rules';
import { classifySavingsBasis, aggregateEstimatedSavings, countSavingsFindings } from '../estimated-savings';
import { fakeClient, accessDenied } from './helpers/low-activity-aws';

const service = costOptimizationService as any;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-23T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

function snap(id: string, overrides: Record<string, unknown> = {}) {
  return {
    SnapshotId: id,
    OwnerId: '111122223333',
    State: 'completed',
    StorageTier: 'standard',
    StartTime: daysAgo(400),
    VolumeId: 'vol-0deleted000000001',
    VolumeSize: 100,
    Encrypted: true,
    Tags: [] as Array<{ Key: string; Value: string }>,
    ...overrides,
  };
}

interface World {
  snapshots?: unknown[] | Error;
  images?: unknown[] | Error;
  vaults?: string[] | Error;
  recoveryPoints?: Record<string, string[]> | Error;
  volumes?: string[] | Error;
  locks?: Array<{ SnapshotId: string; LockState: string }> | Error;
}

function fakes(world: World) {
  const ec2 = fakeClient((command: any) => {
    const name = command.constructor.name;
    if (name === 'DescribeSnapshotsCommand') {
      if (world.snapshots instanceof Error) throw world.snapshots;
      return { Snapshots: world.snapshots ?? [] };
    }
    if (name === 'DescribeImagesCommand') {
      if (world.images instanceof Error) throw world.images;
      return { Images: world.images ?? [] };
    }
    if (name === 'DescribeVolumesCommand') {
      if (world.volumes instanceof Error) throw world.volumes;
      return { Volumes: (world.volumes ?? []).map((VolumeId) => ({ VolumeId })) };
    }
    if (name === 'DescribeLockedSnapshotsCommand') {
      if (world.locks instanceof Error) throw world.locks;
      return { Snapshots: (world.locks ?? []).map((lock) => ({ OwnerId: '111122223333', ...lock })) };
    }
    throw new Error(`unexpected ${name}`);
  });
  const backup = fakeClient((command: any) => {
    const name = command.constructor.name;
    if (name === 'ListBackupVaultsCommand') {
      if (world.vaults instanceof Error) throw world.vaults;
      return { BackupVaultList: (world.vaults ?? ['Default']).map((BackupVaultName) => ({ BackupVaultName })) };
    }
    if (name === 'ListRecoveryPointsByBackupVaultCommand') {
      if (world.recoveryPoints instanceof Error) throw world.recoveryPoints;
      const arns = (world.recoveryPoints ?? {})[command.input.BackupVaultName] ?? [];
      return { RecoveryPoints: arns.map((RecoveryPointArn) => ({ RecoveryPointArn, ResourceType: 'EBS' })) };
    }
    throw new Error(`unexpected ${name}`);
  });
  return { ec2, backup };
}

async function detect(world: World, region = 'us-east-1') {
  const clients = fakes(world);
  const result = await service.detectOldEBSSnapshots(clients, region, NOW);
  return { result, ...clients };
}

const ids = (result: any) => result.issues.map((i: any) => i.resourceId);

describe('old EBS snapshots: what is listed', () => {
  it('asks for the account\'s own snapshots only, on every page', async () => {
    let page = 0;
    const ec2 = fakeClient((command: any) => {
      if (command.constructor.name === 'DescribeSnapshotsCommand') {
        page += 1;
        return page === 1 ? { Snapshots: [snap('snap-0000000000000001')], NextToken: 'next' } : { Snapshots: [snap('snap-0000000000000002')] };
      }
      if (command.constructor.name === 'DescribeImagesCommand') return { Images: [] };
      if (command.constructor.name === 'DescribeLockedSnapshotsCommand') return { Snapshots: [] };
      return { Volumes: [] };
    });
    const { backup } = fakes({});
    const result = await service.detectOldEBSSnapshots({ ec2, backup }, 'us-east-1', NOW);
    const listings = ec2.send.mock.calls.map(([c]: any[]) => c).filter((c: any) => c.constructor.name === 'DescribeSnapshotsCommand');
    expect(listings).toHaveLength(2);
    for (const c of listings) {
      expect(c.input.OwnerIds).toEqual(['self']);
      expect(c.input.RestorableByUserIds).toBeUndefined();
    }
    expect(ids(result)).toEqual(['snap-0000000000000001', 'snap-0000000000000002']);
  });

  it('a snapshot another account owns is never listed, so never found (OwnerIds=[\'self\'] is AWS\'s filter)', async () => {
    // AWS answers OwnerIds=['self'] with the caller's snapshots only; the fake honours the same filter.
    const ec2 = fakeClient((command: any) => {
      if (command.constructor.name === 'DescribeSnapshotsCommand') {
        const all = [snap('snap-0000000000000001'), snap('snap-00000000000000ff', { OwnerId: '444455556666' })];
        return { Snapshots: command.input.OwnerIds?.includes('self') ? all.filter((s) => s.OwnerId === '111122223333') : all };
      }
      if (command.constructor.name === 'DescribeLockedSnapshotsCommand') return { Snapshots: [] };
      return command.constructor.name === 'DescribeImagesCommand' ? { Images: [] } : { Volumes: [] };
    });
    const result = await service.detectOldEBSSnapshots({ ec2, backup: fakes({}).backup }, 'us-east-1', NOW);
    expect(ids(result)).toEqual(['snap-0000000000000001']);
  });

  it('asks for the account\'s own AMIs, deprecated and disabled ones included', async () => {
    const { ec2 } = await detect({ snapshots: [snap('snap-0000000000000001')] });
    const images = ec2.send.mock.calls.map(([c]: any[]) => c).find((c: any) => c.constructor.name === 'DescribeImagesCommand');
    expect(images.input).toMatchObject({ Owners: ['self'], IncludeDeprecated: true, IncludeDisabled: true });
  });

  it('asks for every snapshot lock in the region, unfiltered', async () => {
    const { ec2 } = await detect({ snapshots: [snap('snap-0000000000000001')] });
    const locks = ec2.send.mock.calls.map(([c]: any[]) => c).filter((c: any) => c.constructor.name === 'DescribeLockedSnapshotsCommand');
    expect(locks).toHaveLength(1);
    expect(locks[0].input).toEqual({ MaxResults: 1000, NextToken: undefined });
  });

  it('asks AWS Backup for EBS recovery points in every vault', async () => {
    const { backup } = await detect({ snapshots: [snap('snap-0000000000000001')], vaults: ['Default', 'placeholder-vault'] });
    const points = backup.send.mock.calls.map(([c]: any[]) => c).filter((c: any) => c.constructor.name === 'ListRecoveryPointsByBackupVaultCommand');
    expect(points.map((c: any) => [c.input.BackupVaultName, c.input.ByResourceType])).toEqual([['Default', 'EBS'], ['placeholder-vault', 'EBS']]);
  });
});

describe('old EBS snapshots: the 180-day boundary', () => {
  it.each([
    ['exactly 180 days old', 180, false],
    ['180 days and one minute old', 180 + 1 / (24 * 60), true],
    ['179 days old', 179, false],
    ['181 days old', 181, true],
  ])('%s', async (_label, age, found) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { StartTime: daysAgo(age as number) })] });
    expect(ids(result)).toEqual(found ? ['snap-0000000000000001'] : []);
  });

  it('no start time: not a finding', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { StartTime: undefined })] });
    expect(result.issues).toEqual([]);
  });

  it('recent snapshots need no exclusion reads at all', async () => {
    const { result, ec2, backup } = await detect({ snapshots: [snap('snap-0000000000000001', { StartTime: daysAgo(10) })] });
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [] });
    expect(ec2.count('DescribeImagesCommand')).toBe(0);
    expect(backup.send).not.toHaveBeenCalled();
  });
});

describe('old EBS snapshots: exclusions', () => {
  it('archive tier: excluded', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { StorageTier: 'archive' })] });
    expect(result.issues).toEqual([]);
  });

  it.each(['pending', 'error', 'recoverable', 'recovering'])('state %s: excluded', async (State) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { State })] });
    expect(result.issues).toEqual([]);
  });

  it('used by an AMI the account owns: excluded', async () => {
    const { result } = await detect({
      snapshots: [snap('snap-0000000000000001'), snap('snap-0000000000000002')],
      images: [{ ImageId: 'ami-0placeholder', BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { SnapshotId: 'snap-0000000000000001' } }, { DeviceName: '/dev/sdb' }] }],
    });
    expect(ids(result)).toEqual(['snap-0000000000000002']);
  });

  it('an AWS Backup recovery point: excluded', async () => {
    const { result } = await detect({
      snapshots: [snap('snap-0000000000000001'), snap('snap-0000000000000002')],
      vaults: ['Default', 'placeholder-vault'],
      recoveryPoints: { 'placeholder-vault': ['arn:aws:ec2:us-east-1::snapshot/snap-0000000000000002'] },
    });
    expect(ids(result)).toEqual(['snap-0000000000000001']);
  });

  it.each([
    ['aws:dlm:lifecycle-policy-id', 'policy-0placeholder'],
    ['aws:dlm:lifecycle-schedule-name', 'Default Schedule'],
    ['aws:dlm:expirationTime', '2026-12-01T00:00:00.000Z'],
  ])('DLM system tag %s: excluded', async (Key, Value) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { Tags: [{ Key, Value }] })] });
    expect(result.issues).toEqual([]);
  });

  it('a user tag that only looks like DLM\'s is not an exclusion', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { Tags: [{ Key: 'createdby', Value: 'dlm' }, { Key: 'dlm:lifecycle-policy-id', Value: 'x' }] })] });
    expect(ids(result)).toEqual(['snap-0000000000000001']);
  });

  it.each(['compliance', 'governance', 'compliance-cooloff'])('locked (%s): excluded', async (LockState) => {
    const { result } = await detect({
      snapshots: [snap('snap-0000000000000001'), snap('snap-0000000000000002')],
      locks: [{ SnapshotId: 'snap-0000000000000001', LockState }],
    });
    expect(ids(result)).toEqual(['snap-0000000000000002']);
    expect(result.unknownResourceIds).toEqual([]);
  });

  it('a lock in a state AWS has not documented yet: excluded (fails safe)', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001')], locks: [{ SnapshotId: 'snap-0000000000000001', LockState: 'some-future-state' }] });
    expect(result.issues).toEqual([]);
    expect(lockPreventsDeletion(undefined)).toBe(true);
  });

  it('an expired lock no longer prevents deletion: still a finding', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001')], locks: [{ SnapshotId: 'snap-0000000000000001', LockState: 'expired' }] });
    expect(ids(result)).toEqual(['snap-0000000000000001']);
    expect(lockPreventsDeletion('expired')).toBe(false);
  });

  it('reads the snapshot id from an EBS recovery point ARN only', () => {
    expect(snapshotIdFromRecoveryPointArn('arn:aws:ec2:us-east-1::snapshot/snap-05f426fd8a1b4224')).toBe('snap-05f426fd8a1b4224');
    expect(snapshotIdFromRecoveryPointArn('arn:aws:backup:us-east-1:111122223333:recovery-point:00000000-0000-4000-8000-00000000000a')).toBeNull();
    expect(snapshotIdFromRecoveryPointArn('arn:aws:ec2:us-east-1::image/ami-1a2b3e4f5e6f7a890')).toBeNull();
    expect(snapshotIdFromRecoveryPointArn(undefined)).toBeNull();
  });
});

describe('old EBS snapshots: a failed exclusion read never produces a finding', () => {
  const old = [snap('snap-0000000000000001'), snap('snap-0000000000000002')];
  it.each([
    ['DescribeImages fails', { images: accessDenied() }],
    ['ListBackupVaults fails', { vaults: accessDenied() }],
    ['ListRecoveryPointsByBackupVault fails', { recoveryPoints: accessDenied() }],
    ['DescribeLockedSnapshots fails', { locks: accessDenied() }],
    ['DescribeVolumes fails', { volumes: accessDenied() }],
  ])('%s: every candidate couldn\'t check', async (_label, world) => {
    const { result } = await detect({ snapshots: old, ...(world as World) });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['snap-0000000000000001', 'snap-0000000000000002']);
    expect(result.endActiveForUnknown).toBeUndefined();
  });

  it('no AWS Backup client: couldn\'t check', async () => {
    const { ec2 } = fakes({ snapshots: old });
    const result = await service.detectOldEBSSnapshots({ ec2, backup: undefined }, 'us-east-1', NOW);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toHaveLength(2);
  });

  it('an incomplete recovery-point listing (page limit reached): couldn\'t check', async () => {
    const { ec2 } = fakes({ snapshots: old });
    const backup = fakeClient((command: any) =>
      command.constructor.name === 'ListBackupVaultsCommand' ? { BackupVaultList: [{ BackupVaultName: 'Default' }] } : { RecoveryPoints: [], NextToken: 'more' });
    const result = await service.detectOldEBSSnapshots({ ec2, backup }, 'us-east-1', NOW);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toHaveLength(2);
  });

  // C1 review S-2: a listing cut off at the page limit is not the complete set. Each fake
  // answers every page with a next-page token, so listAllPages stops at its limit.
  const endless = (answer: Record<string, unknown>) => ({ ...answer, NextToken: 'more' });

  it('an incomplete AMI listing (page limit reached): couldn\'t check, never a finding', async () => {
    // Page 1 holds an AMI using snap-…01; the AMI that uses snap-…02 would be on a page never read.
    const ec2 = fakeClient((command: any) => {
      const name = command.constructor.name;
      if (name === 'DescribeSnapshotsCommand') return { Snapshots: old };
      if (name === 'DescribeImagesCommand') return endless({ Images: [{ ImageId: 'ami-0placeholder', BlockDeviceMappings: [{ Ebs: { SnapshotId: 'snap-0000000000000001' } }] }] });
      if (name === 'DescribeLockedSnapshotsCommand') return { Snapshots: [] };
      return { Volumes: [] };
    });
    const result = await service.detectOldEBSSnapshots({ ec2, backup: fakes({}).backup }, 'us-east-1', NOW);
    expect(ec2.count('DescribeImagesCommand')).toBeGreaterThan(1);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['snap-0000000000000001', 'snap-0000000000000002']);
    expect(result.oldSnapshots.couldnt_check.ami_unreadable).toBe(2);
  });

  it('an incomplete volume listing (page limit reached): couldn\'t check, never a finding', async () => {
    const ec2 = fakeClient((command: any) => {
      const name = command.constructor.name;
      if (name === 'DescribeSnapshotsCommand') return { Snapshots: old };
      if (name === 'DescribeImagesCommand') return { Images: [] };
      if (name === 'DescribeLockedSnapshotsCommand') return { Snapshots: [] };
      return endless({ Volumes: [{ VolumeId: 'vol-0exists0000000001' }] });
    });
    const result = await service.detectOldEBSSnapshots({ ec2, backup: fakes({}).backup }, 'us-east-1', NOW);
    expect(ec2.count('DescribeVolumesCommand')).toBeGreaterThan(1);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['snap-0000000000000001', 'snap-0000000000000002']);
    expect(result.oldSnapshots.couldnt_check.volumes_unreadable).toBe(2);
  });

  it('an incomplete lock listing (page limit reached): couldn\'t check, never a finding', async () => {
    const ec2 = fakeClient((command: any) => {
      const name = command.constructor.name;
      if (name === 'DescribeSnapshotsCommand') return { Snapshots: old };
      if (name === 'DescribeImagesCommand') return { Images: [] };
      if (name === 'DescribeLockedSnapshotsCommand') return endless({ Snapshots: [] });
      return { Volumes: [] };
    });
    const result = await service.detectOldEBSSnapshots({ ec2, backup: fakes({}).backup }, 'us-east-1', NOW);
    expect(ec2.count('DescribeLockedSnapshotsCommand')).toBeGreaterThan(1);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['snap-0000000000000001', 'snap-0000000000000002']);
    expect(result.oldSnapshots.couldnt_check.locks_unreadable).toBe(2);
  });

  it('a failed DescribeSnapshots fails the category', async () => {
    const { result } = await detect({ snapshots: accessDenied() });
    expect(result).toEqual({ success: false, issues: [] });
  });
});

describe('old EBS snapshots: source volume evidence', () => {
  it.each([
    ['deleted', 'vol-0deleted000000001', [], 'The volume it was taken from no longer exists.'],
    ['exists', 'vol-0exists0000000001', ['vol-0exists0000000001'], 'The volume it was taken from still exists'],
    ['not_recorded', 'vol-ffffffff', [], 'It was copied or imported, so AWS records no source volume.'],
  ])('%s', async (state, VolumeId, volumes, sentence) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeId })], volumes: volumes as string[] });
    const [finding] = result.issues;
    expect(finding.metadata.ebs_old_snapshot.source_volume).toBe(state);
    expect(finding.metadata.ebs_old_snapshot.volume_id).toBe(VolumeId);
    expect(finding.description).toContain(sentence);
  });

  it('no volume id at all reads as not recorded', () => {
    expect(sourceVolumeState(undefined, new Set())).toBe('not_recorded');
  });
});

describe('old EBS snapshots: savings, severity and identity', () => {
  it('stores the rule identity, the evidence and an upper bound at the region\'s own price', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeSize: 500, Tags: [{ Key: 'Name', Value: 'Placeholder backup' }] })] }, 'eu-central-1');
    const [finding] = result.issues;
    expect(finding).toMatchObject({
      resourceId: 'snap-0000000000000001',
      resourceName: 'Placeholder backup',
      resourceType: 'EBS Snapshot',
      issue: ISSUE_EBS_OLD_SNAPSHOT,
      awsRegion: 'eu-central-1',
      severity: 'LOW',
    });
    expect(finding.potentialSavings).toBeCloseTo(27, 10); // 500 GB x $0.054
    const m = finding.metadata;
    expect(m.rule_version).toBe(2);
    expect(m.rule).toEqual(JSON.parse(JSON.stringify(EBS_OLD_SNAPSHOT_RULE)));
    expect(m.price_per_gb_month).toBe(0.054);
    expect(m.price_region).toBe('eu-central-1');
    expect(classifySavingsBasis(m.savings_basis)).toBe('ceiling');
    expect(m.savings_basis).toContain('eu-central-1');
    expect(m.savings_basis).toContain('incremental');
    expect(m.ebs_old_snapshot).toEqual({
      evaluated_at: NOW.toISOString(),
      start_time: daysAgo(400).toISOString(),
      age_days: 400,
      threshold_days: 180,
      volume_id: 'vol-0deleted000000001',
      volume_size_gb: 500,
      source_volume: 'deleted',
      storage_tier: 'standard',
      encrypted: true,
      exclusion_checks: { ami: 'checked', aws_backup: 'checked', dlm_tags: 'checked', locks: 'checked' },
    });
    // C1 review: an AMI in the Recycle Bin is not listed, so the copy claims registered AMIs only.
    expect(finding.description).toContain('no registered AMI, AWS Backup plan or Data Lifecycle Manager policy uses it.');
    expect(finding.description).not.toMatch(/\bno AMI\b/);
  });

  it('the upper bound goes into the upper-bound total, never the firm total', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeSize: 200 })] });
    const recs = result.issues.map((i: any) => ({ resource_type: i.resourceType, potential_savings: i.potentialSavings, metadata: i.metadata }));
    expect(aggregateEstimatedSavings(recs)).toEqual({ total: 0, byResourceType: {}, ceilingTotal: 10, ceilingByResourceType: { 'EBS Snapshot': 10 } });
    expect(countSavingsFindings(recs)).toEqual({ estimatedFindings: 0, ceilingFindings: 1, unestimatedFindings: 0 });
  });

  it('a region with no price in the table: no dollar figure, never us-east-1\'s', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeSize: 500 })] }, 'us-gov-west-1');
    const [finding] = result.issues;
    expect(finding.potentialSavings).toBe(0);
    expect(finding.severity).toBe('LOW');
    expect(finding.metadata.savings_basis).toBeUndefined();
    expect(finding.metadata.savings_note).toBe('no_price_for_region');
    expect(finding.metadata.price_per_gb_month).toBeUndefined();
  });

  it('no volume size: no dollar figure', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeSize: undefined })] });
    const [finding] = result.issues;
    expect(finding.potentialSavings).toBe(0);
    expect(finding.metadata.savings_basis).toBeUndefined();
    expect(finding.metadata.savings_note).toBe('no_volume_size');
  });

  it.each([
    [999, 'LOW'], // $49.95
    [1000, 'MEDIUM'], // $50
    [2000, 'MEDIUM'], // $100: would be High, capped at Medium
    [16384, 'MEDIUM'], // $819.20
  ])('%i GB at $0.05: %s', async (VolumeSize, severity) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { VolumeSize })] });
    expect(result.issues[0].severity).toBe(severity);
  });

  it('never returns High', () => {
    expect(snapshotSeverity(10_000)).toBe('MEDIUM');
    expect(snapshotSeverity(null)).toBe('LOW');
  });
});

describe('old EBS snapshots: every paged listing passes the next-page token on (C1 review N-1)', () => {
  it('DescribeSnapshots, DescribeImages, DescribeLockedSnapshots, DescribeVolumes, ListBackupVaults and ListRecoveryPointsByBackupVault', async () => {
    // Each fake answers page 2 only when asked with page 1's token; without it, page 1
    // repeats until the page limit and the listing is incomplete.
    const paged = (token: string | undefined, key: string, first: unknown[], second: unknown[]) =>
      token === undefined ? { [key]: first, NextToken: `tok-${key}` } : token === `tok-${key}` ? { [key]: second } : { [key]: [], NextToken: 'wrong-token' };
    const ec2 = fakeClient((command: any) => {
      const t = command.input.NextToken;
      switch (command.constructor.name) {
        case 'DescribeSnapshotsCommand':
          return paged(t, 'Snapshots', [snap('snap-0000000000000001'), snap('snap-0000000000000002')], [snap('snap-0000000000000003'), snap('snap-0000000000000004'), snap('snap-0000000000000005', { VolumeId: 'vol-0exists0000000001' })]);
        case 'DescribeImagesCommand':
          return paged(t, 'Images', [], [{ ImageId: 'ami-0placeholder', BlockDeviceMappings: [{ Ebs: { SnapshotId: 'snap-0000000000000002' } }] }]);
        case 'DescribeLockedSnapshotsCommand':
          return paged(t, 'Snapshots', [], [{ SnapshotId: 'snap-0000000000000003', LockState: 'governance' }]);
        case 'DescribeVolumesCommand':
          return paged(t, 'Volumes', [], [{ VolumeId: 'vol-0exists0000000001' }]);
        default:
          throw new Error('unexpected');
      }
    });
    const backup = fakeClient((command: any) => {
      const t = command.input.NextToken;
      if (command.constructor.name === 'ListBackupVaultsCommand') return paged(t, 'BackupVaultList', [{ BackupVaultName: 'Default' }], [{ BackupVaultName: 'placeholder-vault' }]);
      if (command.input.BackupVaultName !== 'placeholder-vault') return { RecoveryPoints: [] };
      return paged(t, 'RecoveryPoints', [], [{ RecoveryPointArn: 'arn:aws:ec2:us-east-1::snapshot/snap-0000000000000004', ResourceType: 'EBS' }]);
    });

    const result = await service.detectOldEBSSnapshots({ ec2, backup }, 'us-east-1', NOW);

    const tokens = (client: any, name: string) =>
      client.send.mock.calls.map(([c]: any[]) => c).filter((c: any) => c.constructor.name === name).map((c: any) => c.input.NextToken);
    expect(tokens(ec2, 'DescribeSnapshotsCommand')).toEqual([undefined, 'tok-Snapshots']);
    expect(tokens(ec2, 'DescribeImagesCommand')).toEqual([undefined, 'tok-Images']);
    expect(tokens(ec2, 'DescribeLockedSnapshotsCommand')).toEqual([undefined, 'tok-Snapshots']);
    expect(tokens(ec2, 'DescribeVolumesCommand')).toEqual([undefined, 'tok-Volumes']);
    expect(tokens(backup, 'ListBackupVaultsCommand')).toEqual([undefined, 'tok-BackupVaultList']);
    expect(tokens(backup, 'ListRecoveryPointsByBackupVaultCommand')).toEqual([undefined, undefined, 'tok-RecoveryPoints']);
    // What only page 2 held took effect: snap-…02 AMI, snap-…03 locked, snap-…04 AWS Backup, vol-…01 exists.
    expect(ids(result)).toEqual(['snap-0000000000000001', 'snap-0000000000000005']);
    expect(result.issues[1].metadata.ebs_old_snapshot.source_volume).toBe('exists');
    expect(result.unknownResourceIds).toEqual([]);
  });
});

describe('old EBS snapshots: the run\'s counts by reason (C1 review S-1)', () => {
  const total = (counts: any) =>
    counts.flagged + [counts.not_flagged, counts.couldnt_check, counts.excluded].reduce((sum, group) => sum + Object.values(group as Record<string, number>).reduce((a, b) => a + b, 0), 0);

  it('counts every listed snapshot once: flagged, not flagged, excluded by reason', async () => {
    const { result } = await detect({
      snapshots: [
        snap('snap-0000000000000001'), // flagged
        snap('snap-0000000000000002'), // flagged
        snap('snap-0000000000000003', { State: 'pending' }),
        snap('snap-0000000000000004', { StorageTier: 'archive' }),
        snap('snap-0000000000000005', { StartTime: daysAgo(30) }),
        snap('snap-0000000000000006', { StartTime: daysAgo(31) }),
        snap('snap-0000000000000007', { Tags: [{ Key: 'aws:dlm:lifecycle-policy-id', Value: 'policy-0placeholder' }] }),
        snap('snap-0000000000000008'), // AMI
        snap('snap-0000000000000009'), // AWS Backup
        snap('snap-000000000000000a'), // locked
        { ...snap('x'), SnapshotId: undefined }, // no id: not counted
      ],
      images: [{ ImageId: 'ami-0placeholder', BlockDeviceMappings: [{ Ebs: { SnapshotId: 'snap-0000000000000008' } }] }],
      recoveryPoints: { Default: ['arn:aws:ec2:us-east-1::snapshot/snap-0000000000000009'] },
      locks: [{ SnapshotId: 'snap-000000000000000a', LockState: 'compliance' }],
    });
    expect(result.oldSnapshots).toEqual({
      evaluated: 10,
      flagged: 2,
      not_flagged: { not_completed: 1, archive_tier: 1, too_recent: 2 },
      couldnt_check: { ami_unreadable: 0, aws_backup_unreadable: 0, locks_unreadable: 0, volumes_unreadable: 0 },
      excluded: { ami: 1, aws_backup: 1, dlm: 1, locked: 1 },
    });
    expect(total(result.oldSnapshots)).toBe(result.oldSnapshots.evaluated);
    expect(result.oldSnapshots.flagged).toBe(result.issues.length);
  });

  it.each([
    ['DescribeImages', { images: accessDenied() }, 'ami_unreadable'],
    ['AWS Backup', { vaults: accessDenied() }, 'aws_backup_unreadable'],
    ['DescribeLockedSnapshots', { locks: accessDenied() }, 'locks_unreadable'],
    ['DescribeVolumes', { volumes: accessDenied() }, 'volumes_unreadable'],
  ])('a failed %s read: every candidate couldn\'t check under its reason', async (_label, world, reason) => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001'), snap('snap-0000000000000002'), snap('snap-0000000000000003', { StartTime: daysAgo(5) })], ...(world as World) });
    expect(result.oldSnapshots.couldnt_check[reason as string]).toBe(2);
    expect(result.oldSnapshots.not_flagged.too_recent).toBe(1);
    expect(result.oldSnapshots.flagged).toBe(0);
    expect(total(result.oldSnapshots)).toBe(3);
    expect(Object.values(result.oldSnapshots.couldnt_check).reduce((a: number, b) => a + (b as number), 0)).toBe(result.unknownResourceIds.length);
  });

  it('two failed reads: counted once, under the first in the documented order', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001')], locks: accessDenied(), volumes: accessDenied() });
    expect(result.oldSnapshots.couldnt_check).toEqual({ ami_unreadable: 0, aws_backup_unreadable: 0, locks_unreadable: 1, volumes_unreadable: 0 });
  });

  it('no candidates: counts without any exclusion read', async () => {
    const { result } = await detect({ snapshots: [snap('snap-0000000000000001', { StartTime: daysAgo(1) })] });
    expect(result.oldSnapshots).toMatchObject({ evaluated: 1, flagged: 0, not_flagged: { too_recent: 1 } });
  });

  it('a failed DescribeSnapshots records no counts (the category failed)', async () => {
    const { result } = await detect({ snapshots: accessDenied() });
    expect(result.oldSnapshots).toBeUndefined();
  });
});
