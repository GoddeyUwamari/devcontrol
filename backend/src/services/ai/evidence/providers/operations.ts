/**
 * Operations evidence: CloudWatch alarms -- the alerts source (S13, A-D10);
 * Operational Health resource checks (S16); CPU telemetry (S14, S15); and the
 * System Intelligence composite score (S19).
 *
 * No provider here starts an AWS sweep. Alarms are read through
 * CloudWatchAlarmsService (the Operational Health page's own read: one
 * account, its home region, a 60-second cache keyed by organization and
 * connection). Resource checks and CPU values are read from the evaluator's
 * cached result only (peekCachedMetrics, as Services Intelligence does).
 * Alarm names and the resources they watch are untrusted text.
 */
import { collectSection, errorSection, notConnected, type ContextSection, type EvidenceFailureCode } from '../../../ai-context-contract';
import { cloudWatchAlarmsService, type AlarmsResult } from '../../../cloudwatch-alarms.service';
import { cloudWatchService, type CloudWatchMetrics } from '../../../cloudwatch.service';
import { RESOURCE_HEALTH_MAX_AGE_MS, resourceHealthFrom, countByState, type ResourceHealthState } from '../../../resource-health';
import systemIntelligenceService from '../../../system-intelligence.service';
import { lifecycleStateFor } from '../../../../utils/resourceLifecycle';
import { pool } from '../../../../config/database';
import type { ContextDataState } from '../../../ai-context-contract';
import { defineProvider, iso, ref, summarizeItems, untrustedFor, withOrgClient } from './shared';

/** Replaceable in tests: the two reads the operations providers make. */
export const operationsSources = {
  alarms: (organizationId: string): Promise<AlarmsResult> => cloudWatchAlarmsService.getAlarms(organizationId),
  peekEvaluation: (organizationId: string): { data: CloudWatchMetrics | null; cachedAt: number } | null =>
    cloudWatchService.peekCachedMetrics(organizationId, RESOURCE_HEALTH_MAX_AGE_MS),
};

export interface AlarmsEvidence {
  outcome: 'found' | 'none_found';
  inAlarmCount: number;
  /** false: more alarms are in ALARM than were read (the count is a lower bound). */
  inAlarmComplete: boolean;
  configuredCount: number;
  /** false: the configured count is a lower bound ("at least N"). */
  configuredCountComplete: boolean;
  items: Array<{
    ref: string;
    type: 'metric' | 'composite';
    namespace: string | null;
    metric: string | null;
    comparison: string | null;
    threshold: number | null;
    inAlarmSince: string | null;
    resourceType: string | null;
  }>;
}

const ALARMS_SOURCE = 'Amazon CloudWatch alarms';

const ALARM_FAILURES: Record<string, EvidenceFailureCode> = {
  access_denied: 'aws_denied',
  throttled: 'aws_throttled',
  failed: 'internal',
};

