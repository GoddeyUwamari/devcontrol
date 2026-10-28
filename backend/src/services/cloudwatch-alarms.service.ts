/**
 * CloudWatch alarms for the Observability page: the alarms in ALARM and how
 * many alarms are configured, read from the organization's one connected AWS
 * account in its home region.
 *
 * Where the alarms come from: the caller's organization only. The account is
 * the organization's one eligible aws_accounts row (aws-accounts.repository.ts)
 * and the role is that row's, assumed by AWSClientFactory. Nothing from the
 * request chooses the account, role or region.
 *
 * Truthfulness rules:
 *   - an error never carries a count or a list: access denied, throttling,
 *     a failed page or a failed role assumption is status 'error' with null
 *     counts, never 0 alarms;
 *   - the alarms in ALARM and the configured count are read in two passes,
 *     each capped; a capped pass is reported incomplete, so a configured count
 *     cut off at the cap is a lower bound ("at least N");
 *   - "in ALARM since" is StateTransitionedTimestamp, the last change of the
 *     alarm's StateValue (StateUpdatedTimestamp also moves when the state does not).
 *
 * Only fields from the DescribeAlarms projections (aws-response-projections.ts)
 * are read, and only the fields of InAlarmItem leave this module: no
 * descriptions, actions, ARNs or dimension lists.
 */
