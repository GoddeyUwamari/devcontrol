import {
  DescribeAlarmsCommand,
  type CloudWatchClient,
  type MetricAlarm,
} from '@aws-sdk/client-cloudwatch'
import { pool } from '../config/database'
import { AWSClientFactory } from './aws-client-factory.service'
import { resourceTypeRegistry } from './cloudwatch.service'
import {
  collectSection,
  notSupported,
  type ContextDataState,
  type ContextSection,
  type InventoryScope,
  type SectionMeta,
} from './ai-context-contract'

/**
 * Tier 0 observability readiness, measured from evidence only.
 *
 * The one component DevControl can measure today is EC2/RDS alert coverage:
 * a resource from the org's current discovered inventory counts as covered
 * only when a CloudWatch metric alarm, read in the same account and region
 * discovery ran in, targets it by exact dimension and would actually fire an
 * action. Nothing earns credit without an inventory-matched current resource:
 * alarms define neither the denominator nor the coverage.
 *
 * Monitoring coverage, signal freshness, and response setup have no source
 * yet and are reported as not_supported -- never as a score.
 */

// ── Discovery gate ───────────────────────

/**
 * The prefixes runDiscovery() (awsResourceDiscovery.ts) gives each sub-step
 * failure before joining them with DISCOVERY_ERROR_SEPARATOR into
 * resource_discovery_jobs.error_message. Pinned against that source by
 * observability-readiness.discovery-format.test.ts: a wording change there
 * fails that test instead of silently turning a failure into "usable".
 */
export const DISCOVERY_ERROR_PREFIXES = [
  'EC2: ',
  'EBS: ',
  'RDS: ',
  'S3: ',
  'Lambda: ',
  'Load Balancer: ',
  'CloudFront: ',
  'Resource Explorer inventory: ',
  'DynamoDB enrichment: ',
  'Aurora cluster enrichment: ',
  'Reconciliation: ',
  'Resource Explorer: ',
  'S3 reconciliation: ',
  'CloudFront reconciliation: ',
  'EBS reconciliation: ',
  'Compliance scan: ',
  'Security group scan: ',
  'IAM security scan: ',
  'Account-level security scan: ',
  'Orphaned detection: ',
  'Cost analysis: ',
] as const

export const DISCOVERY_ERROR_SEPARATOR = '; '

export type CoverageResourceType = 'ec2' | 'rds'

const TYPE_ERROR_PREFIX: Record<CoverageResourceType, string> = {
  ec2: 'EC2: ',
  rds: 'RDS: ',
}

const TYPE_LABEL: Record<CoverageResourceType, string> = {
  ec2: 'EC2',
  rds: 'RDS',
}

export interface GatedDiscoveryRun {
  id: string
  status: 'completed' | 'failed'
  startedAt: Date
  completedAt: Date
  resourceTypes: string[] | null
  errorMessage: string | null
}

export type DiscoveryGate =
  | { kind: 'usable'; run: GatedDiscoveryRun }
  | { kind: 'tier_excluded'; run: GatedDiscoveryRun }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; reason: string }

/**
 * Whether the latest finished discovery run can be trusted for `type`.
 * Fails closed: an unknown error prefix, an empty message on a failed run, or
 * a failure of this type's own scan makes it an error. Never falls back to an
 * older run.
 */
