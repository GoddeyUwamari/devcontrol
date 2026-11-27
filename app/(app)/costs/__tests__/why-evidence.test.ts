/**
 * Safeguard 4: an opportunity's "Why:" line reads ONLY the allowlisted
 * evidence fields of its issue (WHY_EVIDENCE_FIELDS): never ARNs, VPC or
 * subnet IDs, allocation IDs, IP lists or instance ID lists, even though the
 * API sends them in `metadata`. A missing field falls back to the issue label.
 * Every ID, ARN and name below is a made-up fixture (12-digit runs are fake).
 */
import { describe, expect, it } from 'vitest'
import { isRawIdentifier, WHY_EVIDENCE_FIELDS, whyFinding, whyLine, whyResource } from '../why-evidence'

const FAKE_ARN = 'arn:aws:rds:xx-test-1:000000000000:db:fixture-db'
const FAKE_VPC = 'vpc-0fixture0000000'
const FAKE_SUBNET = 'subnet-0fixture000000'

/** The noise every fixture carries: raw identifiers the line must never show. */
const RAW = {
  db_instance_arn: FAKE_ARN, dbi_resource_id: 'db-FIXTURE', vpc_id: FAKE_VPC, subnet_id: FAKE_SUBNET,
  allocation_id: 'eipalloc-0fixture', public_ip: '198.51.100.7', instance_ids: ['i-0fixture1', 'i-0fixture2'],
}

const FIXTURES: Record<string, { resourceType: string; metadata: Record<string, unknown>; expected: string }> = {
  'Idle Instance': {
    resourceType: 'EC2',
    metadata: { ...RAW, rule: { window: { days: 30 } }, low_activity: { worst: { cpu_peak_percent: 2.37, network_bytes_max: 3_200_000, network_max_date: '2026-11-01' }, topology: { vpc_id: FAKE_VPC } } },
    expected: 'CPU peaked at 2.3% and network stayed under 3.3 MB a day over 30 days',
  },
  'Idle RDS Instance': {
    resourceType: 'RDS',
    metadata: { ...RAW, rule: { window: { days: 30 } }, rds_idle: { worst: { cpu_peak_percent: 1.08 } } },
    expected: 'no client connections in any hourly sample over 30 days; CPU peaked at 1.0%',
  },
  'Old EBS Snapshot': {
    resourceType: 'EBS Snapshot',
    metadata: { ...RAW, ebs_old_snapshot: { age_days: 412, volume_id: 'vol-0fixture', volume_size_gb: 8 } },
    expected: '412 days old; not used by an AMI, AWS Backup plan or Data Lifecycle Manager policy',
  },
  'Idle NAT Gateway': {
    resourceType: 'NAT Gateway',
    metadata: { ...RAW, rule: { window: { days: 32 } }, nat_gateway_idle: { vpc_id: FAKE_VPC, subnet_id: FAKE_SUBNET, routes: { route_table_count: 2, route_tables: [{ id: 'rtb-0fixture' }] } } },
    expected: 'no connections or traffic in the last 32 days; 2 route tables still send traffic to it',
  },
  'Unattached EBS Volume': { resourceType: 'EBS', metadata: { ...RAW, size_gb: 100, volume_type: 'gp2', availability_zone: 'xx-test-1a' }, expected: '100 GB gp2 volume not attached to any instance' },
  'gp2 to gp3 Migration Opportunity': { resourceType: 'EBS', metadata: { ...RAW, size_gb: 500, current_iops: 1500 }, expected: "500 GB gp2 volume at 1,500 IOPS, within gp3's included baseline" },
  'S3 Lifecycle Optimization': { resourceType: 'S3', metadata: { ...RAW, lifecycle_state: 'no_lifecycle_configuration', standard_storage_gb: 12.34 }, expected: 'no lifecycle configuration; 12.3 GB in S3 Standard' },
  'Low-Usage Lambda Function': { resourceType: 'Lambda', metadata: { ...RAW, invocations_30d: 3 }, expected: '3 invocations in 30 days' },
  'DynamoDB Capacity Review Opportunity': {
    resourceType: 'DynamoDB',
    metadata: { ...RAW, analysis_window_days: 14, read: { qualifies: true, highest_hourly_average_utilization_percent: 4.29 }, write: { qualifies: false, highest_hourly_average_utilization_percent: 80 } },
    expected: 'read use peaked at 4.2% of provisioned capacity over 14 days',
  },
  'DynamoDB Capacity Mode Comparison': { resourceType: 'DynamoDB', metadata: { ...RAW, current_capacity_mode: 'PROVISIONED', analysis_window_days: 14 }, expected: 'provisioned capacity; 14-day usage compared with the other capacity mode' },
  'Unused Elastic IP': { resourceType: 'EC2', metadata: { ...RAW }, expected: 'allocated but not attached to an instance' },
  'Reserved Instance Opportunity': { resourceType: 'EC2', metadata: { ...RAW, running_count: 3, reserved_count: 1, uncovered_count: 2 }, expected: '3 running, 1 covered by same-type Reserved Instances; Savings Plans not checked' },
}