import { DescribeAlarmsCommand, type CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { pool } from '../config/database'
import { AWSClientFactory, assumedRoleSourceOf } from './aws-client-factory.service'
import {
  projectCompositeAlarm,
  projectMetricAlarm,
  type CompositeAlarmFields,
  type MetricAlarmFields,
} from './aws-response-projections'
import {
  findEligibleAwsAccount,
  homeRegionOf,
  isAwsAccountAmbiguous,
  AwsAccountNotConnectedError,
  type AwsAccountRow,
} from '../repositories/aws-accounts.repository'
import {
  DEFAULT_AWS_CALL_POLICY,
  isAccessDeniedError,
  isThrottlingError,
  listAllPages,
  withCallPolicy,
  type AwsCallPolicy,
  type Listing,
} from '../utils/awsCallPolicy'

/** DescribeAlarms' largest page. */
export const ALARMS_PAGE_SIZE = 100
/** Pages read for the alarms in ALARM: at most 500 alarms. */
export const IN_ALARM_MAX_PAGES = 5
/** Pages read for the configured count: at most 1,000 alarms. */
export const CONFIGURED_MAX_PAGES = 10
/** How long a successful result is served from the cache. */
export const ALARMS_CACHE_TTL_MS = 60 * 1000

/** Without AlarmTypes, DescribeAlarms returns metric alarms only. */
const ALARM_TYPES = ['MetricAlarm', 'CompositeAlarm'] as const

export type AlarmsErrorReason = 'access_denied' | 'throttled' | 'failed' | 'not_connected' | 'multiple_accounts'

export interface AlarmResource {
  type: string
  id: string
}

export interface InAlarmItem {
  name: string
  type: 'metric' | 'composite'
  /** Null for composite and metric-math alarms. */
  namespace: string | null
  metric: string | null
  /** Null for composite alarms. */
  comparison: string | null
  /** Null for composite alarms and for alarms with no numeric threshold (anomaly bands). */
  threshold: number | null
  /** When the alarm last changed state (StateTransitionedTimestamp); null when AWS gives none. */
  state_since: string | null
  /** The resource the alarm watches, when one well-known dimension names it; else null. */
  resource: AlarmResource | null
}

export type AlarmsResult =
  | {
      status: 'ok'
      reason: null
      checked_at: string
      region: string
      in_alarm: InAlarmItem[]
      in_alarm_complete: boolean
      /** A lower bound ("at least N") when configured_count_complete is false. */
      configured_count: number
      configured_count_complete: boolean
      truncated: boolean
    }
  | {
      status: 'error'
      reason: AlarmsErrorReason
      checked_at: string
      region: string | null
      in_alarm: null
      in_alarm_complete: null
      configured_count: null
      configured_count_complete: null
      truncated: null
    }

/**
 * Namespace -> the one dimension that names the alarm's resource, and the
 * resource type DevControl uses for it. Anything else (custom namespaces,
 * Auto Scaling group alarms, metric math) has no resource.
 */
const RESOURCE_DIMENSIONS: Record<string, Array<{ key: string; type: string }>> = {
  'AWS/EC2': [{ key: 'InstanceId', type: 'ec2' }],
  'AWS/RDS': [
    { key: 'DBInstanceIdentifier', type: 'rds' },
    { key: 'DBClusterIdentifier', type: 'aurora' },
  ],
  'AWS/Lambda': [{ key: 'FunctionName', type: 'lambda' }],
  'AWS/ApplicationELB': [{ key: 'LoadBalancer', type: 'load-balancer' }],
  'AWS/DynamoDB': [{ key: 'TableName', type: 'dynamodb' }],
  'AWS/EBS': [{ key: 'VolumeId', type: 'ebs' }],
  'AWS/CloudFront': [{ key: 'DistributionId', type: 'cloudfront' }],
}

/** The alarm's resource, when exactly one of its namespace's resource dimensions names it. */
export function alarmResource(alarm: MetricAlarmFields): AlarmResource | null {
  if (alarm.UsesMetricMath || !alarm.Namespace) return null
  const candidates = RESOURCE_DIMENSIONS[alarm.Namespace] ?? []
  const found: AlarmResource[] = []
  for (const { key, type } of candidates) {
    const matches = alarm.Dimensions.filter(d => d.Name === key)
    if (matches.length > 1) return null
    const value = matches[0]?.Value
    if (typeof value === 'string' && value !== '') found.push({ type, id: value })
  }
  return found.length === 1 ? found[0] : null
}

const isoOrNull = (date: Date | undefined): string | null =>
  date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null

export function metricAlarmItem(alarm: MetricAlarmFields): InAlarmItem {
  return {
    name: alarm.AlarmName ?? '',
    type: 'metric',
    namespace: alarm.UsesMetricMath ? null : alarm.Namespace ?? null,
    metric: alarm.UsesMetricMath ? null : alarm.MetricName ?? null,
    comparison: alarm.ComparisonOperator ?? null,
    threshold: typeof alarm.Threshold === 'number' ? alarm.Threshold : null,
    state_since: isoOrNull(alarm.StateTransitionedTimestamp),
    resource: alarmResource(alarm),
  }
}

export function compositeAlarmItem(alarm: CompositeAlarmFields): InAlarmItem {
  return {
    name: alarm.AlarmName ?? '',
    type: 'composite',
    namespace: null,
    metric: null,
    comparison: null,
    threshold: null,
    state_since: isoOrNull(alarm.StateTransitionedTimestamp),
    resource: null,
  }
}

type ProjectedAlarm =
  | { kind: 'metric'; alarm: MetricAlarmFields }
  | { kind: 'composite'; alarm: CompositeAlarmFields }

/**
 * Every metric and composite alarm in the client's account and region (only
 * those in `stateValue` when given), at most `maxPages` pages. A failed page
 * throws, so there is never a partial answer that looks complete.
 */
export async function listAlarms(
  client: Pick<CloudWatchClient, 'send'>,
  stateValue: 'ALARM' | undefined,
  maxPages: number
): Promise<Listing<ProjectedAlarm>> {
  const seenTokens = new Set<string>()
  return listAllPages<ProjectedAlarm>(`DescribeAlarms${stateValue ? ` ${stateValue}` : ''}`, async (token) => {
    const page = await client.send(new DescribeAlarmsCommand({
      AlarmTypes: [...ALARM_TYPES],
      StateValue: stateValue,
      MaxRecords: ALARMS_PAGE_SIZE,
      NextToken: token,
    }))
    const metric = (page.MetricAlarms ?? []).map(projectMetricAlarm)
    const composite = (page.CompositeAlarms ?? []).map(projectCompositeAlarm)
    const nextToken = page.NextToken || undefined
    if (nextToken) {
      if (seenTokens.has(nextToken)) throw new Error('DescribeAlarms returned a repeated NextToken')
      seenTokens.add(nextToken)
    }
    return {
      items: [
        ...metric.map((alarm): ProjectedAlarm => ({ kind: 'metric', alarm })),
        ...composite.map((alarm): ProjectedAlarm => ({ kind: 'composite', alarm })),
      ],
      nextToken,
    }
  }, maxPages)
}

/** The reason an AWS call failed, as the endpoint reports it. */
export function awsFailureReason(error: unknown): AlarmsErrorReason {
  if (isAccessDeniedError(error)) return 'access_denied'
  if (isThrottlingError(error)) return 'throttled'
  return 'failed'
}

function errorResult(reason: AlarmsErrorReason, checkedAt: Date, region: string | null): AlarmsResult {
  return {
    status: 'error',
    reason,
    checked_at: checkedAt.toISOString(),
    region,
    in_alarm: null,
    in_alarm_complete: null,
    configured_count: null,
    configured_count_complete: null,
    truncated: null,
  }
}

const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err)

interface CacheEntry {
  organizationId: string
  cachedAt: number
  result: AlarmsResult
}