export const cloudWatchAlarmsProvider = defineProvider<AlarmsEvidence>({
  id: 'ops.cloudwatch_alarms',
  version: 1,
  title: 'CloudWatch alarms (current state)',
  source: ALARMS_SOURCE,
  dataSourceIds: ['S13'],
  topics: ['ops', 'telemetry'],
  priority: 1,
  maxTokens: 2000,
  freshness: { maxAgeSeconds: 300, rule: 'five minutes (alarms are read live and cached for up to 60 seconds)' },
  fingerprint: 'state_and_data',
  async collect({ organizationId, basis }) {
    const account = await basis.account();
    const result = await operationsSources.alarms(organizationId);
    const meta = {
      source: ALARMS_SOURCE,
      classification: 'measured' as const,
      scope: { kind: 'aws_account_region' as const, connectedAccountId: account.data?.accountId ?? null, region: result.region },
      period: { kind: 'point_in_time' as const },
      coverage: "alarms in the connected account's home region, as CloudWatch reports them now: the alarms currently in ALARM and how many are configured. Not a history of past alerts",
    };
    if (result.status === 'error') {
      if (result.reason === 'not_connected') return notConnected<AlarmsEvidence>(meta, 'no AWS account is connected');
      if (result.reason === 'multiple_accounts') {
        return collectSection<AlarmsEvidence>(meta, async () => ({ state: 'unavailable', reason: 'more than one AWS account is connected; DevControl reads one account per organization' }));
      }
      // The service has already logged its own error name; nothing raw is kept here.
      const section = errorSection<AlarmsEvidence>(meta, new Error(`CloudWatch alarms read failed (${result.reason})`));
      return { ...section, failure: { code: ALARM_FAILURES[result.reason] ?? 'internal', retryable: result.reason !== 'access_denied' } };
    }
    const items = result.in_alarm.map((a, i) => ({
      ref: ref('a', i),
      type: a.type,
      namespace: a.namespace,
      metric: a.metric,
      comparison: a.comparison,
      threshold: a.threshold,
      inAlarmSince: a.state_since,
      resourceType: a.resource?.type ?? null,
    }));
    return collectSection<AlarmsEvidence>(meta, async () => ({
      state: result.truncated ? 'partial' : 'available',
      reason: result.truncated ? 'CloudWatch returned more alarms than DevControl reads at once, so the counts are lower bounds' : null,
      asOf: result.checked_at,
      data: {
        outcome: items.length > 0 ? 'found' : 'none_found',
        inAlarmCount: items.length,
        inAlarmComplete: result.in_alarm_complete,
        configuredCount: result.configured_count,
        configuredCountComplete: result.configured_count_complete,
        items,
      },
      untrusted: result.in_alarm.flatMap((a, i) => [
        ...untrustedFor(ref('a', i), 'alarm name', a.name),
        ...untrustedFor(ref('a', i), 'resource', a.resource?.id),
      ]),
    }));
  },
  summarize: summarizeItems,
});

interface InventoryRow {
  id: string;
  resource_type: string;
  status: string | null;
  metadata_type: string | null;
  resource_id: string;
  resource_name: string | null;
}

/** The organization's current, non-terminated inventory rows the evaluator can match. */
async function currentInventoryRows(organizationId: string): Promise<InventoryRow[]> {
  const { rows } = await pool.query<InventoryRow>(
    `SELECT id::text AS id, resource_type, status, metadata->>'type' AS metadata_type, resource_id, resource_name
       FROM aws_resources
      WHERE organization_id = $1 AND status != 'terminated'`,
    [organizationId]
  );
  return rows;
}

export interface ResourceHealthEvidence {
  /** Every current resource, by Operational Health state. */
  counts: Record<ResourceHealthState, number>;
  /** Failing checks first, then no-signal resources. */
  items: Array<{ ref: string; resourceId: string; resourceType: string; state: ResourceHealthState; reason: string | null }>;
}

const HEALTH_SOURCE = 'DevControl Operational Health resource checks (CloudWatch, last hour)';

export const resourceHealthProvider = defineProvider<ResourceHealthEvidence>({
  id: 'ops.resource_health',
  version: 1,
  title: 'Operational Health resource checks',
  source: HEALTH_SOURCE,
  dataSourceIds: ['S16'],
  topics: ['ops', 'telemetry'],
  priority: 2,
  maxTokens: 2000,
  freshness: { maxAgeSeconds: RESOURCE_HEALTH_MAX_AGE_MS / 1000, rule: '15 minutes since the checks ran' },
  async collect({ organizationId, basis }) {
    const account = await basis.account();
    const peek = operationsSources.peekEvaluation(organizationId);
    const evaluation = peek?.data ?? null;
    const meta = {
      source: HEALTH_SOURCE,
      classification: 'measured' as const,
      scope: { kind: 'aws_account_region' as const, connectedAccountId: account.data?.accountId ?? null, region: evaluation?.region ?? null },
      period: { kind: 'rolling' as const, window: 'last hour' },
      coverage: "the checks DevControl runs on each resource type in the connected account's home region; checks_passing means no check failed, not that the service is healthy end to end",
    };
    if (account.state === 'unavailable') return notConnected<ResourceHealthEvidence>(meta, 'no AWS account is connected');
    return collectSection<ResourceHealthEvidence>(meta, async () => {
      if (!evaluation) {
        return {
          state: 'unavailable',
          reason: 'no Operational Health check has run in the last 15 minutes (the checks run when Operational Health or the Dashboard is open); DevControl does not start one for an answer',
        };
      }
      const rows = await currentInventoryRows(organizationId);
      const byDbId = new Map(evaluation.services.map((s) => [s.resourceDbId, s]));
      const evaluated = rows.map((row) => {
        const health = resourceHealthFrom(
          { type: row.resource_type, lifecycleState: lifecycleStateFor(row.resource_type, row.status), metadataType: row.metadata_type },
          evaluation,
          byDbId.get(row.id)
        );
        return { row, health };
      });
      const counts = countByState(evaluated.map((e) => e.health.state));
      const order: Record<ResourceHealthState, number> = { check_failing: 0, no_signal: 1, checks_passing: 2, not_supported: 3 };
      const listed = evaluated
        .filter((e) => e.health.state === 'check_failing' || e.health.state === 'no_signal')
        .sort((a, b) => order[a.health.state] - order[b.health.state] || (a.row.id < b.row.id ? -1 : 1));
      const items = listed.map((e, i) => ({
        ref: ref('o', i),
        resourceId: e.row.resource_id,
        resourceType: e.row.resource_type,
        state: e.health.state,
        reason: e.health.reasons[0]?.kind ?? null,
      }));
      return {
        state: 'available',
        asOf: evaluation.capturedAt,
        data: { counts, items },
        untrusted: listed.flatMap((e, i) => untrustedFor(ref('o', i), 'name', e.row.resource_name)),
      };
    });
  },
  summarize: summarizeItems,
});

