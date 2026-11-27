/**
 * An opportunity card's "Why: [resource] · [what the check found]" line
 * (spec item 11, safeguard 4). The finding text comes ONLY from the metadata
 * fields listed in WHY_EVIDENCE_FIELDS for its issue: every builder reads
 * through `read()`, which refuses any other path. ARNs, VPC/subnet IDs,
 * allocation IDs, IP lists, instance ID lists and every other raw identifier
 * in the stored metadata are never read. When a field a builder needs is
 * missing (an older rule version, a legacy row), the line falls back to the
 * finding's issue label: never invented text.
 */
import { displayIssue } from '@/lib/finding-display'

type Path = readonly string[]

/** Issue text (cost_recommendations.issue, the registry's ISSUE_* identities) → the metadata paths its "Why" may read. */
export const WHY_EVIDENCE_FIELDS: Record<string, readonly Path[]> = {
  'Idle Instance': [['low_activity', 'worst', 'cpu_peak_percent'], ['low_activity', 'worst', 'network_bytes_max'], ['rule', 'window', 'days']],
  'Idle RDS Instance': [['rds_idle', 'worst', 'cpu_peak_percent'], ['rule', 'window', 'days']],
  'Old EBS Snapshot': [['ebs_old_snapshot', 'age_days']],
  'Idle NAT Gateway': [['rule', 'window', 'days'], ['nat_gateway_idle', 'routes', 'route_table_count']],
  'Unattached EBS Volume': [['size_gb'], ['volume_type']],
  'gp2 to gp3 Migration Opportunity': [['size_gb'], ['current_iops']],
  'S3 Lifecycle Optimization': [['lifecycle_state'], ['standard_storage_gb']],
  'Low-Usage Lambda Function': [['invocations_30d']],
  'DynamoDB Capacity Review Opportunity': [
    ['analysis_window_days'],
    ['read', 'qualifies'], ['read', 'highest_hourly_average_utilization_percent'],
    ['write', 'qualifies'], ['write', 'highest_hourly_average_utilization_percent'],
  ],
  'DynamoDB Capacity Mode Comparison': [['current_capacity_mode'], ['analysis_window_days']],
  'Unused Elastic IP': [],
  'Reserved Instance Opportunity': [['running_count'], ['reserved_count']],
}

type Reader = (path: Path) => unknown

function readerFor(issue: string, metadata: unknown): Reader {
  const allowed = WHY_EVIDENCE_FIELDS[issue] ?? []
  return (path) => {
    if (!allowed.some((p) => p.length === path.length && p.every((key, i) => key === path[i]))) {
      throw new Error(`"Why" for ${issue} may not read metadata.${path.join('.')}`)
    }
    let value: unknown = metadata
    for (const key of path) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      value = (value as Record<string, unknown>)[key]
    }
    return value
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => (num(v) !== null && Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null)
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
/** One decimal, rounded down, like the backend's descriptions (a qualifying peak never rounds up past its threshold). */
const floorTenth = (v: number) => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1)
/** The busiest day in MB, rounded up so "under" stays true (backend formatMaxDailyMb). */
const maxDailyMb = (bytes: number) => ((Math.floor(Math.max(0, bytes) / 100_000) + 1) / 10).toFixed(1)
const gb = (v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(1))
const overDays = (days: number | null) => (days !== null && days > 0 ? ` over ${days} days` : '')