export function evaluateDiscoveryGate(
  run: GatedDiscoveryRun | null,
  type: CoverageResourceType
): DiscoveryGate {
  if (!run) {
    return { kind: 'unavailable', reason: 'no discovery run has finished for this account' }
  }
  if (!Array.isArray(run.resourceTypes)) {
    return { kind: 'error', reason: 'the latest discovery run did not record which resource types it scanned' }
  }
  if (!run.resourceTypes.includes(type)) {
    return { kind: 'tier_excluded', run }
  }
  if (run.status === 'completed') {
    return { kind: 'usable', run }
  }

  const message = run.errorMessage?.trim() ?? ''
  if (message === '') {
    return { kind: 'error', reason: 'the latest discovery run failed without a recorded reason' }
  }
  const segments = message.split(DISCOVERY_ERROR_SEPARATOR)
  if (!segments.every(segment => DISCOVERY_ERROR_PREFIXES.some(prefix => segment.startsWith(prefix)))) {
    return { kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' }
  }
  if (segments.some(segment => segment.startsWith(TYPE_ERROR_PREFIX[type]))) {
    return { kind: 'error', reason: `${TYPE_LABEL[type]} discovery failed in the latest discovery run` }
  }
  return { kind: 'usable', run }
}

// ── Alarm matching ───────────────────────

/**
 * The CloudWatch namespace and dimension an alarm must carry to be matched
 * to a discovered resource_id. EC2 reuses resourceTypeRegistry. The
 * registry's RDS capability has no dimension yet (RDS metrics are not wired
 * there), so RDS names AWS/RDS DBInstanceIdentifier here -- the same value
 * discovery stores as resource_id (discoverRDSDatabases()).
 */
function alarmTarget(type: CoverageResourceType): { namespace: string; dimensionKey: string } {
  if (type === 'ec2') {
    const { cloudwatchNamespace, dimensionKey } = resourceTypeRegistry.ec2
    if (!cloudwatchNamespace || !dimensionKey) {
      throw new Error('resourceTypeRegistry.ec2 has no CloudWatch dimension')
    }
    return { namespace: cloudwatchNamespace, dimensionKey }
  }
  return { namespace: 'AWS/RDS', dimensionKey: 'DBInstanceIdentifier' }
}

export type AlarmDisqualifier =
  | 'insufficient_data'
  | 'no_actions'
  | 'data_unverified'

/**
 * Why a matched alarm does not count as coverage. Empty = it counts.
 *   insufficient_data = StateValue is not OK or ALARM
 *   no_actions        = ActionsEnabled is off or AlarmActions is empty
 *   data_unverified   = TreatMissingData notBreaching/ignore: silence reads
 *                       as healthy, so the alarm can't show the metric exists
 */
export function alarmDisqualifiers(alarm: MetricAlarm): AlarmDisqualifier[] {
  const reasons: AlarmDisqualifier[] = []
  if (alarm.StateValue !== 'OK' && alarm.StateValue !== 'ALARM') reasons.push('insufficient_data')
  if (alarm.ActionsEnabled !== true || (alarm.AlarmActions ?? []).length === 0) reasons.push('no_actions')
  if (alarm.TreatMissingData === 'notBreaching' || alarm.TreatMissingData === 'ignore') reasons.push('data_unverified')
  return reasons
}

export type UnsupportedAlarmReason =
  | 'metric_math'
  | 'dimensionless'
  | 'unmapped'

type AlarmClassification =
  | { kind: 'targets'; type: CoverageResourceType; values: string[] }
  | { kind: 'unsupported'; reason: UnsupportedAlarmReason }

/** What an alarm targets, from its namespace and exact dimensions only -- never its name or Dimensions[0]. */
export function classifyAlarm(alarm: MetricAlarm): AlarmClassification {
  if ((alarm.Metrics ?? []).length > 0) return { kind: 'unsupported', reason: 'metric_math' }
  const dimensions = alarm.Dimensions ?? []
  if (dimensions.length === 0) return { kind: 'unsupported', reason: 'dimensionless' }
  for (const type of ['ec2', 'rds'] as const) {
    const { namespace, dimensionKey } = alarmTarget(type)
    if (alarm.Namespace !== namespace) continue
    const values = dimensions
      .filter(d => d.Name === dimensionKey && typeof d.Value === 'string' && d.Value !== '')
      .map(d => d.Value as string)
    if (values.length > 0) return { kind: 'targets', type, values }
  }
  return { kind: 'unsupported', reason: 'unmapped' }
}

/** Every metric alarm in the client's account and region. Throws on any failed page. */
export async function describeAllMetricAlarms(client: CloudWatchClient): Promise<MetricAlarm[]> {
  const alarms: MetricAlarm[] = []
  const seenTokens = new Set<string>()
  let nextToken: string | undefined
  do {
    const page = await client.send(
      new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm'], MaxRecords: 100, NextToken: nextToken })
    )
    alarms.push(...(page.MetricAlarms ?? []))
    nextToken = page.NextToken || undefined
    if (nextToken) {
      if (seenTokens.has(nextToken)) throw new Error('DescribeAlarms returned a repeated NextToken')
      seenTokens.add(nextToken)
    }
  } while (nextToken)
  return alarms
}

// ── Types ────────────────────────────────

export interface MatchedAlarm {
  alarmName: string
  alarmArn: string | null
  stateValue: string | null
  /** Empty when this alarm counts as coverage. */
  disqualifiedBy: AlarmDisqualifier[]
}

export interface ResourceAlertCoverage {
  resourceId: string
  status: string
  covered: boolean
  alarms: MatchedAlarm[]
}

export interface TypeAlertCoverage {
  resourceType: CoverageResourceType
  /** False when the gated run found no in-scope resources of this type: no score, excluded from weighting. */
  applicable: boolean
  inScope: number
  covered: number
  /** covered / inScope as a whole percent; null when not applicable. */
  coveragePercent: number | null
  /** In-scope resources by inventory status -- all of them are in the denominator. */
  statusCounts: Record<string, number>
  /** Non-terminated rows left out of the denominator, and why. */
  excluded: { notSeenByGatedRun: number; otherRegion: number }
  /** Matched alarms that do not count as coverage, by reason (an alarm can have several). */
  nonQualifyingAlarms: Record<AlarmDisqualifier, number>
  resources: ResourceAlertCoverage[]
}

export interface OrphanedAlarm {
  alarmName: string
  resourceType: CoverageResourceType
  dimensionValues: string[]
  stateValue: string | null
}

export interface UnsupportedAlarm {
  alarmName: string
  reason: UnsupportedAlarmReason
}

export interface AlarmInventory {
  total: number
  /** Alarms matched to at least one in-scope resource. */
  matched: number
  /** EC2/RDS alarms with no in-scope inventory match (the target may be gone, stopped being discovered, or elsewhere). */
  orphaned: OrphanedAlarm[]
  unsupported: UnsupportedAlarm[]
  /** EC2/RDS alarms whose type has no usable inventory, so they could not be matched or called orphaned. */
  unevaluated: number
}

export interface ReadinessGap {
  type: string
  severity: 'high' | 'medium' | 'low'
  message: string
  action: string
  actionPath: string
}

export interface DiscoveryRunSummary {
  id: string
  status: 'completed' | 'failed'
  startedAt: string
  completedAt: string
}

export interface ReadinessResult {
  /** true = an account row exists; null = the account lookup itself failed. */
  connected: true | null
  /** partial when scored (alert coverage only); error/unavailable otherwise. Never 'available'. */
  state: ContextDataState
  reason: string | null
  /** EC2/RDS alert coverage percent; null whenever nothing was measured. Never 0 from a failure. */
  readiness_score: number | null
  status: 'Ready' | 'Partially Ready' | 'At Risk' | null
  discovery_run: DiscoveryRunSummary | null
  scope: InventoryScope | null
  components: {
    alert_coverage: {
      ec2: ContextSection<TypeAlertCoverage>
      rds: ContextSection<TypeAlertCoverage>
      alb: ContextSection<never>
      lambda: ContextSection<never>
    }
    monitoring_coverage: ContextSection<never>
    signal_freshness: ContextSection<never>
    response_config: ContextSection<never>
  }
  alarms: ContextSection<AlarmInventory>
  top_gaps: ReadinessGap[]
  computed_at: string
}

// ── Helpers ──────────────────────────────

const COVERAGE_TYPES: CoverageResourceType[] = ['ec2', 'rds']

const NOT_SUPPORTED_COMPONENTS =
  'monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage'

/** A section whose collection failed for a known, customer-safe reason. */
function failedSection<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return {
    state: 'error',
    source: meta.source,
    provenance: null,
    asOf: null,
    scope: meta.scope ?? null,
    period: meta.period ?? null,
    completeness: null,
    coverage: null,
    reason,
    derivedFrom: null,
    data: null,
  }
}

