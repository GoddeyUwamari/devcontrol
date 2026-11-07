/**
 * Per-provider behaviour (AI truth PR 2, step1 §4): available, the empty
 * outcome (a real "checked, none found"), unavailable / not_connected, error
 * with a safe code and no raw text, stale, and not_entitled with no collect
 * call. Every source is a fake: the shared pool refuses every query unless a
 * test answers it, the basis is scripted, CloudWatch is scripted.
 */
const mockDb: { answer?: (sql: string, params: unknown[]) => unknown } = {};
jest.mock('../../../../config/database', () => {
  const actual = jest.requireActual('../../../../config/database');
  const run = async (sql: string, params: unknown[] = []) => {
    if (/set_config/.test(sql)) return { rows: [] };
    const answer = mockDb.answer?.(sql, params);
    if (answer === undefined) throw Object.assign(new Error(`relation "secret_${String(sql).length}" does not exist`), { code: '42P01' });
    return answer;
  };
  return {
    ...actual,
    pool: {
      query: jest.fn(run),
      connect: jest.fn(async () => ({ query: jest.fn(run), release: jest.fn() })),
    },
  };
});

import { collectSection, type ContextSection } from '../../../ai-context-contract';
import { collectProvider } from '../registry';
import { createDefaultEvidenceRegistry } from '../providers';
import { createEvidenceBasis, type BasisSources } from '../basis';
import { operationsSources, cloudWatchAlarmsProvider, resourceHealthProvider, cpuTelemetryProvider } from '../providers/operations';
import { spendProvider, costFindingsProvider } from '../providers/cost';
import { connectionScopeProvider, regionCoverageProvider } from '../providers/scope';
import { accountFindingsProvider, topRiskProvider, riskScoreProvider, topRiskTitle, securityHubProvider, SECURITY_HUB_FIRST_SYNC_REASON, SECURITY_HUB_SYNC_RUNNING_REASON } from '../providers/security';
import { SecurityHubStateRepository } from '../../../../repositories/security-hub-state.repository';
import { anomaliesProvider, alertHistoryProvider } from '../providers/not-built';
import { AccountSecurityFindingsRepository } from '../../../../repositories/account-security-findings.repository';
import { RiskTrackingService } from '../../../risk-tracking.service';
import { AwsAccountAmbiguousError } from '../../../../repositories/aws-accounts.repository';
import systemIntelligenceService from '../../../system-intelligence.service';
import type { ProviderDefinition } from '../types';

const ORG = '00000000-0000-4000-8000-0000000000c3';
const NOW = new Date('2026-11-06T12:00:00.000Z');
const registry = createDefaultEvidenceRegistry();

const discoveryAvailable = () => collectSection({ source: 'DevControl resource discovery runs' }, async () => ({ state: 'available' as const, data: { completedAt: '2026-11-06T11:00:00.000Z' }, asOf: '2026-11-06T11:00:00.000Z' }));
const accountAvailable = () => collectSection({ source: 'DevControl connected AWS account record' }, async () => ({ state: 'available' as const, data: { accountId: '123456789012', region: 'us-east-1' } }));

