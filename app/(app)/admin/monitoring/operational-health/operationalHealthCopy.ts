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

// ---------------------------------------------------------------- resource checks table (O2)

export const TABLE_COPY = {
  title: 'Resource checks',
  caption: 'Latest check result for each resource, most urgent first',
  tableCaption: 'Resource checks, most urgent first',
  search: 'Search resources',
  filterGroup: 'Filter by type',
  all: 'All',
  attention: 'Needs attention',
  columns: { resource: 'Resource', type: 'Type', status: 'Status', metric: 'Key metric', lastSeen: 'Last seen' },
  loading: 'Loading resource checks…',
  error: "Couldn't load resource checks.",
  notConnected: 'Connect AWS to see resource checks.',
  multipleAccounts: 'More than one AWS account is connected, so nothing is shown yet.',
  incomplete: "This list may be incomplete: discovery didn't finish.",
  partial: "Some checks didn't complete; those rows say why.",
  emptyIncomplete: "No resources found yet. Discovery didn't finish, so some may be missing.",
  emptyIn: (region: string) => `No resources found in ${region}.`,
  clearSearch: 'Clear search',
  showAll: 'Show all',
  previous: 'Previous',
  next: 'Next',
  pages: 'Resource checks pages',
  allServices: 'All services →',
  lastDatapoint: 'Last datapoint',
  lastStatusCheck: 'Last status check',
} as const

export const TABLE_HREF = { allServices: '/services' } as const

/** One resource's type, singular (the filter buttons use TYPE_LABEL). */
export const TYPE_NAME: Record<string, string> = { ...TYPE_LABEL, 'load-balancer': 'Load balancer' }

/** Status labels (States board B). */
export const ROW_STATUS = {
  failing: 'Failing',
  needs_attention: 'Needs attention',
  no_telemetry: 'No telemetry',
  unknown: 'Unknown',
  passing: 'Passing',
  not_enough_traffic: 'Not enough traffic',
  no_activity: 'No activity',
  stopped: 'Stopped',
  not_measured: 'Not measured yet',
} as const

/** Reason lines; every one restates a field the backend sent (o2-step1.md §2.2, decision D4). */
export const ROW_REASON = {
  status: (detail: string) => `Status: ${detail}`,
  noTelemetry: (range: string) => `No telemetry in the last ${range}`,
  requiredMetricEmpty: (range: string) => `A required metric had no data in the last ${range}`,
  access_denied: "Couldn't check: access denied",
  throttled: "Couldn't check: AWS throttled the request",
  query_failed: "Couldn't check: the query failed",
  notSupportedIn: (detail: string) => `Can't be judged in status: ${detail}`,
  notSupported: "This resource can't be evaluated by its check yet",
  notEnoughTraffic: (range: string) => `Too few requests in the last ${range} to judge the 5xx rate`,
  noInvocations: (range: string) => `No invocations in the last ${range}`,
  noRequests: (range: string) => `No requests in the last ${range}`,
  noActivity: (range: string) => `No activity in the last ${range}`,
  stopped: 'Not checked while stopped',
  outsideRegion: (rowRegion: string | null, region: string) => `In ${rowRegion ?? 'another region'}, outside ${region}; not checked yet`,
  outsideAccount: 'In another AWS account; not checked here',
  notMeasured: 'Listed so you can see it exists; not counted in coverage',
  unrecognised: 'Status not recognised',
} as const

/**
 * The key metric(s) per type, in order, by the label (and unit) the backend
 * sends; each shown only when the row carries it (decision D5). The
 * status-driving value comes first, then one context value (Oct 30 decision).
 * `also` adds a second value of the same query after a comma; `positive` hides
 * a zero; `over` labels the window without the statistic, "(over 1h)", for a
 * rate whose API statistic ("Sum", a ratio of two sums) would read oddly. The
 * load balancer's 5xx rate is sent only when the verdict judged it
 * (observability-states.ts ob3Metrics); there is no fallback to the 5xx count.
 */
export type KeyMetricDef = { label: string; unit?: string; name: string; positive?: boolean; over?: boolean; also?: { label: string; unit?: string } }

export const KEY_METRICS: Record<string, KeyMetricDef[]> = {
  ec2: [{ label: 'CPU', name: 'CPU' }],
  'load-balancer': [{ label: '5xx rate', name: '5xx', over: true }, { label: 'Avg latency', name: 'Response' }],
  rds: [{ label: 'CPU', name: 'CPU' }, { label: 'Free storage', unit: 'GiB', name: 'Free storage', also: { label: 'Free storage', unit: '% of allocated' } }],
  // Throttles drive needs_attention (T1), so they're shown whenever there are any.
  lambda: [{ label: 'Errors', name: 'Errors' }, { label: 'Invocations', name: 'Invocations' }, { label: 'Throttles', name: 'Throttles', positive: true }],
  dynamodb: [{ label: 'System errors', name: 'System errors' }, { label: 'Throttled', name: 'Throttled' }],
  ecs: [{ label: 'Running', name: 'Running' }, { label: 'Desired', name: 'Desired' }],
  eks: [{ label: 'Health issues', name: 'Health issues' }],
  ebs: [{ label: 'Status check events', name: 'Status check events' }],
  cloudfront: [{ label: '5xx rate', name: '5xx' }, { label: '4xx rate', name: '4xx' }],
  aurora: [{ label: 'CPU', name: 'CPU' }, { label: 'Replica lag', name: 'Replica lag' }],
}
