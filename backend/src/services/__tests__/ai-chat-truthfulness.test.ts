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
import { chatCosts, evidenceBundle } from './chat-context-fixtures';

const pool = {} as Pool; // AIChatService's constructor stores it but never queries it directly

const NO_COMPARISON: ChatContext['costs']['comparison'] = {
  state: 'unavailable', note: null, currentWindow: null, previousWindow: null,
  currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null,
  currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: COMPARISON_BASIS,
};

/** A section in a given state -- data only when available/partial, as the repository builds them. */
function section<T>(state: ContextSection<T>['state'], data: T | null, extra: Partial<ContextSection<T>> = {}): ContextSection<T> {
  return { state, source: 'test source', provenance: null, period: null, completeness: null, derivedFrom: null, asOf: null, scope: null, coverage: null, reason: null, data, untrusted: [], failure: null, ...extra };
}

const ALARMS_AS_OF = '2026-09-06T10:05:00.000Z';
/** The evidence bundle every base context carries: alarms could not be read; no alert history; no anomaly detection; no CPU yet. */
function evidence(alarms: ContextSection<unknown> = noData('error', { source: 'Amazon CloudWatch alarms', failure: { code: 'aws_denied', retryable: false } })) {
  return evidenceBundle({
    'ops.cloudwatch_alarms': alarms,
    'telemetry.cpu': noData('unavailable', { source: 'Amazon CloudWatch CPUUtilization, as DevControl recorded it', reason: 'no EC2 CPU telemetry has been recorded yet' }),
    'alerts.history': noData('not_built', { source: 'DevControl alert history', reason: 'DevControl does not keep a history of past alerts for your organization yet' }),
    'anomalies.cost': noData('not_built', { source: 'DevControl anomaly detection', reason: 'DevControl does not detect cost anomalies yet' }),
  });
}
const alarmsAvailable = (inAlarmCount: number) => section('available', { outcome: inAlarmCount > 0 ? 'found' : 'none_found', inAlarmCount, inAlarmComplete: true, configuredCount: 4, configuredCountComplete: true, items: [] }, { source: 'Amazon CloudWatch alarms', asOf: ALARMS_AS_OF });

/** A section with no data (error / not_supported / unavailable). */
function noData(state: ContextSection<never>['state'], extra: Partial<ContextSection<never>> = {}): ContextSection<never> {
  return section<never>(state, null, extra);
}

const RESOURCES: InventoryResources = {
  ec2: { count: 3 },
  rds: { count: 0, estimatedMonthlyCost: null, estimatedForCount: 0 },
  lambda: { count: 0, invocations: 0, invocationsKnownForCount: 0 },
};

const INVENTORY_SCOPE: ChatContext['inventoryScope'] = {
  kind: 'resource_inventory', connectedAccountId: '123456789012', discoveryRegion: 'us-east-1',
};

function estimatedCosts(current: number): ChatContext['costs'] {
  return chatCosts({
    state: 'available', source: 'estimated', current, asOf: '2026-09-06T06:00:00.000Z', period: null,
    scope: INVENTORY_SCOPE, topSpenders: null,
    costExplorer: { state: 'error', reason: 'the Cost Explorer request failed' },
    estimateCoverage: { estimatedResources: 3, totalResources: 3 }, comparison: NO_COMPARISON,
  });
}

function unavailableCosts(): ChatContext['costs'] {
  return chatCosts({
    state: 'unavailable', source: 'unavailable', current: null, asOf: null, period: null, scope: null,
    topSpenders: null, costExplorer: { state: 'unavailable', reason: 'no connected AWS account' },
    estimateCoverage: null, comparison: NO_COMPARISON,
  });
}