function unavailableSection<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return { ...failedSection<T>(meta, reason), state: 'unavailable' }
}

function coverageSource(type: CoverageResourceType): string {
  return `CloudWatch metric alarms matched to DevControl ${TYPE_LABEL[type]} inventory`
}

/** Every readiness component other than EC2/RDS alert coverage has no source yet. */
function unsupportedComponents(
  scope: InventoryScope | null,
  coverage: Record<CoverageResourceType, ContextSection<TypeAlertCoverage>>
): ReadinessResult['components'] {
  const meta = (source: string): SectionMeta => ({ source, scope })
  return {
    alert_coverage: {
      ec2: coverage.ec2,
      rds: coverage.rds,
      alb: notSupported(meta('ALB alert coverage'), 'discovery failures for this type are not recorded'),
      lambda: notSupported(meta('Lambda alert coverage'), 'discovery failures for this type are not recorded'),
    },
    monitoring_coverage: notSupported(meta('Monitoring coverage'), 'DevControl does not yet check whether each discovered resource is reporting metrics'),
    signal_freshness: notSupported(meta('Signal freshness'), 'DevControl does not yet measure per-resource metric freshness'),
    response_config: notSupported(meta('Response setup'), 'DevControl does not yet record alert destinations or on-call routing'),
  }
}

