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
import { AIChatService, ChatContext, COMPARISON_BASIS, ContextSection, InventoryResources } from '../ai-chat.service';

const pool = {} as Pool; // AIChatService's constructor stores it but never queries it directly

const NO_COMPARISON: ChatContext['costs']['comparison'] = {
  state: 'unavailable', note: null, currentWindow: null, previousWindow: null,
  currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null,
  currentWindowIncludesToday: false, asOf: null, basis: COMPARISON_BASIS,
};

/** A section in a given state -- data only when available/partial, as the repository builds them. */
function section<T>(state: ContextSection<T>['state'], data: T | null, extra: Partial<ContextSection<T>> = {}): ContextSection<T> {
  return { state, source: 'test source', asOf: null, scope: null, coverage: null, reason: null, data, ...extra };
}

/** A section with no data (error / not_supported / unavailable). */
function noData(state: ContextSection<never>['state'], extra: Partial<ContextSection<never>> = {}): ContextSection<never> {
  return section<never>(state, null, extra);
}

const RESOURCES: InventoryResources = {
  ec2: { count: 3, utilization: noData('not_supported', { reason: 'DevControl does not collect EC2 CPU utilization into the resource inventory.' }) },
  rds: { count: 0, estimatedMonthlyCost: null, estimatedForCount: 0 },
  lambda: { count: 0, invocations: 0, invocationsKnownForCount: 0 },
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
    discovery: section('available', { completedAt: '2026-09-06T06:00:00.000Z' }, { asOf: '2026-09-06T06:00:00.000Z' }),
    account: section('available', { accountId: '123456789012', region: 'us-east-1' }),
    services: section('available', ['ec2', 'rds'], { source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-06T06:00:00.000Z', scope: INVENTORY_SCOPE }),
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
        currentWindowIncludesToday: true, asOf: '2026-09-06T10:00:00.000Z', basis: COMPARISON_BASIS,
      },
    },
    inventoryScope: INVENTORY_SCOPE,
    resources: section('available', RESOURCES, { source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-06T06:00:00.000Z', scope: INVENTORY_SCOPE, coverage: 'EC2, RDS, and Lambda resources only' }),
    alerts: noData('not_supported', { source: 'DevControl alert history', reason: "Organization-scoped alert data is not connected to the assistant: DevControl's alert sync does not yet associate alerts with an organization, so this account's alert counts cannot be determined." }),
    anomalies: noData('not_supported', { source: 'DevControl anomaly detection', reason: "No anomaly detection is connected to the assistant's context." }),
    dora: noData('unavailable', { source: 'DevControl deployment records', reason: 'no deployments were recorded for this organization in the last 30 days' }),
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

    expect(formatted).toMatch(/Source: AWS Cost Explorer/);
    expect(formatted).toMatch(/As of: 2026-09-06T10:00:00\.000Z/);
    expect(formatted).toMatch(/Month-to-date spend: \$1,000\.00/);
  });

  it('cost source "estimated" labels the figure as a database estimate, not a live Cost Explorer result', () => {
    const service = new AIChatService(pool);
    const context = baseContext({ costs: estimatedCosts(500) });
    const formatted: string = (service as any).formatContext(context);

    expect(formatted).toMatch(/Source: DevControl inventory estimate .*NOT AWS billing data/);
    expect(formatted).toMatch(/As of: 2026-09-06T06:00:00\.000Z/);
  });

  it('cost source "unavailable" never prints a dollar figure and states no data is available', () => {
    const service = new AIChatService(pool);
    const context = baseContext({ costs: unavailableCosts() });
    const formatted: string = (service as any).formatContext(context);

    expect(formatted).toMatch(/Source: none/);
    expect(formatted).not.toMatch(/\$0/);
    expect(formatted).toMatch(/Spend: not available .*not a zero amount/);
  });

  it('resource inventory section states its own source and as-of timestamp, distinct from the cost section', () => {
    const service = new AIChatService(pool);
    const formatted: string = (service as any).formatContext(baseContext());

    const inventory = formatted.slice(formatted.indexOf('Resource inventory ('), formatted.indexOf('Alerts & incidents'));
    expect(inventory).toMatch(/Resource inventory \(synchronized periodically by DevControl AWS discovery/);
    expect(inventory).toMatch(/Source: DevControl resource inventory \(periodic AWS discovery\)/);
    expect(inventory).toMatch(/As of: 2026-09-06T06:00:00\.000Z/);
  });

  it('resource inventory with no completed discovery run states that plainly rather than fabricating a timestamp', () => {
    const service = new AIChatService(pool);
    const context = baseContext({
      discovery: noData('unavailable', { reason: 'no discovery run has ever run for this account' }),
      resources: noData('unavailable', { reason: 'no resource discovery run has completed as the latest run, so an empty inventory is not a confirmed zero' }),
    });
    const formatted: string = (service as any).formatContext(context);
    const inventory = formatted.slice(formatted.indexOf('Resource inventory ('), formatted.indexOf('Alerts & incidents'));

    expect(inventory).toMatch(/As of: unknown/);
    expect(inventory).toMatch(/Data: not available -- no resource discovery run has completed/);
    expect(inventory).not.toMatch(/EC2: \d/);
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

describe('AIChatService formatContext -- section states (PR A contract)', () => {
  const service = new AIChatService(pool);
  const format = (context: ChatContext): string => (service as any).formatContext(context);
  const sectionOf = (formatted: string, title: string, next: string) => formatted.slice(formatted.indexOf(title), formatted.indexOf(next));

  it('"error" says the data could not be retrieved, prints no data, and keeps the raw error out of the prompt', () => {
    const formatted = format(baseContext({ services: noData('error', { reason: 'could not be retrieved: relation "aws_resources" does not exist' }) }));
    const services = sectionOf(formatted, 'Services in use', 'Cost data:');

    expect(services).toMatch(/Status: Could not be retrieved/);
    expect(services).toMatch(/Data: could not be retrieved -- this is missing data, not an empty result or a zero/);
    expect(services).not.toMatch(/types:/);
    expect(formatted).not.toMatch(/No services detected/);
    expect(formatted).not.toMatch(/relation "aws_resources"/);
  });

  it('"not_supported" states its reason and never prints a zero or "none"', () => {
    const formatted = format(baseContext());
    const alerts = sectionOf(formatted, 'Alerts & incidents', 'Anomalies:');

    expect(alerts).toMatch(/Status: Not supported/);
    expect(alerts).toMatch(/does not yet associate alerts with an organization/);
    expect(alerts).toMatch(/This is not a zero, "none", or "no findings"/);
    expect(formatted).not.toMatch(/active alerts: 0|Total active alerts|No recent incidents|recent: none/i);
  });

  it('"unavailable" prints no figure, only why', () => {
    const formatted = format(baseContext());
    const dora = formatted.slice(formatted.indexOf('DORA metrics'));

    expect(dora).toMatch(/Data: not available -- no deployments were recorded/);
    expect(dora).not.toMatch(/Deployment frequency|Lead time|Mean time/);
  });

  it('an "available" genuine zero is printed as a zero', () => {
    const formatted = format(baseContext({ alerts: section('available', { total: 0, critical: 0, recent: [] }, { source: 'DevControl alert history' }) }));
    const alerts = sectionOf(formatted, 'Alerts & incidents', 'Anomalies:');

    expect(alerts).toMatch(/- active alerts: 0/);
    expect(alerts).toMatch(/- critical alerts: 0/);
    expect(alerts).toMatch(/- recent: none firing/);
  });

  it('"partial" makes its limitation explicit alongside its data', () => {
    const formatted = format(baseContext({
      services: section('partial', ['ec2'], { reason: 'only us-east-1 was discovered', coverage: '1 of 2 regions' }),
    }));
    const services = sectionOf(formatted, 'Services in use', 'Cost data:');

    expect(services).toMatch(/Status: Partial/);
    expect(services).toMatch(/Coverage: 1 of 2 regions/);
    expect(services).toMatch(/Limitation: only us-east-1 was discovered/);
    expect(services).toMatch(/types: ec2/);
  });

  it('an unsupported EC2 utilization is never stated as "0 underutilized"', () => {
    const formatted = format(baseContext());

    expect(formatted).toMatch(/- EC2: 3 instances/);
    expect(formatted).toMatch(/EC2 utilization: Not supported -- DevControl does not collect EC2 CPU utilization/);
    expect(formatted).not.toMatch(/\d+ underutilized|underutilized: \d/);
  });

  it('the system prompt forbids reading error / not_supported / unavailable as none or zero', () => {
    const prompt: string = (service as any).getSystemPrompt();

    expect(prompt).toMatch(/never treat "Not available", "Could not be retrieved", or\s+"Not supported" as \$0, zero, none, empty, unchanged, or "no findings"/);
  });
});

describe('AIChatService getFallbackResponse -- section states', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterAll(() => { if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey; });

  async function fallbackFor(question: string, context: ChatContext): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of new AIChatService(pool).chat([{ role: 'user', content: question }], context)) chunks.push(chunk);
    return chunks.join('');
  }

  it('never claims "0 underutilized" (or that utilization is "being gathered") when utilization is not_supported', async () => {
    const response = await fallbackFor('Which instances are underutilized?', baseContext());

    expect(response).toMatch(/I don't have EC2 utilization data for this account \(DevControl does not collect EC2 CPU utilization into the resource inventory\)/);
    expect(response).not.toMatch(/\d+ of your \d+ EC2 instances|being gathered/);
  });

  it('never claims "0 active alerts" or "No recent incidents" when alerts are not_supported', async () => {
    const response = await fallbackFor('Give me an overview', baseContext());

    expect(response).toMatch(/Active alerts: not available -- Organization-scoped alert data is not connected/);
    expect(response).not.toMatch(/Active alerts: 0|No recent incidents/);
  });

  it('never states a resource-type count from an errored inventory', async () => {
    const response = await fallbackFor('Give me an overview', baseContext({ services: noData('error') }));

    expect(response).toMatch(/I don't have a resource inventory for this account right now/);
    expect(response).not.toMatch(/I can see \d+ discovered/);
  });

  it('states real counts when the sections are genuinely available', async () => {
    const response = await fallbackFor('Give me an overview', baseContext({ alerts: section('available', { total: 2, critical: 1, recent: ['HighCPU'] }) }));

    expect(response).toMatch(/I can see 2 discovered resource types/);
    expect(response).toMatch(/Active alerts: 2 \(1 critical\)/);
  });
});