function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    discovery: section('available', { completedAt: '2026-09-06T06:00:00.000Z' }, { asOf: '2026-09-06T06:00:00.000Z' }),
    account: section('available', { accountId: '123456789012', region: 'us-east-1' }),
    services: section('available', ['ec2', 'rds'], { source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-06T06:00:00.000Z', scope: INVENTORY_SCOPE }),
    costs: chatCosts({
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
        currentWindowIncludesToday: true, finishedThrough: null, asOf: '2026-09-06T10:00:00.000Z', basis: COMPARISON_BASIS,
      },
    }),
    inventoryScope: INVENTORY_SCOPE,
    resources: section('available', RESOURCES, { source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-06T06:00:00.000Z', scope: INVENTORY_SCOPE, coverage: 'EC2, RDS, and Lambda resources only' }),
    dora: noData('unavailable', { source: 'DevControl deployment records', reason: 'no deployments were recorded for this organization in the last 30 days' }),
    evidence: evidence(),
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

    const inventory = formatted.slice(formatted.indexOf('Resource inventory ('), formatted.indexOf('Alerts:'));
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
    const inventory = formatted.slice(formatted.indexOf('Resource inventory ('), formatted.indexOf('Alerts:'));

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

  it('a source DevControl does not provide (not_built) says so from its provider state, and never "none"', () => {
    const formatted = format(baseContext());
    const history = formatted.split('\n').find((l) => l.startsWith('- Alert history (past alerts):')) ?? '';
    const anomalies = formatted.split('\n').find((l) => l.startsWith('- Cost anomalies:')) ?? '';

    expect(history).toMatch(/DevControl doesn't provide this yet .*never say none were found/);
    expect(anomalies).toMatch(/DevControl doesn't provide this yet \(DevControl does not detect cost anomalies yet\)/);
    expect(formatted).not.toMatch(/Prometheus|not associated with an organization|Status: Not supported/);
    expect(formatted).not.toMatch(/active alerts: 0|Total active alerts|No recent incidents|recent: none/i);
  });

  it('alarms that could not be read are "couldn\'t be retrieved", with a safe code -- never "none"', () => {
    const formatted = format(baseContext());
    const alarms = formatted.split('\n').find((l) => l.startsWith('- CloudWatch alarms (current state):')) ?? '';
    expect(alarms).toMatch(/couldn't be retrieved right now \(AWS denied access\) -- this is missing data, never "none"/);
  });

  it('"unavailable" prints no figure, only why', () => {
    const formatted = format(baseContext());
    const dora = formatted.slice(formatted.indexOf('DORA metrics'));

    expect(dora).toMatch(/Data: not available -- no deployments were recorded/);
    expect(dora).not.toMatch(/Deployment frequency|Lead time|Mean time/);
  });

  it('an "available" genuine zero is stated as checked, none found, with its data', () => {
    const formatted = format(baseContext({ evidence: evidence(alarmsAvailable(0)) }));
    const alarms = formatted.split('\n').find((l) => l.startsWith('- CloudWatch alarms (current state):')) ?? '';

    expect(alarms).toBe(`- CloudWatch alarms (current state): checked, none found (Amazon CloudWatch alarms, as of ${ALARMS_AS_OF}). [data below]`);
    expect(formatted).toMatch(/- in alarm count: 0/);
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

  it('EC2 CPU utilization is its own source: never stated as "0 underutilized" from the inventory', () => {
    const formatted = format(baseContext());

    expect(formatted).toMatch(/- EC2: 3 instances \(CPU utilization is its own evidence source below\)/);
    expect(formatted).toMatch(/- EC2 CPU utilization \(CloudWatch\): not available: no EC2 CPU telemetry has been recorded yet/);
    expect(formatted).not.toMatch(/\d+ underutilized|underutilized: \d|does not collect EC2 CPU/);
  });

  it('the system prompt forbids reading error / not_supported / unavailable as none or zero', () => {
    const prompt: string = (service as any).getSystemPrompt();

    expect(prompt).toMatch(/never treat\s+any of those as \$0, zero, none, empty, unchanged, or "no findings"/);
    expect(prompt).toMatch(/"Not included in this plan"/);
    expect(prompt).toMatch(/"Not provided\s+by DevControl yet"/);
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

  it('never claims "0 underutilized" (or that utilization is "being gathered") when there is no CPU evidence', async () => {
    const response = await fallbackFor('Which instances are underutilized?', baseContext());

    expect(response).toMatch(/I don't have EC2 CPU utilization data for this account right now \(not available: no EC2 CPU telemetry has been recorded yet\)/);
    expect(response).not.toMatch(/\d+ of your \d+ EC2 instances|being gathered/);
  });

  it('with CPU evidence, says how many instances it has, in the approved words (founder §L)', async () => {
    const withCpu = baseContext();
    withCpu.evidence = evidenceBundle({
      ...Object.fromEntries(withCpu.evidence.results.map((r) => [r.id, r.section])),
      'telemetry.cpu': section('available', { items: [{ ref: 'u1', instanceId: 'i-1234567890abcdef0' }, { ref: 'u2', instanceId: 'i-0123456789abcdef0' }] }, { source: 'Amazon CloudWatch CPUUtilization, as DevControl recorded it', asOf: ALARMS_AS_OF }),
    });
    const response = await fallbackFor('Which instances are underutilized?', withCpu);

    expect(response).toContain(`DevControl has CloudWatch CPU utilization for 2 EC2 instances (as of ${ALARMS_AS_OF}). Ask again when the AI assistant is available to analyze it.`);
  });

  it('L2: counts distinct EC2 instances -- one instance in the latest check and an idle finding is "1 EC2 instance"', async () => {
    const withCpu = baseContext();
    withCpu.evidence = evidenceBundle({
      ...Object.fromEntries(withCpu.evidence.results.map((r) => [r.id, r.section])),
      'telemetry.cpu': section('available', { items: [
        { ref: 'u1', instanceId: 'i-1234567890abcdef0', basis: 'latest_check_last_hour', cpuPercent: 2 },
        { ref: 'u2', instanceId: 'i-1234567890abcdef0', basis: 'idle_finding_7_day_average', cpuPercent: 1.5 },
      ] }, { source: 'Amazon CloudWatch CPUUtilization, as DevControl recorded it', asOf: ALARMS_AS_OF }),
    });
    const response = await fallbackFor('Which instances are underutilized?', withCpu);

    expect(response).toContain(`DevControl has CloudWatch CPU utilization for 1 EC2 instance (as of ${ALARMS_AS_OF}). Ask again when the AI assistant is available to analyze it.`);
  });

  it('L3: the Active alerts line says "at least" for a capped read, never otherwise; "1 CloudWatch alarm" singular', async () => {
    const capped = (n: number) => section('partial', { outcome: 'found', inAlarmCount: n, inAlarmComplete: false, configuredCount: 9, configuredCountComplete: false, items: [] }, { source: 'Amazon CloudWatch alarms', asOf: ALARMS_AS_OF, reason: 'capped' });
    const expectLine = async (alarms: ContextSection<unknown>, line: string) => {
      const response = await fallbackFor('Give me an overview', baseContext({ evidence: evidence(alarms) }));
      expect(response).toContain(`- Active alerts: ${line}`);
    };

    await expectLine(capped(3), `at least 3 CloudWatch alarms in ALARM (as of ${ALARMS_AS_OF})`);
    await expectLine(capped(1), `at least 1 CloudWatch alarm in ALARM (as of ${ALARMS_AS_OF})`);
    await expectLine(alarmsAvailable(3), `3 CloudWatch alarms in ALARM (as of ${ALARMS_AS_OF})`);
    await expectLine(alarmsAvailable(1), `1 CloudWatch alarm in ALARM (as of ${ALARMS_AS_OF})`);
  });

  it('re-review N4: only a capped in-ALARM count is "at least"; a capped configured count leaves it exact', async () => {
    const configuredOnly = section('partial', { outcome: 'found', inAlarmCount: 3, inAlarmComplete: true, configuredCount: 1000, configuredCountComplete: false, items: [] }, { source: 'Amazon CloudWatch alarms', asOf: ALARMS_AS_OF, reason: 'capped' });
    const inAlarmCapped = section('partial', { outcome: 'found', inAlarmCount: 3, inAlarmComplete: false, configuredCount: 1000, configuredCountComplete: false, items: [] }, { source: 'Amazon CloudWatch alarms', asOf: ALARMS_AS_OF, reason: 'capped' });
    const lineFor = async (alarms: ContextSection<unknown>) => (await fallbackFor('Give me an overview', baseContext({ evidence: evidence(alarms) }))).split('\n').find((l) => l.startsWith('- Active alerts:'));

    expect(await lineFor(configuredOnly)).toBe(`- Active alerts: 3 CloudWatch alarms in ALARM (as of ${ALARMS_AS_OF})`);
    expect(await lineFor(inAlarmCapped)).toBe(`- Active alerts: at least 3 CloudWatch alarms in ALARM (as of ${ALARMS_AS_OF})`);
  });

  it('never claims "0 active alerts" or "No recent incidents" when alarms could not be read', async () => {
    const response = await fallbackFor('Give me an overview', baseContext());

    expect(response).toMatch(/Active alerts: not available -- couldn't be retrieved right now \(AWS denied access\)/);
    expect(response).not.toMatch(/Active alerts: 0|No recent incidents/);
  });

  it('never states a resource-type count from an errored inventory', async () => {
    const response = await fallbackFor('Give me an overview', baseContext({ services: noData('error') }));

    expect(response).toMatch(/I don't have a resource inventory for this account right now/);
    expect(response).not.toMatch(/I can see \d+ discovered/);
  });

  it('states real counts when the sections are genuinely available', async () => {
    const response = await fallbackFor('Give me an overview', baseContext({ evidence: evidence(alarmsAvailable(2)) }));

    expect(response).toMatch(/I can see 2 discovered resource types/);
    expect(response).toMatch(new RegExp(`Active alerts: 2 CloudWatch alarms in ALARM \\(as of ${ALARMS_AS_OF}\\)`));
  });
});