function scoreStatus(score: number): 'Ready' | 'Partially Ready' | 'At Risk' {
  return score >= 85 ? 'Ready' : score >= 65 ? 'Partially Ready' : 'At Risk'
}

interface InventoryRow {
  resource_id: string
  resource_type: CoverageResourceType
  region: string | null
  status: string
  last_synced_at: Date | string | null
}

// ── Service ──────────────────────────────

export class ObservabilityReadinessService {

  /** Same row AWSClientFactory.createClients() assumes a role from. */
  private async getAccount(organizationId: string): Promise<{ account_id: string | null } | null> {
    const result = await pool.query(
      `SELECT account_id FROM aws_accounts WHERE org_id = $1 LIMIT 1`,
      [organizationId]
    )
    return result.rows[0] ?? null
  }

  /** Latest finished discovery run -- never a 'running' one. */
  private async getGatedRun(organizationId: string): Promise<GatedDiscoveryRun | null> {
    const result = await pool.query(
      `SELECT id, status, started_at, completed_at, resource_types, error_message
       FROM resource_discovery_jobs
       WHERE organization_id = $1
         AND status IN ('completed', 'failed')
         AND completed_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [organizationId]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: new Date(row.completed_at),
      resourceTypes: row.resource_types ?? null,
      errorMessage: row.error_message ?? null,
    }
  }

  /** Org-scoped, non-terminated EC2/RDS inventory; region and re-seen filtering happen in buildTypeCoverage. */
  private async getInventory(organizationId: string): Promise<InventoryRow[]> {
    const result = await pool.query(
      `SELECT resource_id, resource_type, region, status, last_synced_at
       FROM aws_resources
       WHERE organization_id = $1
         AND resource_type IN ('ec2', 'rds')
         AND status != 'terminated'`,
      [organizationId]
    )
    return result.rows
  }

  async getReadiness(organizationId: string): Promise<ReadinessResult | null> {
    let account: { account_id: string | null } | null
    try {
      account = await this.getAccount(organizationId)
    } catch (err) {
      console.error('[Readiness] account lookup failed:', err instanceof Error ? err.message : err)
      return this.failedResult(null, null, 'the connected AWS account record could not be read')
    }
    if (!account) return null

    let clients: Awaited<ReturnType<typeof AWSClientFactory.createClients>>
    try {
      clients = await AWSClientFactory.createClients(organizationId)
      if (!clients.enabled) throw new Error('AWS clients are not enabled')
    } catch (err) {
      console.error('[Readiness] AWS credentials failed:', err instanceof Error ? err.message : err)
      return this.failedResult(true, null, 'the connected AWS role could not be assumed')
    }

    const scope: InventoryScope = {
      kind: 'resource_inventory',
      connectedAccountId: account.account_id ?? null,
      discoveryRegion: clients.region,
    }

    let run: GatedDiscoveryRun | null
    let inventory: InventoryRow[]
    try {
      ;[run, inventory] = await Promise.all([
        this.getGatedRun(organizationId),
        this.getInventory(organizationId),
      ])
    } catch (err) {
      console.error('[Readiness] inventory lookup failed:', err instanceof Error ? err.message : err)
      return this.failedResult(true, scope, 'the DevControl resource inventory could not be read')
    }

    const gates = {
      ec2: evaluateDiscoveryGate(run, 'ec2'),
      rds: evaluateDiscoveryGate(run, 'rds'),
    }

    // Read alarms only when some type has a usable gate: a failure then is
    // this evaluation's failure, not a guess about a type with no inventory.
    let alarms: MetricAlarm[] | null = null
    let alarmsError = false
    if (COVERAGE_TYPES.some(t => gates[t].kind === 'usable')) {
      try {
        alarms = await describeAllMetricAlarms(clients.cloudWatch)
      } catch (err) {
        console.error('[Readiness] DescribeAlarms failed:', err instanceof Error ? err.message : err)
        alarmsError = true
      }
    }

    return this.buildResult({ run, gates, inventory, alarms, alarmsError, region: clients.region, scope })
  }

  /** Pure assembly from already-fetched evidence. */
  private async buildResult(input: {
    run: GatedDiscoveryRun | null
    gates: Record<CoverageResourceType, DiscoveryGate>
    inventory: InventoryRow[]
    alarms: MetricAlarm[] | null
    alarmsError: boolean
    region: string
    scope: InventoryScope
  }): Promise<ReadinessResult> {
    const { run, gates, inventory, alarms, alarmsError, region, scope } = input
    const asOf = run ? run.completedAt.toISOString() : null
    const classified = (alarms ?? []).map(alarm => ({ alarm, target: classifyAlarm(alarm) }))

    const sections = {} as Record<CoverageResourceType, ContextSection<TypeAlertCoverage>>
    const inScopeIds = {} as Record<CoverageResourceType, Set<string> | null>

    for (const type of COVERAGE_TYPES) {
      const meta: SectionMeta = {
        source: coverageSource(type),
        provenance: 'derived',
        scope,
        period: { kind: 'point_in_time' },
      }
      const gate = gates[type]
      inScopeIds[type] = null

      if (gate.kind === 'tier_excluded') {
        sections[type] = notSupported(meta, `${TYPE_LABEL[type]} is not included in this organization's discovery plan`)
        continue
      }
      if (gate.kind === 'error') {
        sections[type] = failedSection(meta, gate.reason)
        continue
      }
      if (gate.kind === 'unavailable') {
        sections[type] = unavailableSection(meta, gate.reason)
        continue
      }

      const rows = inventory.filter(r => r.resource_type === type)
      const startedAt = gate.run.startedAt.getTime()
      const reseen = (r: InventoryRow) => r.last_synced_at !== null && new Date(r.last_synced_at).getTime() >= startedAt
      const inScope = rows.filter(r => r.region === region && reseen(r))
      const excluded = {
        otherRegion: rows.filter(r => r.region !== region).length,
        notSeenByGatedRun: rows.filter(r => r.region === region && !reseen(r)).length,
      }
      inScopeIds[type] = new Set(inScope.map(r => r.resource_id))

      if (inScope.length > 0 && alarmsError) {
        sections[type] = failedSection(meta, 'CloudWatch alarms could not be read')
        continue
      }

      sections[type] = await collectSection<TypeAlertCoverage>(meta, async () => {
        const nonQualifyingAlarms: Record<AlarmDisqualifier, number> = { insufficient_data: 0, no_actions: 0, data_unverified: 0 }
        const statusCounts: Record<string, number> = {}
        const resources: ResourceAlertCoverage[] = inScope.map(row => {
          statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
          const matched: MatchedAlarm[] = classified
            .filter(c => c.target.kind === 'targets' && c.target.type === type && c.target.values.includes(row.resource_id))
            .map(({ alarm }) => ({
              alarmName: alarm.AlarmName ?? '',
              alarmArn: alarm.AlarmArn ?? null,
              stateValue: alarm.StateValue ?? null,
              disqualifiedBy: alarmDisqualifiers(alarm),
            }))
          for (const m of matched) for (const d of m.disqualifiedBy) nonQualifyingAlarms[d]++
          return {
            resourceId: row.resource_id,
            status: row.status,
            covered: matched.some(m => m.disqualifiedBy.length === 0),
            alarms: matched,
          }
        })
        const covered = resources.filter(r => r.covered).length
        const applicable = inScope.length > 0
        const nonRunning = inScope.filter(r => r.status !== 'running' && r.status !== 'available').length
        return {
          state: 'available',
          asOf,
          // Every in-scope resource was evaluated against the full alarm list.
          completeness: { unit: 'resource', expected: inScope.length, received: inScope.length, missing: [] },
          coverage: applicable
            ? `${inScope.length} ${TYPE_LABEL[type]} resource${inScope.length !== 1 ? 's' : ''} in ${region} seen by the latest finished discovery run` +
              (nonRunning > 0 ? `, including ${nonRunning} not in a running/available state` : '')
            : `no ${TYPE_LABEL[type]} resources in ${region} were seen by the latest finished discovery run`,
          reason: applicable ? null : `no ${TYPE_LABEL[type]} resources in scope, so ${TYPE_LABEL[type]} alert coverage is not applicable`,
          data: {
            resourceType: type,
            applicable,
            inScope: inScope.length,
            covered,
            coveragePercent: applicable ? Math.round((covered / inScope.length) * 100) : null,
            statusCounts,
            excluded,
            nonQualifyingAlarms,
            resources,
          },
        }
      })
    }

