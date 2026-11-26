/**
 * C1: the idle RDS and old EBS snapshot rules' identities are pinned, like the
 * low-activity EC2 rule's (low-activity-rule.test.ts). Every finding stores the
 * rule verbatim with rule_version, so changing a threshold, the window, the
 * scope or an exclusion without bumping `version` would make old and new
 * findings claim the same rule. Add a pinned entry (never edit one) when a rule
 * changes. Also pins the regional snapshot price table and its lookup.
 */
import { RDS_IDLE_RULE } from '../rds-idle-rule';
import { EBS_OLD_SNAPSHOT_RULE, EBS_SNAPSHOT_RESOURCE_TYPE } from '../ebs-old-snapshot-rule';
import {
  EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION,
  EBS_SNAPSHOT_STANDARD_PRICE_SOURCE,
  ebsSnapshotStandardPricePerGbMonth,
} from '../aws-pricing';
import { REGION_NAME_PATTERN } from '../../services/region-list';

const PINNED_RDS: Record<number, unknown> = {
  1: {
    id: 'rds_idle',
    version: 1,
    window: { days: 30, basis: 'complete_utc_days', settle_lag_hours: 2 },
    metrics: { namespace: 'AWS/RDS', dimension: 'DBInstanceIdentifier', stat: 'Maximum', period_seconds: 3600 },
    connections: { metric: 'DatabaseConnections', hourly_max_equals: 0 },
    cpu: { metric: 'CPUUtilization', daily_peak_below_percent: 10 },
    read_iops: { metric: 'ReadIOPS', daily_peak_below_per_second: 20 },
    write_iops: { metric: 'WriteIOPS', daily_peak_below_per_second: 20 },
    completeness: {
      hours_per_day_required: 24,
      metrics_required: ['DatabaseConnections', 'CPUUtilization', 'ReadIOPS', 'WriteIOPS'],
      created_before_window: true,
    },
    activity_wins: true,
    scope: {
      evaluated_status: 'available',
      excluded: ['aurora', 'db_cluster_member', 'read_replica', 'read_replica_source', 'rds_custom', 'stopped'],
    },
    savings: { estimate: 'none', reason: 'no_price_source', severity: 'LOW' },
  },
  // C1b: detection unchanged; savings = the exact regional on-demand instance-hour price x 730.
  2: {
    id: 'rds_idle',
    version: 2,
    window: { days: 30, basis: 'complete_utc_days', settle_lag_hours: 2 },
    metrics: { namespace: 'AWS/RDS', dimension: 'DBInstanceIdentifier', stat: 'Maximum', period_seconds: 3600 },
    connections: { metric: 'DatabaseConnections', hourly_max_equals: 0 },
    cpu: { metric: 'CPUUtilization', daily_peak_below_percent: 10 },
    read_iops: { metric: 'ReadIOPS', daily_peak_below_per_second: 20 },
    write_iops: { metric: 'WriteIOPS', daily_peak_below_per_second: 20 },
    completeness: {
      hours_per_day_required: 24,
      metrics_required: ['DatabaseConnections', 'CPUUtilization', 'ReadIOPS', 'WriteIOPS'],
      created_before_window: true,
    },
    activity_wins: true,
    scope: {
      evaluated_status: 'available',
      excluded: ['aurora', 'db_cluster_member', 'read_replica', 'read_replica_source', 'rds_custom', 'stopped'],
    },
    savings: {
      basis: 'estimate',
      price: 'regional_on_demand_instance_hour',
      key: ['region', 'engine', 'license_model', 'instance_class', 'deployment'],
      hours_per_month: 730,
      includes: ['instance_hours'],
      excludes: ['storage', 'provisioned_iops', 'storage_throughput', 'backup_storage', 'snapshots', 'extended_support', 'public_ipv4', 'reservations_and_discounts'],
      not_priced: ['outposts', 'local_zone', 'oracle_cdb', 'sqlserver_developer', 'db2_marketplace', 'unknown_license_model', 'unknown_deployment'],
      missing_price: 'no_estimate',
      severity: 'from_estimate',
      severity_without_price: 'LOW',
    },
  },
};

describe('RDS_IDLE_RULE v1 -> v2 (C1b)', () => {
  it('changes only the savings contract: detection (window, metrics, thresholds, completeness, scope) is identical', () => {
    const { version: _v1, savings: _s1, ...detection1 } = PINNED_RDS[1] as Record<string, unknown>;
    const { version: _v2, savings: _s2, ...detection2 } = PINNED_RDS[2] as Record<string, unknown>;
    expect(detection2).toEqual(detection1);
  });
});