/** Each issue's finding phrase from its allowlisted fields; null when a needed field is missing. */
const BUILDERS: Record<string, (read: Reader) => string | null> = {
  'Idle Instance': (read) => {
    const cpu = num(read(['low_activity', 'worst', 'cpu_peak_percent']))
    const net = num(read(['low_activity', 'worst', 'network_bytes_max']))
    if (cpu === null || net === null) return null
    return `CPU peaked at ${floorTenth(cpu)}% and network stayed under ${maxDailyMb(net)} MB a day${overDays(int(read(['rule', 'window', 'days'])))}`
  },
  'Idle RDS Instance': (read) => {
    const cpu = num(read(['rds_idle', 'worst', 'cpu_peak_percent']))
    if (cpu === null) return null
    return `no client connections in any hourly sample${overDays(int(read(['rule', 'window', 'days'])))}; CPU peaked at ${floorTenth(cpu)}%`
  },
  'Old EBS Snapshot': (read) => {
    const age = int(read(['ebs_old_snapshot', 'age_days']))
    if (age === null) return null
    return `${age} days old; not used by an AMI, AWS Backup plan or Data Lifecycle Manager policy`
  },
  'Idle NAT Gateway': (read) => {
    const days = int(read(['rule', 'window', 'days']))
    if (days === null) return null
    const tables = int(read(['nat_gateway_idle', 'routes', 'route_table_count']))
    const routes = tables !== null && tables > 0 ? `; ${tables} route ${plural(tables, 'table still sends', 'tables still send')} traffic to it` : ''
    return `no connections or traffic in the last ${days} days${routes}`
  },
  'Unattached EBS Volume': (read) => {
    const size = num(read(['size_gb']))
    const type = read(['volume_type'])
    if (size === null || typeof type !== 'string' || !/^[a-z0-9]{2,10}$/.test(type)) return null
    return `${gb(size)} GB ${type} volume not attached to any instance`
  },
  'gp2 to gp3 Migration Opportunity': (read) => {
    const size = num(read(['size_gb']))
    const iops = int(read(['current_iops']))
    if (size === null || iops === null) return null
    return `${gb(size)} GB gp2 volume at ${iops.toLocaleString('en-US')} IOPS, within gp3's included baseline`
  },
  'S3 Lifecycle Optimization': (read) => {
    const state = read(['lifecycle_state'])
    const size = num(read(['standard_storage_gb']))
    if (size === null) return null
    if (state === 'no_lifecycle_configuration') return `no lifecycle configuration; ${size.toFixed(1)} GB in S3 Standard`
    if (typeof state === 'string') return `lifecycle rules never expire objects; ${size.toFixed(1)} GB in S3 Standard`
    return null
  },
  'Low-Usage Lambda Function': (read) => {
    const invocations = int(read(['invocations_30d']))
    if (invocations === null) return null
    return invocations === 0 ? 'no invocations in 30 days' : `${invocations.toLocaleString('en-US')} ${plural(invocations, 'invocation', 'invocations')} in 30 days`
  },
  'DynamoDB Capacity Review Opportunity': (read) => {
    const parts: string[] = []
    for (const side of ['read', 'write'] as const) {
      const peak = num(read([side, 'highest_hourly_average_utilization_percent']))
      if (read([side, 'qualifies']) === true && peak !== null) parts.push(`${side} use peaked at ${floorTenth(peak)}% of provisioned capacity`)
    }
    if (parts.length === 0) return null
    return `${parts.join('; ')}${overDays(int(read(['analysis_window_days'])))}`
  },
  'DynamoDB Capacity Mode Comparison': (read) => {
    const mode = read(['current_capacity_mode'])
    const label = mode === 'PROVISIONED' ? 'provisioned' : mode === 'PAY_PER_REQUEST' ? 'on-demand' : null
    if (!label) return null
    const days = int(read(['analysis_window_days']))
    return `${label} capacity; ${days !== null && days > 0 ? `${days}-day` : 'recent'} usage compared with the other capacity mode`
  },
  // Founder ruling Q11: what the check tests (an address allocated but not associated), not a measurement.
  'Unused Elastic IP': () => 'allocated but not attached to an instance',
  'Reserved Instance Opportunity': (read) => {
    const running = int(read(['running_count']))
    const reserved = int(read(['reserved_count']))
    if (running === null || reserved === null) return null
    return `${running} running, ${reserved} covered by same-type Reserved Instances; Savings Plans not checked`
  },
}

/**
 * A resource name that is a raw identifier this line must not show: an ARN,
 * anything with a 12-digit run (an AWS account ID), or a VPC-level ID. The
 * resource's own name (its Name tag, or the ID AWS gave the resource itself)
 * is shown, as on Cost Optimization.
 */
export function isRawIdentifier(name: string): boolean {
  return /^arn:/i.test(name) || /\d{12}/.test(name) || /^(?:vpc|subnet|eipalloc|eipassoc|eni|sg|rtb|igw|acl)-/i.test(name)
}

const GENERIC_RESOURCE: Record<string, string> = {
  EC2: 'EC2 instance',
  RDS: 'RDS instance',
  EBS: 'EBS volume',
  'EBS Snapshot': 'EBS snapshot',
  S3: 'S3 bucket',
  Lambda: 'Lambda function',
  DynamoDB: 'DynamoDB table',
  'NAT Gateway': 'NAT gateway',
}

export function whyResource(rec: { resourceName?: string | null; resourceType?: string | null }): string {
  const name = typeof rec.resourceName === 'string' ? rec.resourceName.trim() : ''
  if (name && !isRawIdentifier(name)) return name
  return (rec.resourceType && GENERIC_RESOURCE[rec.resourceType]) || 'This resource'
}

/** The finding phrase, or null when its issue has no builder or a needed field is missing. */
export function whyFinding(rec: { issue?: string | null; metadata?: Record<string, unknown> | null }): string | null {
  const issue = rec.issue
  if (!issue || !BUILDERS[issue]) return null
  return BUILDERS[issue](readerFor(issue, rec.metadata ?? null))
}

/** "Why: web-01 · CPU peaked at 1.2% …", or "Why: web-01 · Idle Instance" when the evidence isn't stored. */
export function whyLine(rec: { issue?: string | null; resourceName?: string | null; resourceType?: string | null; metadata?: Record<string, unknown> | null }): string {
  const finding = whyFinding(rec) ?? displayIssue(rec) ?? 'Cost optimization available'
  return `Why: ${whyResource(rec)} · ${finding}`
}
