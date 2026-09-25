/**
 * Phase 3B: AIChatService::formatContext()'s Lambda resource line and
 * anomaly-provenance line.
 *
 * Prior behavior (fixed here): the Lambda line always printed a confident
 * "N invocations/month" figure sourced from a query that summed
 * tags->>'invocations', a key nothing ever wrote -- so it always said
 * "0 invocations/month" regardless of real usage. It must now (a) never
 * assert a specific invocation count when no function's usage is actually
 * known, and (b) disclose when only some functions' usage is known rather
 * than silently presenting a partial sum as the complete total.
 *
 * Anomalies: the former cost_spike rows were a fixed spend threshold over
 * inventory estimates, not anomaly detection, so the section is now
 * not_supported and must never be printed as "Detected Anomalies".
 */
import { AIChatService, ChatContext, COMPARISON_BASIS, ContextSection, InventoryResources } from '../ai-chat.service';

function noData(state: ContextSection<never>['state'], reason: string | null = null): ContextSection<never> {
  return { state, source: 'test source', asOf: null, scope: null, coverage: null, reason, data: null };
}

/** An available inventory section whose only non-zero resource type is Lambda. */
function withLambda(lambda: InventoryResources['lambda']): ChatContext['resources'] {
  return {
    state: 'available', source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-06T06:00:00.000Z',
    scope: null, coverage: null, reason: null,
    data: {
      ec2: { count: 0, utilization: noData('not_supported', 'DevControl does not collect EC2 CPU utilization into the resource inventory.') },
      rds: { count: 0, estimatedMonthlyCost: null, estimatedForCount: 0 },
      lambda,
    },
  };
}

function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    discovery: noData('unavailable', 'no discovery run has ever run for this account'),
    account: noData('unavailable', 'no AWS account is connected'),
    services: noData('unavailable', 'no resource discovery run has completed as the latest run, so an empty inventory is not a confirmed zero'),
    costs: {
      state: 'unavailable',
      source: 'unavailable',
      current: null,
      asOf: null,
      period: null,
      scope: null,
      topSpenders: null,
      costExplorer: { state: 'unavailable', reason: 'no connected AWS account' },
      estimateCoverage: null,
      comparison: {
        state: 'unavailable', note: null, currentWindow: null, previousWindow: null,
        currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null,
        currentWindowIncludesToday: false, asOf: null, basis: COMPARISON_BASIS,
      },
    },
    inventoryScope: { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null },
    resources: noData('unavailable', 'no resource discovery run has completed as the latest run, so an empty inventory is not a confirmed zero'),
    alerts: noData('not_supported', "Organization-scoped alert data is not connected to the assistant: DevControl's alert sync does not yet associate alerts with an organization, so this account's alert counts cannot be determined."),
    anomalies: noData('not_supported', "No anomaly detection is connected to the assistant's context."),
    dora: noData('unavailable', 'no deployments were recorded for this organization in the last 30 days'),
    ...overrides,
  };
}

describe('AIChatService.formatContext -- Lambda invocation line', () => {
  const service = new AIChatService({} as any);

  it('never asserts a specific invocation count when no function\'s usage is known', () => {
    const context = baseContext({
      resources: withLambda({ count: 3, invocations: 0, invocationsKnownForCount: 0 }),
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 3 functions, 30-day invocation data unavailable');
    expect(formatted).not.toMatch(/0 invocations/);
  });

  it('discloses partial knowledge rather than presenting an incomplete sum as the full total', () => {
    const context = baseContext({
      resources: withLambda({ count: 3, invocations: 150, invocationsKnownForCount: 2 }),
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('usage known for 2 of 3 functions');
    expect(formatted).toContain('150 invocations over the last 30 days');
  });

  it('states the real total plainly when every function\'s usage is known', () => {
    const context = baseContext({
      resources: withLambda({ count: 2, invocations: 150, invocationsKnownForCount: 2 }),
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 2 functions, 150 invocations over the last 30 days');
    expect(formatted).not.toContain('usage known for');
  });

  it('a genuinely zero-invocation fleet (all known) still states the real zero, not "unavailable"', () => {
    const context = baseContext({
      resources: withLambda({ count: 1, invocations: 0, invocationsKnownForCount: 1 }),
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 1 functions, 0 invocations over the last 30 days');
  });
});

describe('AIChatService.formatContext -- anomalies', () => {
  const service = new AIChatService({} as any);

  it('a not_supported anomalies section states its reason and is never presented as detected anomalies or as "none"', () => {
    const formatted: string = (service as any).formatContext(baseContext());
    const anomalies = formatted.slice(formatted.indexOf('Anomalies:'), formatted.indexOf('DORA metrics'));

    expect(anomalies).toMatch(/Status: Not supported/);
    expect(anomalies).toMatch(/No anomaly detection is connected to the assistant's context\./);
    expect(anomalies).toMatch(/This is not a zero, "none", or "no findings"/);
    expect(formatted).not.toMatch(/Detected Anomalies/);
    expect(formatted).not.toMatch(/cost_spike/);
    expect(anomalies).not.toMatch(/none detected/);
  });
});