export class CloudWatchAlarmsService {
  private cache = new Map<string, CacheEntry>()
  private inFlight = new Map<string, Promise<AlarmsResult>>()

  constructor(
    private readonly policy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY,
    private readonly now: () => number = Date.now
  ) {}

  /** Tests only: forgets every cached and in-flight result, so one test's answer never serves the next. */
  clearCacheForTests(): void {
    this.cache.clear()
    this.inFlight.clear()
  }

  /** Organization, account (its row and its AWS account ID, which may be unrecorded) and region. */
  private static cacheKey(organizationId: string, account: AwsAccountRow, region: string): string {
    return `${organizationId}:${account.id}:${account.account_id ?? ''}:${region}`
  }

  /**
   * The organization's alarms. The caller must already have authenticated the
   * organization; its connected account is read before the cache, so a
   * disconnected or changed account is never answered from it.
   */
  async getAlarms(organizationId: string): Promise<AlarmsResult> {
    const startedAt = new Date(this.now())
    let account: AwsAccountRow | null
    try {
      account = await findEligibleAwsAccount(pool, organizationId)
    } catch (err) {
      if (isAwsAccountAmbiguous(err)) return errorResult('multiple_accounts', startedAt, null)
      console.error('[Alarms] account lookup failed:', errorName(err))
      return errorResult('failed', startedAt, null)
    }
    if (!account) return errorResult('not_connected', startedAt, null)

    const region = homeRegionOf(account)
    const key = CloudWatchAlarmsService.cacheKey(organizationId, account, region)
    const cached = this.cache.get(key)
    if (cached && cached.organizationId === organizationId && this.now() - cached.cachedAt < ALARMS_CACHE_TTL_MS) {
      return cached.result
    }

    const pending = this.inFlight.get(key)
    if (pending) return pending
    const work = this.read(organizationId, account, region, startedAt)
      .then((result) => {
        if (result.status === 'ok') this.store(key, organizationId, result)
        return result
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, work)
    return work
  }

  private store(key: string, organizationId: string, result: AlarmsResult): void {
    const now = this.now()
    for (const [k, entry] of this.cache) if (now - entry.cachedAt >= ALARMS_CACHE_TTL_MS) this.cache.delete(k)
    this.cache.set(key, { organizationId, cachedAt: now, result })
  }

  private async read(organizationId: string, account: AwsAccountRow, region: string, startedAt: Date): Promise<AlarmsResult> {
    let cloudWatch: CloudWatchClient
    try {
      const clients = await AWSClientFactory.createClients(organizationId)
      // The role assumed must be the account read above: a reconnect in between
      // must not put another account's alarms under this account's cache key.
      const source = assumedRoleSourceOf(clients)
      if (!source || source.organizationId !== organizationId || source.account.id !== account.id || source.region !== region) {
        console.error('[Alarms] assumed account does not match the account read for the request')
        return errorResult('failed', startedAt, region)
      }
      cloudWatch = withCallPolicy(clients.cloudWatch, this.policy)
    } catch (err) {
      if (err instanceof AwsAccountNotConnectedError) return errorResult('not_connected', startedAt, null)
      if (isAwsAccountAmbiguous(err)) return errorResult('multiple_accounts', startedAt, null)
      // The organization has an eligible account, so a failed role assumption
      // (or the platform's own identity being unavailable) is a failure, never
      // "not connected".
      console.error('[Alarms] AWS clients could not be created:', errorName(err))
      return errorResult('failed', startedAt, region)
    }

    try {
      const inAlarm = await listAlarms(cloudWatch, 'ALARM', IN_ALARM_MAX_PAGES)
      const configured = await listAlarms(cloudWatch, undefined, CONFIGURED_MAX_PAGES)
      const items = inAlarm.items
        .filter(({ alarm }) => alarm.StateValue === 'ALARM')
        .map((a) => (a.kind === 'metric' ? metricAlarmItem(a.alarm) : compositeAlarmItem(a.alarm)))
      return {
        status: 'ok',
        reason: null,
        checked_at: startedAt.toISOString(),
        region,
        in_alarm: items,
        in_alarm_complete: inAlarm.complete,
        configured_count: configured.items.length,
        configured_count_complete: configured.complete,
        truncated: !inAlarm.complete || !configured.complete,
      }
    } catch (err) {
      const reason = awsFailureReason(err)
      console.error(`[Alarms] DescribeAlarms failed (${reason}):`, errorName(err))
      return errorResult(reason, startedAt, region)
    }
  }
}

export const cloudWatchAlarmsService = new CloudWatchAlarmsService()
