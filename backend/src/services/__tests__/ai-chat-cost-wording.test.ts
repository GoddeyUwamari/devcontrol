/**
 * Cost wording the AI Assistant is given -- regression coverage for defects
 * observed in production answers on 2026-09-25 (PR #125 verification):
 *   - an exclusive Cost Explorer end boundary (2026-09-26) restated as if that
 *     day were included ("2026-09-01 through 2026-09-26");
 *   - a 25-day month-to-date amount labeled "$2.82/month" and annualized to
 *     "$33.84/year";
 *   - "EC2 - Compute" described as including EBS/Elastic IP/data-transfer
 *     charges that Cost Explorer bills separately under "EC2 - Other";
 *   - the AWS Cost Explorer line item blamed on the user's own scripts, when
 *     which tool made the billed Cost Explorer requests is unknown (DevControl
 *     itself queries Cost Explorer for the account);
 *   - DORA figures volunteered in a cost answer, with "lead time" standing in
 *     for what DevControl actually measures (time between deployments).
 *
 * These pin the context and system prompt the model receives. Whether a given
 * model response follows them is only observable in production, not here.
 *
 * No DB needed: formatContext()/getSystemPrompt() never touch the pool.
 */
import { AIChatService, ChatContext, COMPARISON_BASIS, ContextSection, formatInclusiveRange, lastIncludedDay } from '../ai-chat.service';

function noData(state: ContextSection<never>['state'], extra: Partial<ContextSection<never>> = {}): ContextSection<never> {
  return { state, source: 'test source', asOf: null, scope: null, coverage: null, reason: null, data: null, ...extra };
}

const NO_DEPLOYMENTS = noData('unavailable', { source: 'DevControl deployment records', reason: 'no deployments were recorded for this organization in the last 30 days' });

const service = new AIChatService({} as any);

function format(context: ChatContext): string {
  return (service as any).formatContext(context);
}

function systemPrompt(): string {
  return (service as any).getSystemPrompt();
}