/** A deep proxy over `target` that records every property path read. */
function recording(target: unknown, reads: string[], path: string[] = []): unknown {
  if (target === null || typeof target !== 'object') return target
  return new Proxy(target as object, {
    get(obj, key) {
      if (typeof key === 'symbol') return Reflect.get(obj, key)
      const next = [...path, key]
      reads.push(next.join('.'))
      return recording(Reflect.get(obj, key), reads, next)
    },
  })
}

describe('"Why:" reads only allowlisted fields (safeguard 4)', () => {
  it('every registry issue with stored evidence has a fixture here', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(WHY_EVIDENCE_FIELDS).sort())
  })

  it.each(Object.entries(FIXTURES))('%s: the finding phrase from its fields only', (issue, { metadata, expected }) => {
    const reads: string[] = []
    const finding = whyFinding({ issue, metadata: recording(metadata, reads) as Record<string, unknown> })
    expect(finding).toBe(expected)
    const allowed = WHY_EVIDENCE_FIELDS[issue].map((p) => p.join('.'))
    // Every path read is an allowlisted path or a step on the way to one.
    for (const read of reads) expect(allowed.some((a) => a === read || a.startsWith(`${read}.`)), read).toBe(true)
  })

  it.each(Object.entries(FIXTURES))('%s: no ARN, VPC/subnet ID, allocation ID, IP list or instance ID list in the line', (issue, { resourceType, metadata }) => {
    const line = whyLine({ issue, resourceType, resourceName: 'fixture-name', metadata })
    for (const raw of [FAKE_ARN, FAKE_VPC, FAKE_SUBNET, 'eipalloc-0fixture', '198.51.100.7', 'i-0fixture1', 'rtb-0fixture', 'vol-0fixture', 'db-FIXTURE', 'xx-test-1']) {
      expect(line).not.toContain(raw)
    }
    expect(line).toMatch(/^Why: fixture-name · /)
  })

  it('a missing field falls back to the issue label, never invented text', () => {
    expect(whyLine({ issue: 'Idle RDS Instance', resourceName: 'db-fixture', resourceType: 'RDS', metadata: { db_instance_arn: FAKE_ARN } })).toBe('Why: db-fixture · Idle RDS Instance')
    expect(whyLine({ issue: 'Oversized Instance', resourceName: 'db-old', resourceType: 'RDS', metadata: {} })).toBe('Why: db-old · Oversized Instance')
    expect(whyLine({ issue: 'Unattached EBS Volume', resourceName: 'v', resourceType: 'EBS', metadata: { size_gb: 10, volume_type: FAKE_ARN } })).toBe('Why: v · Unattached EBS Volume')
  })

  it('a resource name that is an ARN, an account ID or a VPC-level ID is not shown', () => {
    expect(whyResource({ resourceName: FAKE_ARN, resourceType: 'RDS' })).toBe('RDS instance')
    expect(whyResource({ resourceName: 'name-000000000000', resourceType: 'S3' })).toBe('S3 bucket')
    expect(whyResource({ resourceName: FAKE_VPC, resourceType: 'Unknown' })).toBe('This resource')
    expect(whyResource({ resourceName: 'web-01', resourceType: 'EC2' })).toBe('web-01')
    expect(isRawIdentifier('i-0fixture1')).toBe(false)
  })
})
