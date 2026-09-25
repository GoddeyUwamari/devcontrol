/**
 * Coverage for the AI Assistant "real-time AWS data" truthfulness fix:
 * the system prompt must no longer assert real-time access, and the
 * formatted context handed to the model (and the non-LLM fallback
 * responses) must carry and respect the cost/resource provenance and
 * freshness metadata rather than ever printing a bare, unqualified
 * "$0" that could read as confirmed spend.
 *
 * getSystemPrompt()/formatContext()/getFallbackResponse() are private --
 * accessed here via bracket/any-cast, the pragmatic way to unit-test
 * private methods without exposing them on the public class surface.
 */
import { Pool } from 'pg';
import { AIChatService, ChatContext } from '../ai-chat.service';

const pool = {} as Pool; // AIChatService's constructor stores it but never queries it directly

const NO_COMPARISON: ChatContext['costs']['comparison'] = {
  state: 'unavailable', note: null, currentWindow: null, previousWindow: null,
  currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null,
};

const INVENTORY_SCOPE: ChatContext['inventoryScope'] = {
  kind: 'resource_inventory', connectedAccountId: '123456789012', discoveryRegion: 'us-east-1',
};

function estimatedCosts(current: number): ChatContext['costs'] {
  return {
    state: 'available', source: 'estimated', current, asOf: '2026-09-06T06:00:00.000Z', period: null,
    scope: INVENTORY_SCOPE, topSpenders: null,
    costExplorer: { state: 'error', reason: 'the Cost Explorer request failed' },
    estimateCoverage: { estimatedResources: 3, totalResources: 3 }, comparison: NO_COMPARISON,
  };
}

function unavailableCosts(): ChatContext['costs'] {
  return {
    state: 'unavailable', source: 'unavailable', current: null, asOf: null, period: null, scope: null,
    topSpenders: null, costExplorer: { state: 'unavailable', reason: 'no connected AWS account' },
    estimateCoverage: null, comparison: NO_COMPARISON,
  };
}

function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    services: ['ec2', 'rds'],
    costs: {
      state: 'available',
      source: 'actual',
      current: 1000,
      asOf: '2026-09-06T10:00:00.000Z',
      period: { start: '2026-09-01', endExclusive: '2026-09-07' },
      scope: { kind: 'cost_explorer', connectedAccountId: '123456789012', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' },
      topSpenders: [{ service: 'EC2', cost: 600, percentage: 60 }],
      costExplorer: { state: 'available', reason: null },
      estimateCoverage: null,
      comparison: {
        state: 'available', note: null,
        currentWindow: { start: '2026-09-01', end: '2026-09-06' }, previousWindow: { start: '2026-08-01', end: '2026-08-06' },
        currentWindowTotal: 1000, previousWindowTotal: 900, changeAmount: 100, changePercent: 11.1,
        coverage: { currentDays: 6, previousDays: 6, expectedCurrentDays: 6, expectedPreviousDays: 6 },
      },
    },
    inventoryScope: INVENTORY_SCOPE,
    resources: { ec2: { count: 3, underutilized: 1 } },
    alerts: { total: 0, critical: 0, recent: [] },
    timeRange: 'Last 30 days',
    resourceDataAsOf: '2026-09-06T06:00:00.000Z',
    ...overrides,
  };
}

describe('AIChatService system prompt', () => {
  it('no longer asserts the data is real-time', () => {
    const service = new AIChatService(pool);
    const prompt: string = (service as any).getSystemPrompt();

    expect(prompt).not.toMatch(/real-time context/i);
    expect(prompt).toMatch(/not a live feed/i);
    expect(prompt).toMatch(/never describe context data as .*real-time/i);
  });
});

describe('AIChatService formatContext (private, provenance-aware)', () => {
  it('cost source "actual" states AWS Cost Explorer as the source and includes the real asOf timestamp', () => {
    const service = new AIChatService(pool);
    const formatted: string = (service as any).formatContext(baseContext());

    expect(formatted).toMatch(/source: AWS Cost Explorer/);
    expect(formatted).toMatch(/as_of: 2026-09-06T10:00:00\.000Z/);
    expect(formatted).toMatch(/month_to_date_spend: \$1,000\.00/);
  });

  it('cost source "estimated" labels the figure as a database estimate, not a live Cost Explorer result', () => {
    const service = new AIChatService(pool);
    const context = baseContext({ costs: estimatedCosts(500) });
    const formatted: string = (service as any).formatContext(context);

    expect(formatted).toMatch(/source: DevControl inventory estimate .*NOT AWS billing data/);
    expect(formatted).toMatch(/as_of: 2026-09-06T06:00:00\.000Z/);
  });

  it('cost source "unavailable" never prints a dollar figure and states no data is available', () => {
    const service = new AIChatService(pool);
    const context = baseContext({ costs: unavailableCosts() });
    const formatted: string = (service as any).formatContext(context);

    expect(formatted).toMatch(/source: none/);
    expect(formatted).not.toMatch(/\$0/);
    expect(formatted).toMatch(/spend: not available .*not a zero amount/);
  });

  it('resource inventory section states its own source and as-of timestamp, distinct from the cost section', () => {
    const service = new AIChatService(pool);
    const formatted: string = (service as any).formatContext(baseContext());

    expect(formatted).toMatch(/Resource inventory \(source: DevControl AWS discovery/);
    expect(formatted).toMatch(/As of: 2026-09-06T06:00:00\.000Z/);
  });

  it('resource inventory with no completed discovery run states that plainly rather than fabricating a timestamp', () => {
    const service = new AIChatService(pool);
    const context = baseContext({ resourceDataAsOf: null });
    const formatted: string = (service as any).formatContext(context);

    expect(formatted).toMatch(/no completed discovery run yet for this account/);
  });
});

describe('AIChatService getFallbackResponse (non-LLM degraded path)', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY; // force the fallback path, never the real Claude API
  });

  afterAll(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  async function fallbackFor(question: string, context: ChatContext): Promise<string> {
    const service = new AIChatService(pool);
    const chunks: string[] = [];
    for await (const chunk of service.chat([{ role: 'user', content: question }], context)) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  it('a cost question never presents an unavailable cost as a confirmed $0', async () => {
    const context = baseContext({
      costs: unavailableCosts(),
    });
    const response = await fallbackFor('What is my biggest cost driver this month?', context);

    expect(response).not.toMatch(/\$0/);
    expect(response).toMatch(/don't have cost data available/i);
  });

  it('an estimated cost is labeled as such, not presented as a live Cost Explorer figure', async () => {
    const context = baseContext({
      costs: estimatedCosts(500),
    });
    const response = await fallbackFor('What is my monthly AWS spend?', context);

    expect(response).toMatch(/\$500/);
    expect(response).toMatch(/estimated from your last synced resource inventory/i);
  });

  it('a real "actual" cost still renders normally (no regression for the common case)', async () => {
    const response = await fallbackFor('What is my monthly spend?', baseContext());

    expect(response).toMatch(/\$1,000/);
    expect(response).not.toMatch(/don't have cost data/i);
  });
});