function sources(overrides: Partial<Record<string, unknown>> = {}): BasisSources {
  const fail = async () => { throw Object.assign(new Error('relation "secret_basis" does not exist'), { code: '42P01' }); };
  const base = {
    context: {
      gatherInventoryBasis: async () => ({ discovery: await discoveryAvailable(), account: await accountAvailable(), inventoryScope: { kind: 'resource_inventory' as const, connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' } }),
      collectCosts: fail, getServices: fail, getResourceData: fail, getDORAMetrics: fail,
    },
    resources: { getStats: fail },
    accountFindings: { getActive: fail },
    costRecommendations: { findAll: fail },
    coverage: fail,
  };
  return { ...base, ...overrides } as unknown as BasisSources;
}

const ctx = (s: BasisSources = sources(), now = NOW) => ({ organizationId: ORG, now, period: { from: '2026-10-07', to: '2026-11-07' }, basis: createEvidenceBasis(ORG, s) });

beforeEach(() => {
  mockDb.answer = undefined;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(operationsSources, 'alarms').mockRejectedValue(new Error('secret alarm failure text'));
  jest.spyOn(operationsSources, 'peekEvaluation').mockReturnValue(null);
  jest.spyOn(systemIntelligenceService, 'getSystemIntelligence').mockRejectedValue(new Error('secret_si failure'));
});
afterEach(() => jest.restoreAllMocks());

describe('every provider', () => {
  it('a plan-gated provider below its plan is not_entitled and never collects; ungated providers are unaffected by the plan', async () => {
    for (const p of registry.list()) {
      const collect = jest.fn(p.collect);
      const section = await collectProvider({ ...p, collect } as ProviderDefinition, ctx(), async () => false);
      if (p.entitlementKey) {
        expect([p.id, section.state, collect.mock.calls.length]).toEqual([p.id, 'not_entitled', 0]);
      } else {
        expect([p.id, section.state === 'not_entitled', collect.mock.calls.length]).toEqual([p.id, false, 1]);
      }
    }
  });

  it('with every source failing: no data, a safe failure code, and none of the raw failure text', async () => {
    for (const p of registry.list()) {
      const section = await collectProvider(p, ctx(), async () => true);
      expect([p.id, section.data]).toEqual([p.id, null]);
      expect([p.id, ['error', 'not_connected', 'not_built', 'unavailable'].includes(section.state)]).toEqual([p.id, true]);
      if (section.state === 'error') expect([p.id, typeof section.failure?.code]).toEqual([p.id, 'string']);
      expect([p.id, JSON.stringify(section)]).not.toEqual([p.id, expect.stringMatching(/secret_|secret alarm/)]);
    }
  });

  it('sets the contract fields on every section', async () => {
    for (const p of registry.list()) {
      const section = await collectProvider(p, ctx(), async () => true);
      expect([p.id, section.retrievedAt, Array.isArray(section.untrusted), section.freshness !== undefined, section.truncation !== undefined])
        .toEqual([p.id, NOW.toISOString(), true, true, true]);
    }
  });
});

describe('ops.cloudwatch_alarms (the alerts source, A-D10)', () => {
  const ok = (names: string[], checkedAt = '2026-11-06T11:59:30.000Z', truncated = false) => ({
    status: 'ok' as const, reason: null, checked_at: checkedAt, region: 'eu-west-1',
    in_alarm: names.map((name) => ({ name, type: 'metric' as const, namespace: 'AWS/EC2', metric: 'CPUUtilization', comparison: 'GreaterThanThreshold', threshold: 90, state_since: null, resource: { type: 'ec2', id: 'i-0123456789abcdef0' } })),
    in_alarm_complete: !truncated, configured_count: 5, configured_count_complete: !truncated, truncated,
  });
  const failed = (reason: 'access_denied' | 'throttled' | 'failed' | 'not_connected' | 'multiple_accounts') => ({
    status: 'error' as const, reason, checked_at: '2026-11-06T11:59:30.000Z', region: null, in_alarm: null, in_alarm_complete: null, configured_count: null, configured_count_complete: null, truncated: null,
  });

  it('available: counts and ids in data; alarm names and watched resources only as untrusted text', async () => {
    (operationsSources.alarms as jest.Mock).mockResolvedValue(ok(['web-cpu-high']));
    const s = await collectProvider(cloudWatchAlarmsProvider, ctx());
    expect(s).toMatchObject({ state: 'available', classification: 'measured', asOf: '2026-11-06T11:59:30.000Z', data: { outcome: 'found', inAlarmCount: 1, configuredCount: 5 } });
    expect(s.scope).toEqual({ kind: 'aws_account_region', connectedAccountId: '123456789012', region: 'eu-west-1' });
    expect(JSON.stringify(s.data)).not.toMatch(/web-cpu-high|i-0123456789abcdef0/);
    expect(s.untrusted).toEqual([{ field: 'a1 alarm name', text: 'web-cpu-high' }, { field: 'a1 resource', text: 'i-0123456789abcdef0' }]);
  });

  it('empty outcome: zero in ALARM is a real, checked "none found"', async () => {
    (operationsSources.alarms as jest.Mock).mockResolvedValue(ok([]));
    expect(await collectProvider(cloudWatchAlarmsProvider, ctx())).toMatchObject({ state: 'available', data: { outcome: 'none_found', inAlarmCount: 0 } });
  });

  it('a capped read is partial with lower bounds, never complete', async () => {
    (operationsSources.alarms as jest.Mock).mockResolvedValue(ok(['a'], undefined, true));
    expect(await collectProvider(cloudWatchAlarmsProvider, ctx())).toMatchObject({ state: 'partial', data: { inAlarmComplete: false } });
  });

  it.each([
    ['not_connected', 'not_connected', null],
    ['multiple_accounts', 'unavailable', null],
    ['access_denied', 'error', 'aws_denied'],
    ['throttled', 'error', 'aws_throttled'],
    ['failed', 'error', 'internal'],
  ] as const)('%s -> %s (%s), never zero alarms', async (reason, state, code) => {
    (operationsSources.alarms as jest.Mock).mockResolvedValue(failed(reason));
    const s = await collectProvider(cloudWatchAlarmsProvider, ctx());
    expect(s).toMatchObject({ state, data: null });
    expect(s.failure?.code ?? null).toBe(code);
  });

  it('stale: a reading older than five minutes is out of date, never current', async () => {
    (operationsSources.alarms as jest.Mock).mockResolvedValue(ok([], '2026-11-06T11:40:00.000Z'));
    const s = await collectProvider(cloudWatchAlarmsProvider, ctx());
    expect(s.state).toBe('stale');
    expect(s.freshness).toMatchObject({ maxAgeSeconds: 300, ageSeconds: 1200 });
  });
});

describe('ops.resource_health and telemetry.cpu never start a sweep', () => {
  it('no cached check: resource health is unavailable and says DevControl does not start one', async () => {
    const s = await collectProvider(resourceHealthProvider, ctx());
    expect(s).toMatchObject({ state: 'unavailable', data: null });
    expect(s.reason).toMatch(/does not start one for an answer/);
  });

  it('CPU: a cached check gives measured CPU per instance; with only stored collection rows it is partial', async () => {
    mockDb.answer = (sql) => {
      if (/FROM resource_telemetry_observations/.test(sql)) return { rows: [{ tracked: 2, with_datapoints: 2, newest: new Date('2026-11-06T11:58:00.000Z') }] };
      if (/FROM observability_collection_scopes/.test(sql)) return { rows: [{ last_full: new Date('2026-11-06T11:58:00.000Z') }] };
      return undefined;
    };
    const s = sources({ costRecommendations: { findAll: async () => [] } });
    expect(await collectProvider(cpuTelemetryProvider, ctx(s))).toMatchObject({ state: 'partial', data: { latestCheck: null, collection: { resourcesTracked: 2 } } });

    (operationsSources.peekEvaluation as jest.Mock).mockReturnValue({
      cachedAt: NOW.getTime(),
      data: { capturedAt: '2026-11-06T11:59:00.000Z', region: 'us-east-1', services: [{ resourceType: 'ec2', resourceId: 'i-0123456789abcdef0', metrics: [{ label: 'CPU', value: 3.4, unit: '%' }] }] },
    });
    expect(await collectProvider(cpuTelemetryProvider, ctx(s))).toMatchObject({
      state: 'available', classification: 'measured',
      data: { latestCheck: { instances: 1 }, items: [{ instanceId: 'i-0123456789abcdef0', basis: 'latest_check_last_hour', cpuPercent: 3.4 }] },
    });
  });
});

describe('cost', () => {
  it('cost.spend: Cost Explorer spend is classified billed; a failure is an error, never $0', async () => {
    const billed = sources({
      context: {
        ...sources().context,
        collectCosts: async () => ({
          state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', classification: 'billed', asOf: '2026-11-06T10:00:00.000Z', scope: null,
          period: { kind: 'range', start: '2026-11-01', endExclusive: '2026-11-07' }, completeness: null, coverage: null, reason: null, derivedFrom: null,
          data: { current: 0, topSpenders: [], estimateCoverage: null }, costExplorer: { state: 'available', reason: null },
          comparison: { state: 'unavailable', note: null, currentWindow: null, previousWindow: null, currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null, currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: 'b' },
        }),
      },
    });
    expect(await collectProvider(spendProvider, ctx(billed))).toMatchObject({ state: 'available', classification: 'billed', provenance: 'actual', data: { amount: 0 } });
    expect(await collectProvider(spendProvider, ctx())).toMatchObject({ state: 'error', data: null });
  });

  it('cost.findings: savings basis, price known, lifecycle and idle CPU evidence; no analysis yet is unavailable, a completed one with none is none_found', async () => {
    mockDb.answer = (sql) => (/GROUP BY status/.test(sql) ? { rows: [{ status: 'ACTIVE', n: '1' }, { status: 'DISMISSED', n: '2' }] } : undefined);
    const rec = { id: 'r1', resource_id: 'i-0123456789abcdef0', resource_name: 'web <script>', resource_type: 'EC2', issue: 'Idle EC2 Instance', potential_savings: 30, severity: 'MEDIUM', status: 'ACTIVE', metadata: { savings_basis: 'estimated: list price', price_source: 'default_unlisted_type', average_cpu: 1.2, days_analyzed: 7, cpu_evidence: { datapoints_observed: 160, datapoints_expected: 168 } } };
    const s = await collectProvider(costFindingsProvider, ctx(sources({ costRecommendations: { findAll: async () => [rec] } })));
    expect(s).toMatchObject({
      state: 'available', classification: 'estimated',
      data: { outcome: 'found', lifecycle: { active: 1, dismissed: 2, resolved: 0 }, items: [{ savingsBasis: 'estimate', priceKnown: false, cpuEvidence: { averageCpuPercent: 1.2, daysAnalyzed: 7 } }] },
    });
    expect(JSON.stringify(s.data)).not.toContain('<script>');

    mockDb.answer = (sql) => (/GROUP BY status/.test(sql) ? { rows: [] } : undefined);
    const none = await collectProvider(costFindingsProvider, ctx(sources({ costRecommendations: { findAll: async () => [] } })));
    expect(none).toMatchObject({ state: 'available', data: { outcome: 'none_found' } });

    const noRun = sources({
      context: { ...sources().context, gatherInventoryBasis: async () => ({ discovery: await collectSection({ source: 'd' }, async () => ({ state: 'unavailable' as const, reason: 'no run' })), account: await accountAvailable(), inventoryScope: { kind: 'resource_inventory' as const, connectedAccountId: null, discoveryRegion: null } }) },
      costRecommendations: { findAll: async () => [] },
    });
    expect(await collectProvider(costFindingsProvider, ctx(noRun))).toMatchObject({ state: 'unavailable', data: null });
  });
});

describe('connection.scope and coverage.regions', () => {
  const coverage = (connected: boolean, listedAt: Date | null) => async () => ({
    account: connected ? { connected: true, status: 'active', home_region: 'us-east-1' } : { connected: false, status: null, home_region: null },
    scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: listedAt !== null, count: listedAt ? 2 : null, listed_at: listedAt, stale: false } },
    region_status: connected ? [
      { region: 'us-east-1', home: true, status: 'ok', last_scan_finished_at: listedAt, last_success_at: listedAt, last_error_code: null, consecutive_failures: 0, stale: false },
      { region: 'eu-west-1', home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false },
    ] : [],
    scan_in_progress: null, last_completed_scan: null, last_successful_scan_at: listedAt, last_scan: null, resource_types: null, tags_unknown_by_type: {}, regions: [], total: 0,
  });

  it('not connected -> not_connected; more than one account -> unavailable', async () => {
    expect(await collectProvider(connectionScopeProvider, ctx(sources({ coverage: coverage(false, null) })))).toMatchObject({ state: 'not_connected' });
    expect(await collectProvider(regionCoverageProvider, ctx(sources({ coverage: coverage(false, null) })))).toMatchObject({ state: 'not_connected' });
    const ambiguous = sources({ coverage: async () => { throw new AwsAccountAmbiguousError(ORG, 2); } });
    expect(await collectProvider(regionCoverageProvider, ctx(ambiguous))).toMatchObject({ state: 'unavailable' });
  });

  it('regions: every recorded region with its scan status; home region only is scanned; an old list is stale', async () => {
    const fresh = await collectProvider(regionCoverageProvider, ctx(sources({ coverage: coverage(true, new Date('2026-11-06T09:00:00.000Z')) })));
    expect(fresh).toMatchObject({ state: 'available', data: { homeRegion: 'us-east-1', items: [{ region: 'us-east-1', status: 'ok' }, { region: 'eu-west-1', status: 'never_scanned' }] } });
    expect(fresh.scope).toMatchObject({ kind: 'aws_account_regions', regions: [{ region: 'us-east-1', status: 'ok' }, { region: 'eu-west-1', status: 'never_scanned' }] });
    const old = await collectProvider(regionCoverageProvider, ctx(sources({ coverage: coverage(true, new Date('2026-11-05T09:00:00.000Z')) })));
    expect(old.state).toBe('stale');
    const unknown = await collectProvider(regionCoverageProvider, ctx(sources({ coverage: coverage(true, null) })));
    expect(unknown.state).toBe('partial');
  });
});

describe('security', () => {
  const finding = (over: Record<string, unknown>) => ({
    id: 'f', organization_id: ORG, finding_key: 'k', category: 'networking', severity: 'high', title: 'Port 22 open on sg-0123', recommendation: 'r',
    resource_identifier: 'sg-0123', region: 'us-east-1', status: 'active', detected_at: '2026-11-01T00:00:00.000Z', last_seen_at: '2026-11-06T06:00:00.000Z',
    resolved_at: null, disposition: null, disposition_actor_id: null, disposition_at: null, disposition_note: 'customer note', evidence: null, created_at: '', updated_at: '', derived_status: 'active', framework_mapping: null, ...over,
  });

  it('account findings: dispositions counted, titles and identifiers untrusted, the customer note never read', async () => {
    const s = await collectProvider(accountFindingsProvider, ctx(sources({ accountFindings: { getActive: async () => [finding({}), finding({ id: 'g', severity: 'critical', disposition: 'accepted_risk' })] } })));
    expect(s).toMatchObject({ state: 'available', data: { outcome: 'found', total: 2, byDisposition: { open: 1, accepted_risk: 1 }, bySeverity: { critical: 1, high: 1 } } });
    expect(JSON.stringify(s.data)).not.toMatch(/Port 22|sg-0123|customer note/);
    expect(JSON.stringify(s)).not.toMatch(/customer note/);
    expect(s.untrusted?.map((u) => u.field)).toEqual(['f1 title', 'f1 resource', 'f2 title', 'f2 resource']);
  });

  it('no active findings: none_found only when the latest evaluation is current; otherwise unavailable', async () => {
    const current = jest.spyOn(AccountSecurityFindingsRepository.prototype, 'isLatestSecurityEvaluationCurrent').mockResolvedValue(true);
    const empty = sources({ accountFindings: { getActive: async () => [] } });
    expect(await collectProvider(accountFindingsProvider, ctx(empty))).toMatchObject({ state: 'available', data: { outcome: 'none_found', total: 0 } });
    current.mockResolvedValue(false);
    expect(await collectProvider(accountFindingsProvider, ctx(empty))).toMatchObject({ state: 'unavailable', data: null });
  });

  it('Top Risk never picks an accepted or dismissed finding; its title is untrusted', async () => {
    const s = await collectProvider(topRiskProvider, ctx(sources({ accountFindings: { getActive: async () => [finding({ severity: 'critical', disposition: 'accepted_risk', title: 'accepted one' }), finding({ title: 'the real one' })] } })));
    expect(s.data).toEqual({ count: 2, top: { ref: 'top', severity: 'high' }, reviewedUrgent: 1 });
    expect(topRiskTitle(s as ContextSection<never>)).toBe('the real one');
  });

  it('risk score: calculated, with its daily history; preliminary is unavailable; below the plan never read (A-D12)', async () => {
    const trend = jest.spyOn(RiskTrackingService.prototype, 'getRiskScoreTrend').mockResolvedValue({
      current: { score: 74, grade: 'C', factors: { encryption: 80 }, isPreliminary: false },
      trend: 'improving', trendPercentage: 6, history: [{ date: '2026-11-05', score: 70 }, { date: '2026-11-06', score: 74 }], period: {},
    } as never);
    expect(await collectProvider(riskScoreProvider, ctx(), async () => true)).toMatchObject({
      state: 'available', classification: 'calculated', data: { score: 74, grade: 'C', trend: 'improving', items: [{ date: '2026-11-06', score: 74 }, { date: '2026-11-05', score: 70 }] },
    });
    trend.mockResolvedValue({ current: { isPreliminary: true }, history: [] } as never);
    expect((await collectProvider(riskScoreProvider, ctx(), async () => true)).state).toBe('unavailable');
    trend.mockClear();
    expect((await collectProvider(riskScoreProvider, ctx(), async () => false)).state).toBe('not_entitled');
    expect(trend).not.toHaveBeenCalled();
  });
});

describe('security.security_hub sync status (review M1)', () => {
  const hubState = (over: Record<string, unknown>) => ({
    organizationId: ORG, capabilityStatus: 'ENABLED', capabilityCheckedAt: '2026-11-06T11:00:00.000Z', capabilityError: null, enabledStandards: [{ arn: 'x' }],
    lastSyncStatus: 'COMPLETED', lastSyncStartedAt: '2026-11-06T11:00:00.000Z', lastSyncCompletedAt: '2026-11-06T11:05:00.000Z',
    lastSyncError: null, lastSyncPagesProcessed: 1, lastSyncFindingsCount: 0, ...over,
  });
  const run = async (over: Record<string, unknown>) => {
    jest.spyOn(SecurityHubStateRepository.prototype, 'get').mockResolvedValue(hubState(over) as never);
    mockDb.answer = (sql) => (/FROM security_hub_findings/.test(sql)
      ? { rows: [{ severity: 'high', compliance_status: 'FAILED', security_control_id: 'EC2.1', title: 'fixture finding', last_seen_at: new Date('2026-11-06T11:04:00.000Z') }] }
      : undefined);
    return collectProvider(securityHubProvider, ctx(), async () => true);
  };

  it('COMPLETED -> available with its findings', async () => {
    expect(await run({})).toMatchObject({ state: 'available', data: { lastSyncStatus: 'COMPLETED', activeFindings: 1 } });
  });

  it('PARTIAL -> partial, as before', async () => {
    expect(await run({ lastSyncStatus: 'PARTIAL' })).toMatchObject({ state: 'partial', reason: 'the last sync read only part of the findings' });
  });

  it('FAILED -> error with a safe code: never "available, 0", and no AWS text', async () => {
    const s = await run({ lastSyncStatus: 'FAILED', lastSyncFindingsCount: 0, lastSyncError: 'AccessDeniedException: secret AWS text' });
    expect(s).toMatchObject({ state: 'error', data: null, failure: { code: 'internal' } });
    expect(JSON.stringify(s)).not.toMatch(/"activeFindings"|secret AWS text/);
  });

  it('a first sync still RUNNING (placeholder capability ERROR, no completed sync) -> not available, "first sync in progress"', async () => {
    const s = await run({ capabilityStatus: 'ERROR', lastSyncStatus: 'RUNNING', lastSyncCompletedAt: null });
    expect(s).toMatchObject({ state: 'unavailable', data: null, reason: SECURITY_HUB_FIRST_SYNC_REASON });
    expect(SECURITY_HUB_FIRST_SYNC_REASON).toBe('first sync in progress');
    expect(s.reason).not.toMatch(/status: ERROR/);
  });

  it('re-review L5: a sync RUNNING after a completed one -> not available, "sync in progress"', async () => {
    const s = await run({ lastSyncStatus: 'RUNNING' });
    expect(s).toMatchObject({ state: 'unavailable', data: null, reason: SECURITY_HUB_SYNC_RUNNING_REASON });
    expect(SECURITY_HUB_SYNC_RUNNING_REASON).toBe('sync in progress');
  });

  it('re-review L5: a sync RUNNING after a FAILED one (capability ENABLED, completed time set, 0 findings) -> not available, never "available, 0"', async () => {
    const s = await run({ lastSyncStatus: 'RUNNING', capabilityStatus: 'ENABLED', lastSyncFindingsCount: 0, lastSyncCompletedAt: '2026-11-06T10:00:00.000Z' });
    expect(s).toMatchObject({ state: 'unavailable', data: null, reason: 'sync in progress' });
    expect(JSON.stringify(s)).not.toMatch(/"activeFindings"/);
  });
});

describe('security.top_risk with no current evaluation (review M2)', () => {
  it('no active findings and no current evaluation -> unavailable, the account-findings rule', async () => {
    jest.spyOn(AccountSecurityFindingsRepository.prototype, 'isLatestSecurityEvaluationCurrent').mockResolvedValue(false);
    const s = await collectProvider(topRiskProvider, ctx(sources({ accountFindings: { getActive: async () => [] } })));
    expect(s).toMatchObject({ state: 'unavailable', data: null });
    expect(s.reason).toMatch(/no completed, current security evaluation/);
  });

  it('no active findings with a current evaluation -> available, count 0', async () => {
    jest.spyOn(AccountSecurityFindingsRepository.prototype, 'isLatestSecurityEvaluationCurrent').mockResolvedValue(true);
    const s = await collectProvider(topRiskProvider, ctx(sources({ accountFindings: { getActive: async () => [] } })));
    expect(s).toMatchObject({ state: 'available', data: { count: 0, top: null, reviewedUrgent: 0 } });
  });
});

describe('sources DevControl does not have', () => {
  it('anomalies (A-D11) and alert history (A-D10) are not_built -- never available, never empty', async () => {
    expect(await collectProvider(anomaliesProvider, ctx())).toMatchObject({ state: 'not_built', data: null, reason: 'DevControl does not detect cost anomalies yet' });
    expect(await collectProvider(alertHistoryProvider, ctx())).toMatchObject({ state: 'not_built', data: null });
  });
});