    const alarmSection = this.buildAlarmSection(classified, inScopeIds, alarms, alarmsError, gates, scope, asOf)
    const components = unsupportedComponents(scope, sections)

    const { state, reason, score } = this.combine(sections)
    return {
      connected: true,
      state,
      reason,
      readiness_score: score,
      status: score === null ? null : scoreStatus(score),
      discovery_run: run
        ? { id: run.id, status: run.status, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt.toISOString() }
        : null,
      scope,
      components,
      alarms: alarmSection,
      top_gaps: this.buildGaps(sections, alarmSection),
      computed_at: new Date().toISOString(),
    }
  }

  private buildAlarmSection(
    classified: Array<{ alarm: MetricAlarm; target: AlarmClassification }>,
    inScopeIds: Record<CoverageResourceType, Set<string> | null>,
    alarms: MetricAlarm[] | null,
    alarmsError: boolean,
    gates: Record<CoverageResourceType, DiscoveryGate>,
    scope: InventoryScope,
    asOf: string | null
  ): ContextSection<AlarmInventory> {
    const meta: SectionMeta = { source: 'CloudWatch metric alarms', provenance: 'actual', scope, period: { kind: 'point_in_time' } }
    if (alarmsError) return failedSection(meta, 'CloudWatch alarms could not be read')
    if (alarms === null) {
      const blocked = COVERAGE_TYPES.map(t => gates[t]).find(g => g.kind === 'error' || g.kind === 'unavailable')
      return unavailableSection(meta, blocked && 'reason' in blocked
        ? `alarms were not read: ${blocked.reason}`
        : 'alarms were not read: neither EC2 nor RDS is in this organization\'s discovery plan')
    }

    const orphaned: OrphanedAlarm[] = []
    const unsupported: UnsupportedAlarm[] = []
    let matched = 0
    let unevaluated = 0
    for (const { alarm, target } of classified) {
      if (target.kind === 'unsupported') {
        unsupported.push({ alarmName: alarm.AlarmName ?? '', reason: target.reason })
        continue
      }
      const ids = inScopeIds[target.type]
      if (ids === null) {
        unevaluated++
      } else if (target.values.some(v => ids.has(v))) {
        matched++
      } else {
        orphaned.push({
          alarmName: alarm.AlarmName ?? '',
          resourceType: target.type,
          dimensionValues: target.values,
          stateValue: alarm.StateValue ?? null,
        })
      }
    }
    return {
      state: unevaluated > 0 ? 'partial' : 'available',
      source: meta.source,
      provenance: 'actual',
      asOf: new Date().toISOString(),
      scope,
      period: { kind: 'point_in_time' },
      completeness: null,
      coverage: `metric alarms in ${scope.discoveryRegion}; composite alarms are not read`,
      reason: unevaluated > 0
        ? `${unevaluated} EC2/RDS alarm${unevaluated !== 1 ? 's' : ''} could not be matched because that type's inventory is not usable`
        : null,
      derivedFrom: null,
      data: { total: alarms.length, matched, orphaned, unsupported, unevaluated },
    }
  }

  /**
   * Readiness is EC2/RDS alert coverage, labeled partial because every other
   * component is not supported. Any evaluated type in error/unavailable makes
   * the whole score null with that state; so does having nothing in scope.
   */
  private combine(sections: Record<CoverageResourceType, ContextSection<TypeAlertCoverage>>): {
    state: ContextDataState; reason: string | null; score: number | null
  } {
    const evaluated = COVERAGE_TYPES.map(t => sections[t]).filter(s => s.state !== 'not_supported')
    const failed = evaluated.find(s => s.state === 'error')
    if (failed) return { state: 'error', reason: failed.reason, score: null }
    const missing = evaluated.find(s => s.state === 'unavailable' || s.data === null)
    if (missing) return { state: 'unavailable', reason: missing.reason, score: null }

    const applicable = evaluated.filter(s => s.data?.applicable)
    if (applicable.length === 0) {
      return {
        state: 'unavailable',
        reason: evaluated.length === 0
          ? 'neither EC2 nor RDS is included in this organization\'s discovery plan'
          : 'no EC2 or RDS resources are in scope, so alert coverage is not applicable',
        score: null,
      }
    }
    const inScope = applicable.reduce((n, s) => n + (s.data?.inScope ?? 0), 0)
    const covered = applicable.reduce((n, s) => n + (s.data?.covered ?? 0), 0)
    const types = applicable.map(s => TYPE_LABEL[s.data!.resourceType]).join(' and ')
    return {
      state: 'partial',
      reason: `Measures ${types} alert coverage only (${covered} of ${inScope} in-scope resources covered); ${NOT_SUPPORTED_COMPONENTS} are not supported yet.`,
      score: Math.round((covered / inScope) * 100),
    }
  }

  private buildGaps(
    sections: Record<CoverageResourceType, ContextSection<TypeAlertCoverage>>,
    alarmSection: ContextSection<AlarmInventory>
  ): ReadinessGap[] {
    const gaps: ReadinessGap[] = []
    for (const type of COVERAGE_TYPES) {
      const data = sections[type].data
      if (!data?.applicable) continue
      const uncovered = data.inScope - data.covered
      if (uncovered === 0) continue
      gaps.push({
        type: `alert_coverage_${type}`,
        severity: data.covered === 0 ? 'high' : 'medium',
        message: `${uncovered} of ${data.inScope} in-scope ${TYPE_LABEL[type]} resource${data.inScope !== 1 ? 's have' : ' has'} no enabled alarm with actions`,
        action: 'Configure alerts',
        actionPath: '/observability/alerts',
      })
    }
    const orphaned = alarmSection.data?.orphaned.length ?? 0
    if (orphaned > 0) {
      gaps.push({
        type: 'orphaned_alarms',
        severity: 'medium',
        message: `${orphaned} EC2/RDS alarm${orphaned !== 1 ? 's match' : ' matches'} no resource seen by the latest discovery run`,
        action: 'Review alarms',
        actionPath: '/observability/alerts',
      })
    }
    return gaps.slice(0, 3)
  }

  private failedResult(connected: true | null, scope: InventoryScope | null, reason: string): ReadinessResult {
    const failed = <T>(source: string) => failedSection<T>({ source, scope }, reason)
    return {
      connected,
      state: 'error',
      reason,
      readiness_score: null,
      status: null,
      discovery_run: null,
      scope,
      components: unsupportedComponents(scope, {
        ec2: failed(coverageSource('ec2')),
        rds: failed(coverageSource('rds')),
      }),
      alarms: failed('CloudWatch metric alarms'),
      top_gaps: [],
      computed_at: new Date().toISOString(),
    }
  }
}