const PINNED_SNAPSHOT: Record<number, unknown> = {
  1: {
    id: 'ebs_old_snapshots',
    version: 1,
    owner_ids: ['self'],
    min_age_days: 180,
    state: 'completed',
    excluded_storage_tiers: ['archive'],
    exclusions: {
      ami: { owners: ['self'], include_deprecated: true, include_disabled: true },
      aws_backup: { source: 'recovery_point_in_backup_vault', resource_type: 'EBS' },
      dlm: { tag_keys: ['aws:dlm:lifecycle-policy-id', 'aws:dlm:lifecycle-schedule-name'], tag_key_prefix: 'aws:dlm:' },
      on_read_failure: 'couldnt_check',
    },
    savings: { basis: 'ceiling', price: 'regional_standard_snapshot_storage', missing_price: 'no_estimate', severity_cap: 'MEDIUM' },
  },
  // C1 review S-3: locked snapshots are excluded (any lock state but expired).
  2: {
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
  },
};

describe('RDS_IDLE_RULE identity', () => {
  it('matches the pinned definition of its version exactly (bump the version on any change)', () => {
    expect(RDS_IDLE_RULE.id).toBe('rds_idle');
    expect(JSON.parse(JSON.stringify(RDS_IDLE_RULE))).toEqual(PINNED_RDS[RDS_IDLE_RULE.version]);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(RDS_IDLE_RULE)).toBe(true);
    expect(Object.isFrozen(RDS_IDLE_RULE.completeness.metrics_required)).toBe(true);
  });
});

describe('EBS_OLD_SNAPSHOT_RULE identity', () => {
  it('matches the pinned definition of its version exactly (bump the version on any change)', () => {
    expect(EBS_OLD_SNAPSHOT_RULE.id).toBe('ebs_old_snapshots');
    expect(JSON.parse(JSON.stringify(EBS_OLD_SNAPSHOT_RULE))).toEqual(PINNED_SNAPSHOT[EBS_OLD_SNAPSHOT_RULE.version]);
  });

  it('cannot be changed at run time, and lists your own snapshots only', () => {
    expect(Object.isFrozen(EBS_OLD_SNAPSHOT_RULE)).toBe(true);
    expect(Object.isFrozen(EBS_OLD_SNAPSHOT_RULE.owner_ids)).toBe(true);
    expect([...EBS_OLD_SNAPSHOT_RULE.owner_ids]).toEqual(['self']);
  });

  it('writes the separate EBS Snapshot resource type', () => {
    expect(EBS_SNAPSHOT_RESOURCE_TYPE).toBe('EBS Snapshot');
  });
});

describe('regional EBS snapshot price table', () => {
  it('names its source and publication date', () => {
    expect(EBS_SNAPSHOT_STANDARD_PRICE_SOURCE).toEqual({
      url: 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json',
      usage: 'Storage Snapshot Amazon S3 GB Mo',
      published: '2026-11-21T00:48:16Z',
      retrieved: '2026-11-23',
    });
  });

  it('holds the 34 commercial regions AWS published a price for, as published', () => {
    const table = EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION;
    expect(Object.keys(table)).toHaveLength(34);
    for (const [region, price] of Object.entries(table)) {
      expect(region).toMatch(REGION_NAME_PATTERN);
      expect(region.startsWith('us-gov-')).toBe(false);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(0.1);
    }
    expect(table['us-east-1']).toBe(0.05);
    expect(table['eu-central-1']).toBe(0.054);
    expect(table['sa-east-1']).toBe(0.068);
    expect(table['ap-southeast-6']).toBe(0.0577);
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('answers a region only with its own price, never another region\'s', () => {
    expect(ebsSnapshotStandardPricePerGbMonth('us-east-1')).toBe(0.05);
    expect(ebsSnapshotStandardPricePerGbMonth('af-south-1')).toBe(0.0595);
    expect(ebsSnapshotStandardPricePerGbMonth('us-gov-west-1')).toBeNull();
    expect(ebsSnapshotStandardPricePerGbMonth('xx-nowhere-1')).toBeNull();
    expect(ebsSnapshotStandardPricePerGbMonth('toString')).toBeNull();
    expect(ebsSnapshotStandardPricePerGbMonth('')).toBeNull();
    expect(ebsSnapshotStandardPricePerGbMonth(undefined)).toBeNull();
  });
});