export interface CpuTelemetryEvidence {
  /** EC2 CPU from the latest Operational Health check (CloudWatch CPUUtilization, last hour); null when none is cached. */
  latestCheck: { observedAt: string; instances: number } | null;
  /** The 7-day CPU evidence behind each active idle-instance cost finding. */
  idleInstanceEvidence: number;
  /** What DevControl stored about telemetry collection; null when nothing is stored. */
  collection: { resourcesTracked: number; resourcesWithDatapoints: number; newestDatapointAt: string | null; lastFullCollectionAt: string | null } | null;
  items: Array<{
    ref: string;
    instanceId: string;
    basis: 'latest_check_last_hour' | 'idle_finding_7_day_average';
    cpuPercent: number;
    observedAt: string | null;
    datapointsObserved: number | null;
    datapointsExpected: number | null;
  }>;
}

const CPU_SOURCE = 'Amazon CloudWatch CPUUtilization, as DevControl recorded it';

export const cpuTelemetryProvider = defineProvider<CpuTelemetryEvidence>({
  id: 'telemetry.cpu',
  version: 1,
  title: 'EC2 CPU utilization (CloudWatch)',
  source: CPU_SOURCE,
  dataSourceIds: ['S14', 'S15'],
  topics: ['telemetry', 'savings', 'ops'],
  priority: 2,
  maxTokens: 2000,
  async collect({ organizationId, basis }) {
    const account = await basis.account();
    const meta = {
      source: CPU_SOURCE,
      classification: 'measured' as const,
      scope: { kind: 'aws_account_region' as const, connectedAccountId: account.data?.accountId ?? null, region: account.data?.region ?? null },
      coverage: "EC2 instances in the connected account's home region: the last hour's average from the latest Operational Health check when one is cached, and the 7-day hourly average behind each idle-instance finding. Memory is not collected",
    };
    if (account.state === 'unavailable') return notConnected<CpuTelemetryEvidence>(meta, 'no AWS account is connected');
    return collectSection<CpuTelemetryEvidence>(meta, async () => {
      const evaluation = operationsSources.peekEvaluation(organizationId)?.data ?? null;
      const latest = (evaluation?.services ?? [])
        .filter((s) => s.resourceType === 'ec2')
        .flatMap((s) => {
          const cpu = s.metrics?.find((m) => m.label === 'CPU');
          return cpu ? [{ instanceId: s.resourceId, cpuPercent: cpu.value }] : [];
        });
      const idle = (await basis.activeCostRecommendations())
        .filter((r) => r.metadata && typeof (r.metadata as any).average_cpu === 'number')
        .map((r) => {
          const m = r.metadata as Record<string, any>;
          return {
            instanceId: String(r.resource_id),
            cpuPercent: Math.round(Number(m.average_cpu) * 100) / 100,
            observedAt: typeof m.cpu_evidence?.window_end === 'string' ? m.cpu_evidence.window_end : null,
            datapointsObserved: typeof m.cpu_evidence?.datapoints_observed === 'number' ? m.cpu_evidence.datapoints_observed : null,
            datapointsExpected: typeof m.cpu_evidence?.datapoints_expected === 'number' ? m.cpu_evidence.datapoints_expected : null,
          };
        });
      const collection = await withOrgClient(organizationId, async (client) => {
        const obs = await client.query(
          `SELECT COUNT(*)::int AS tracked, COUNT(last_datapoint_at)::int AS with_datapoints, MAX(last_datapoint_at) AS newest
             FROM resource_telemetry_observations WHERE organization_id = $1`,
          [organizationId]
        );
        const scopes = await client.query(
          `SELECT MAX(last_full_success_at) AS last_full FROM observability_collection_scopes WHERE organization_id = $1`,
          [organizationId]
        );
        const o = obs.rows[0];
        return o.tracked > 0
          ? { resourcesTracked: o.tracked, resourcesWithDatapoints: o.with_datapoints, newestDatapointAt: iso(o.newest), lastFullCollectionAt: iso(scopes.rows[0]?.last_full) }
          : null;
      });

      if (latest.length === 0 && idle.length === 0 && collection === null) {
        return { state: 'unavailable', reason: 'no EC2 CPU telemetry has been recorded yet (Operational Health has not checked recently, and no idle-instance finding carries CPU evidence)' };
      }
      const items: CpuTelemetryEvidence['items'] = [
        ...latest.map((l) => ({ instanceId: l.instanceId, basis: 'latest_check_last_hour' as const, cpuPercent: l.cpuPercent, observedAt: evaluation?.capturedAt ?? null, datapointsObserved: null, datapointsExpected: null })),
        ...idle.map((d) => ({ ...d, basis: 'idle_finding_7_day_average' as const })),
      ].map((item, i) => ({ ref: ref('u', i), ...item }));
      const asOf = [evaluation?.capturedAt ?? null, collection?.newestDatapointAt ?? null, ...idle.map((d) => d.observedAt)]
        .filter((t): t is string => typeof t === 'string')
        .sort()
        .pop() ?? null;
      return {
        state: latest.length === 0 ? 'partial' : 'available',
        reason: latest.length === 0 ? 'no Operational Health check is cached from the last 15 minutes, so only the idle-finding CPU evidence and stored collection times are shown' : null,
        asOf,
        data: {
          latestCheck: evaluation && latest.length > 0 ? { observedAt: evaluation.capturedAt, instances: latest.length } : null,
          idleInstanceEvidence: idle.length,
          collection,
          items,
        },
      };
    });
  },
  summarize: summarizeItems,
});

