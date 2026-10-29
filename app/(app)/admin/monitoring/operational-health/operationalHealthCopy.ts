/**
 * The Operational Health page's copy (NEXT_PUBLIC_OBSERVABILITY_V2). Strings
 * built from data live in operationalHealthModel.ts.
 */
import type { MonitoringRange } from './observabilityTypes'

export const PAGE_COPY = {
  title: 'Operational Health',
  subtitle: "Which resources are healthy, which need attention, and what we can't see yet.",
  refresh: 'Refresh',
  openCloudWatch: 'Open in CloudWatch ↗',
  rangeNote: 'The range applies to metric checks. Status checks and alarms show the current state.',
  retry: 'Retry',
  unavailable: '—',
  notAvailable: 'Not available',

  tileChecks: 'Resource checks',
  tileTelemetry: 'Telemetry coverage',
  tileAlarms: 'CloudWatch alarms',
  tileRegion: 'Region',
  checksCaption: 'Resources that have checks, by their latest result',
  checksError: "Couldn't load checks.",
  alarmsError: 'Couldn\'t read CloudWatch alarms. The banner can\'t say "no alarms".',
  inAlarm: 'in ALARM',
  configured: 'configured',
  viewAlarms: 'View alarms in CloudWatch ↗',
  regionCaption: "This page checks one AWS region. Resources in other regions aren't checked yet.",
  noneMeasured: 'None measured yet',

  byTypeTitle: 'By resource type',
  byTypeCaption: 'Each type is measured with the metric AWS provides for it',

  monitorTitle: 'What we monitor',
  planNote:
    "On the Free plan, discovery covers EC2, EBS, RDS and S3 only. Lambda, load balancers, ECS, EKS, DynamoDB, CloudFront and Aurora aren't discovered.",
  setUpSlos: 'Set up SLOs →',

  sloReport: 'SLO report →',
  auditLogs: 'Audit logs →',
  costs: 'Costs →',
  serviceStatus: 'DevControl service status ↗',
} as const

export const PAGE_HREF = {
  connectAws: '/connect-aws',
  sloReport: '/monitoring/slos',
  auditLogs: '/audit-logs',
  costs: '/costs',
  serviceStatus: '/status',
} as const

export const RANGES: MonitoringRange[] = ['5m', '15m', '1h', '3h', '24h', '7d']
export const DEFAULT_RANGE: MonitoringRange = '1h'

/** The console for the region the page checks; never a guessed default region. */
export const cloudWatchHref = (region: string) => `https://console.aws.amazon.com/cloudwatch/home?region=${encodeURIComponent(region)}`
export const alarmsHref = (region: string) => `${cloudWatchHref(region)}#alarmsV2:`

/** Display names, the "By resource type" order, and the signals each check reads (backend capability registry, OB3). */
export const TYPE_ORDER = ['ec2', 'load-balancer', 'rds', 'lambda', 'dynamodb', 'ecs', 'eks', 'ebs', 'cloudfront', 'aurora', 'api-gateway', 's3']

export const TYPE_LABEL: Record<string, string> = {
  ec2: 'EC2',
  'load-balancer': 'Load balancers',
  rds: 'RDS',
  lambda: 'Lambda',
  dynamodb: 'DynamoDB',
  ecs: 'ECS',
  eks: 'EKS',
  ebs: 'EBS',
  cloudfront: 'CloudFront',
  aurora: 'Aurora',
  'api-gateway': 'API Gateway',
  s3: 'S3',
}

/** For "No <plural> found". */
export const TYPE_PLURAL: Record<string, string> = {
  ec2: 'EC2 instances',
  'load-balancer': 'load balancers',
  rds: 'RDS instances',
  lambda: 'functions',
  dynamodb: 'DynamoDB tables',
  ecs: 'ECS services',
  eks: 'EKS clusters',
  ebs: 'EBS volumes',
  cloudfront: 'CloudFront distributions',
  aurora: 'Aurora clusters',
}

export const MEASURED_BY: Record<string, string> = {
  ec2: 'status checks, CPU',
  'load-balancer': 'response time (average), requests, 5xx rate; Application Load Balancers only',
  rds: 'instance status, CPU, connections, free storage',
  lambda: 'errors, duration, throttles',
  dynamodb: 'system errors, throttled requests',
  ecs: 'running and desired tasks',
  eks: 'cluster status, health issues',
  ebs: 'volume status',
  cloudfront: 'error rates (total, 4xx, 5xx)',
  aurora: 'CPU, replica lag',
}

/** Types with no check today (backend isNotMeasured): listed, never counted in coverage. */
export const NOT_MEASURED_TYPES = new Set(['api-gateway', 's3'])

/** What the Free plan's discovery covers (awsResourceDiscovery.ts TIER_RESOURCE_TYPES.free). */
export const FREE_DISCOVERED_TYPES = new Set(['ec2', 'ebs', 'rds', 's3'])

export type MonitorRowDef =
  | { kind: 'type'; type: string }
  | { kind: 'static_not_measured'; label: string }
  | { kind: 'alarms' }
  | { kind: 'slos' }

/** "What we monitor", grouped (O1 brief §5; ElastiCache, SQS and SNS per decision D9). */
export const MONITOR_GROUPS: Array<{ title: string; rows: MonitorRowDef[] }> = [
  { title: 'Compute', rows: [{ kind: 'type', type: 'ec2' }, { kind: 'type', type: 'lambda' }, { kind: 'type', type: 'ecs' }, { kind: 'type', type: 'eks' }] },
  {
    title: 'Storage and databases',
    rows: [
      { kind: 'type', type: 'ebs' },
      { kind: 'type', type: 'rds' },
      { kind: 'type', type: 'aurora' },
      { kind: 'type', type: 'dynamodb' },
      { kind: 'type', type: 's3' },
      { kind: 'static_not_measured', label: 'ElastiCache' },
    ],
  },
  {
    title: 'Traffic',
    rows: [
      { kind: 'type', type: 'load-balancer' },
      { kind: 'static_not_measured', label: 'Network and Gateway Load Balancers' },
      { kind: 'type', type: 'cloudfront' },
      { kind: 'type', type: 'api-gateway' },
      { kind: 'static_not_measured', label: 'SQS' },
      { kind: 'static_not_measured', label: 'SNS' },
    ],
  },
  { title: 'Alerting', rows: [{ kind: 'alarms' }] },
  { title: 'Configuration', rows: [{ kind: 'slos' }] },
]

export const STATE_LABEL = {
  monitored: 'Monitored',
  none_found: (plural: string) => `No ${plural} found`,
  not_measured: 'Not measured yet',
  no_activity: 'No activity',
  couldnt_check: "Couldn't check",
  none_set: 'None set',
  not_in_plan: 'Not included in your plan',
  checking: 'Checking…',
} as const