/** The real production context shape observed 2026-09-25 (figures as returned by /api/ai-chat/context). */
function productionLikeContext(overrides: Partial<ChatContext['costs']> = {}, dora: ChatContext['dora'] = NO_DEPLOYMENTS): ChatContext {
  const inventoryScope: ChatContext['inventoryScope'] = { kind: 'resource_inventory', connectedAccountId: '815931739526', discoveryRegion: 'us-east-1' };
  const inventory = { source: 'DevControl resource inventory (periodic AWS discovery)', asOf: '2026-09-25T06:00:03.693Z', scope: inventoryScope, reason: null };
  return {
    discovery: { state: 'available', source: 'DevControl resource discovery runs', asOf: '2026-09-25T06:00:03.693Z', scope: null, coverage: null, reason: null, data: { completedAt: '2026-09-25T06:00:03.693Z' } },
    account: { state: 'available', source: 'DevControl connected AWS account record', asOf: null, scope: null, coverage: null, reason: null, data: { accountId: '815931739526', region: 'us-east-1' } },
    services: { state: 'available', ...inventory, coverage: null, data: ['ec2', 's3', 'sns', 'vpc'] },
    costs: {
      state: 'available',
      source: 'actual',
      current: 14.83,
      asOf: '2026-09-25T08:57:16.538Z',
      period: { start: '2026-09-01', endExclusive: '2026-09-26' },
      scope: { kind: 'cost_explorer', connectedAccountId: '815931739526', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' },
      topSpenders: [
        { service: 'Amazon Elastic Compute Cloud - Compute', cost: 6.6, percentage: 44.5 },
        { service: 'Amazon Virtual Private Cloud', cost: 2.87, percentage: 19.3 },
        { service: 'AWS Cost Explorer', cost: 2.82, percentage: 19.0 },
        { service: 'EC2 - Other', cost: 1.75, percentage: 11.8 },
        { service: 'AWS Key Management Service', cost: 0.79, percentage: 5.3 },
      ],
      costExplorer: { state: 'available', reason: null },
      estimateCoverage: null,
      comparison: {
        state: 'available', note: null,
        currentWindow: { start: '2026-09-01', end: '2026-09-25' },
        previousWindow: { start: '2026-08-01', end: '2026-08-25' },
        currentWindowTotal: 14.83, previousWindowTotal: 14.33, changeAmount: 0.5, changePercent: 3.5,
        coverage: { currentDays: 25, previousDays: 25, expectedCurrentDays: 25, expectedPreviousDays: 25 },
        currentWindowIncludesToday: true, asOf: '2026-09-25T08:57:16.538Z', basis: COMPARISON_BASIS,
      },
      ...overrides,
    },
    inventoryScope,
    resources: {
      state: 'available', ...inventory, coverage: 'EC2, RDS, and Lambda resources only',
      data: {
        ec2: { count: 1, utilization: noData('not_supported', { reason: 'DevControl does not collect EC2 CPU utilization into the resource inventory.' }) },
        rds: { count: 0, estimatedMonthlyCost: null, estimatedForCount: 0 },
        lambda: { count: 0, invocations: 0, invocationsKnownForCount: 0 },
      },
    },
    alerts: noData('not_supported', { source: 'DevControl alert history', reason: "Organization-scoped alert data is not connected to the assistant: DevControl's alert sync does not yet associate alerts with an organization, so this account's alert counts cannot be determined." }),
    anomalies: noData('not_supported', { source: 'DevControl anomaly detection', reason: "No anomaly detection is connected to the assistant's context." }),
    dora,
  };
}

describe('user-facing dates from an exclusive end boundary', () => {
  it('lastIncludedDay steps back one calendar day across month, year, and leap-day boundaries', () => {
    expect(lastIncludedDay('2026-09-26')).toBe('2026-09-25');
    expect(lastIncludedDay('2026-10-01')).toBe('2026-09-30');
    expect(lastIncludedDay('2027-01-01')).toBe('2026-12-31');
    expect(lastIncludedDay('2028-03-01')).toBe('2028-02-29');
  });

  it('formatInclusiveRange writes the range a reader would', () => {
    expect(formatInclusiveRange('2026-09-01', '2026-09-25')).toBe('September 1–25, 2026');
    expect(formatInclusiveRange('2026-09-01', '2026-09-01')).toBe('September 1, 2026');
    expect(formatInclusiveRange('2026-08-30', '2026-09-02')).toBe('August 30 – September 2, 2026');
    expect(formatInclusiveRange('2026-12-30', '2027-01-02')).toBe('December 30, 2026 – January 2, 2027');
  });

  it('the period is stated inclusively and the exclusive boundary never appears as a date', () => {
    const formatted = format(productionLikeContext());

    expect(formatted).toMatch(/- Period: month-to-date, 2026-09-01 through 2026-09-25 inclusive \(September 1–25, 2026\)/);
    expect(formatted).not.toMatch(/2026-09-26/);
    expect(formatted).not.toMatch(/September 1–26/);
  });

  it('flags the last day as incomplete when the figure was obtained on that day', () => {
    expect(format(productionLikeContext())).toMatch(/2026-09-25 was still in progress when this figure was obtained, so that day's spend is incomplete/);
  });

  it('makes no in-progress claim for a figure obtained after its period ended (e.g. served from cache past midnight)', () => {
    const formatted = format(productionLikeContext({ asOf: '2026-09-26T00:30:00.000Z' }));

    expect(formatted).toMatch(/2026-09-01 through 2026-09-25 inclusive/);
    expect(formatted).not.toMatch(/was still in progress/);
  });

  it('comparison windows are stated inclusively, with the partial current day called out', () => {
    const formatted = format(productionLikeContext());

    expect(formatted).toMatch(/Current window: 2026-09-01 through 2026-09-25 inclusive \(September 1–25, 2026\), total \$14\.83/);
    expect(formatted).toMatch(/Previous window: 2026-08-01 through 2026-08-25 inclusive \(August 1–25, 2026\), total \$14\.33/);
    expect(formatted).toMatch(/Partial day: the current window's last day \(2026-09-25\) is today and still in progress, while every previous-window day is complete/);
    expect(formatted).toMatch(/- Change: \+\$0\.50 \(\+3\.5%\)/);
  });

  it('the system prompt forbids presenting an exclusive boundary as an included day', () => {
    expect(systemPrompt()).toMatch(/never present an exclusive end\s+boundary as a day that is included/);
  });
});

describe('observed partial-period spend is not a monthly or annual rate', () => {
  it('month-to-date spend and top services are labeled as observed amounts, never "/month" or "/year"', () => {
    const formatted = format(productionLikeContext());
    const costSection = formatted.slice(formatted.indexOf('Cost data:'), formatted.indexOf('Resource inventory'));

    expect(costSection).toMatch(/Month-to-date spend: \$14\.83 \(observed spend for the period above -- not a full-month amount or a monthly rate\)/);
    expect(costSection).toMatch(/observed amounts for the period above, not monthly rates/);
    expect(costSection).not.toMatch(/\/month|\/year|per month|annual/i);
  });

  it('the system prompt no longer demands monthly AND annual figures for every cost, and forbids extrapolating partial periods', () => {
    const prompt = systemPrompt();

    expect(prompt).not.toMatch(/Show monthly AND annual savings/);
    expect(prompt).not.toMatch(/"Save \$X\/month"/);
    expect(prompt).toMatch(/Never label them "\/month" or "\/year", and never extrapolate them into\s+a monthly or annual figure unless the user asks for a projection/);
  });
});

describe('Cost Explorer category attribution', () => {
  it('no longer tells the model an EC2 category includes EBS, Elastic IP, or data-transfer charges', () => {
    const formatted = format(productionLikeContext());

    expect(formatted).not.toMatch(/can include EBS/i);
    expect(formatted).toMatch(/each line is its own category and does not include charges billed under another listed category/);
  });

  it('keeps the resource-attribution safeguard', () => {
    expect(format(productionLikeContext())).toMatch(/a category total is not proof that any one resource caused that spend/);
    expect(systemPrompt()).toMatch(/Don't attribute a category's\s+cost to a specific resource/);
  });

  it('the system prompt keeps "EC2 - Other" distinct from EC2 - Compute', () => {
    expect(systemPrompt()).toMatch(/"EC2 - Other" is not part of "Amazon Elastic Compute Cloud - Compute"/);
  });
});

describe('the AWS Cost Explorer line item', () => {
  // Caller attribution for Cost Explorer API requests is unproven (no
  // CloudTrail evidence), so the wording separates observed spend, possible
  // API-request spend, and an unknown caller -- blaming no one either way.
  const causalClaims = /caused by (DevControl|the user|your)|DevControl caused|your (own )?(scripts|automation|tools) (caused|made|generated)|wholly/i;

  it('when present, is described as observed spend that may include API-request charges from an unknown caller', () => {
    const formatted = format(productionLikeContext());

    expect(formatted).toMatch(/the AWS Cost Explorer line item is observed spend for the period above/);
    expect(formatted).toMatch(/may include charges for Cost Explorer API requests, which any cost-monitoring tool querying this billing scope can generate, including DevControl/);
    expect(formatted).toMatch(/Which callers made those requests is unknown -- attribute the charge to no one/);
  });

  it('makes no causal claim about the user or about DevControl', () => {
    const formatted = format(productionLikeContext());
    const costSection = formatted.slice(formatted.indexOf('Cost data:'), formatted.indexOf('Period comparison'));

    expect(costSection).not.toMatch(causalClaims);
  });

  it('adds no Cost Explorer note when there is no Cost Explorer line item', () => {
    const formatted = format(productionLikeContext({ topSpenders: [{ service: 'Amazon Elastic Compute Cloud - Compute', cost: 6.6, percentage: 100 }] }));

    expect(formatted).not.toMatch(/Cost Explorer API requests/);
  });

  it('the system prompt keeps the caller unknown and forbids blaming either the user or DevControl', () => {
    const prompt = systemPrompt();

    expect(prompt).toMatch(/Which callers made those requests is\s+unknown: never state or imply that the user's scripts or automation, or\s+DevControl, caused the charge/);
    expect(prompt).toMatch(/never tell the user to reduce their own\s+Cost Explorer calls because of it/);
    expect(prompt).not.toMatch(/may be partly or wholly caused by DevControl/);
  });
});

describe('DORA metrics in the cost context', () => {
  const dora: ChatContext['dora'] = {
    state: 'available',
    source: 'DevControl deployment records',
    asOf: '2026-09-25T08:57:16.538Z',
    scope: { kind: 'organization', window: 'last 30 days' },
    coverage: 'deployments and incidents recorded in DevControl for this organization; deployments made outside DevControl are not included',
    reason: null,
    data: {
      deploymentFrequency: '114 deployments in 30 days',
      leadTime: '6.12 hours (Average time between consecutive deployments)',
      mttr: '71.35 minutes (1 incidents recovered)',
    },
  };

  it('when available, are labeled as deployment-record data unrelated to cost, with their scope and lead time\'s own description', () => {
    const formatted = format(productionLikeContext({}, dora));

    expect(formatted).toMatch(/DORA metrics \(not AWS billing data and unrelated to the cost data above/);
    expect(formatted).toMatch(/Source: DevControl deployment records/);
    expect(formatted).toMatch(/Scope: this DevControl organization, last 30 days/);
    expect(formatted).toMatch(/- Lead time: 6\.12 hours \(Average time between consecutive deployments\)/);
    expect(formatted).not.toMatch(/Lead time for changes/);
  });

  it('when unavailable, no DORA figure is invented and the section says why', () => {
    const formatted = format(productionLikeContext());
    const doraSection = formatted.slice(formatted.indexOf('DORA metrics'));

    expect(doraSection).toMatch(/Status: Not available/);
    expect(doraSection).toMatch(/Data: not available -- no deployments were recorded for this organization in the last 30 days/);
    expect(formatted).not.toMatch(/deployments in/);
    expect(formatted).not.toMatch(/Lead time:/);
  });

  it('the system prompt keeps DORA out of cost answers unless asked', () => {
    expect(systemPrompt()).toMatch(/Mention them only when the user asks about deployments,\s+delivery, or reliability -- not in answers about cost or spend/);
  });
});