export interface SystemIntelligenceEvidence {
  score: number;
  cost: number | null;
  security: number | null;
  observability: number | null;
  observabilityState: ContextDataState;
}

export const systemIntelligenceProvider = defineProvider<SystemIntelligenceEvidence>({
  id: 'system.intelligence',
  version: 1,
  title: 'System Intelligence score',
  source: 'DevControl System Intelligence score',
  dataSourceIds: ['S19'],
  topics: ['cost', 'security', 'ops'],
  priority: 2,
  maxTokens: 400,
  async collect({ organizationId }): Promise<ContextSection<SystemIntelligenceEvidence>> {
    return collectSection<SystemIntelligenceEvidence>(
      { source: 'DevControl System Intelligence score', classification: 'calculated', coverage: "composite of DevControl's cost, security, and observability component scores" },
      async () => {
        const intelligence = await systemIntelligenceService.getSystemIntelligence(organizationId);
        if (intelligence.system_score == null) return { state: 'unavailable', reason: 'the System Intelligence score is not ready yet' };
        const observability = intelligence.components.observability;
        const data = {
          score: intelligence.system_score,
          cost: intelligence.components.cost.score ?? null,
          security: intelligence.components.security.score ?? null,
          observability: observability.score ?? null,
          observabilityState: observability.state,
        };
        // A composite built on a partial component is itself partial.
        return intelligence.composite_state === 'partial'
          ? { state: 'partial', data, reason: intelligence.composite_reason }
          : { state: 'available', data };
      }
    );
  },
});
