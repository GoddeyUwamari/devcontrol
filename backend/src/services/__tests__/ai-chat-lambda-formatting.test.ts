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
 * Detected Anomalies must carry the same estimated/not-billing-confirmed
 * disclosure the rest of the prompt already applies to resource-inventory
 * figures, since a cost_spike's `impact` is built from the same
 * estimated_monthly_cost basis.
 */
import { AIChatService, ChatContext } from '../ai-chat.service';

function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    services: [],
    costs: { current: 0, previous: 0, changePercent: null, topSpenders: [], source: 'unavailable', asOf: null },
    resources: {},
    alerts: { total: 0, critical: 0, recent: [] },
    timeRange: '30d',
    resourceDataAsOf: null,
    ...overrides,
  };
}

describe('AIChatService.formatContext -- Lambda invocation line', () => {
  const service = new AIChatService({} as any);

  it('never asserts a specific invocation count when no function\'s usage is known', () => {
    const context = baseContext({
      resources: { lambda: { count: 3, invocations: 0, invocationsKnownForCount: 0 } },
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 3 functions, 30-day invocation data unavailable');
    expect(formatted).not.toMatch(/0 invocations/);
  });

  it('discloses partial knowledge rather than presenting an incomplete sum as the full total', () => {
    const context = baseContext({
      resources: { lambda: { count: 3, invocations: 150, invocationsKnownForCount: 2 } },
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('usage known for 2 of 3 functions');
    expect(formatted).toContain('150 invocations over the last 30 days');
  });

  it('states the real total plainly when every function\'s usage is known', () => {
    const context = baseContext({
      resources: { lambda: { count: 2, invocations: 150, invocationsKnownForCount: 2 } },
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 2 functions, 150 invocations over the last 30 days');
    expect(formatted).not.toContain('usage known for');
  });

  it('a genuinely zero-invocation fleet (all known) still states the real zero, not "unavailable"', () => {
    const context = baseContext({
      resources: { lambda: { count: 1, invocations: 0, invocationsKnownForCount: 1 } },
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('- Lambda: 1 functions, 0 invocations over the last 30 days');
  });
});

describe('AIChatService.formatContext -- anomaly provenance', () => {
  const service = new AIChatService({} as any);

  it('discloses that a cost_spike anomaly is a resource-inventory estimate, not confirmed AWS billing', () => {
    const context = baseContext({
      anomalies: [{ type: 'cost_spike', service: 'lambda', description: '2 resources with high spend', impact: '$600/month' }],
    });

    const formatted = (service as any).formatContext(context);

    expect(formatted).toContain('Detected Anomalies (source: DevControl resource inventory estimate');
    expect(formatted).toContain('not a confirmed AWS Cost Explorer billing event');
  });
});
