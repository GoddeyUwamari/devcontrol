/**
 * Internal identifiers -- enum values, scope kinds, field names -- must never
 * reach the model verbatim. The model repeats what it is given, so the text it
 * receives uses natural language ("Not supported", "AWS resource inventory",
 * "through September 25") instead of implementation labels (not_supported,
 * resource_inventory, endExclusive).
 *
 * These tests capture the FINAL model-facing text -- the exact system prompt
 * and first user message AIChatService.chat() sends to the Anthropic API
 * (the client is stubbed; no real call is made) -- and the non-LLM fallback
 * text shown to users directly.
 */
import { setModelClientForTests } from '../ai/model-client';
import { Pool } from 'pg';
import { AIChatService, ChatContext, COMPARISON_BASIS, ContextSection } from '../ai-chat.service';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import awsCostService from '../aws-cost.service';
import { chatCosts, evidenceBundle } from './chat-context-fixtures';
import { notBuilt } from '../ai-context-contract';

/** Identifiers used by the context contract and the cost context. */
const INTERNAL_IDENTIFIERS = [
  // ContextDataState values that are not plain English words
  'not_supported',
  // scope kinds
  'resource_inventory', 'aws_resource_inventory', 'cost_explorer', 'cost_explorer_billing_scope',
  // ContextSection / scope / cost / comparison field names, as code and as snake_case
  'asOf', 'as_of', 'endExclusive', 'end_exclusive', 'currentWindowIncludesToday', 'finishedThrough', 'finished_through', 'connectedAccountId',
  'connected_account_id', 'discoveryRegion', 'discovery_region', 'linkedAccountFilter', 'linked_account_filter',
  'consolidatedBilling', 'consolidated_billing', 'estimatedMonthlyCost', 'estimated_monthly_cost',
  'estimatedForCount', 'invocationsKnownForCount', 'topSpenders', 'costExplorer', 'estimateCoverage',
  'currentWindow', 'current_window', 'previousWindow', 'previous_window', 'currentWindowTotal', 'changeAmount',
  'changePercent', 'month_to_date_spend', 'partial_day', 'completedAt', 'accountId',
];

const SNAKE_CASE = /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g;
const CAMEL_CASE = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;

/**
 * The untrusted-text fence is the one deliberate delimiter in the model input
 * (the system prompt names it): its tag is removed before the checks.
 */
function expectNoInternalLabels(raw: string) {
  const text = raw.replace(/<\/?untrusted_evidence[^>]*>/g, '');
  for (const identifier of INTERNAL_IDENTIFIERS) {
    expect({ identifier, found: text.includes(identifier) }).toEqual({ identifier, found: false });
  }
  expect(text.match(SNAKE_CASE) ?? []).toEqual([]);
  expect(text.match(CAMEL_CASE) ?? []).toEqual([]);
}

function section<T>(state: ContextSection<T>['state'], data: T | null, extra: Partial<ContextSection<T>> = {}): ContextSection<T> {
  return { state, source: 'DevControl resource inventory (periodic AWS discovery)', provenance: null, period: null, completeness: null, derivedFrom: null, asOf: null, scope: null, coverage: null, reason: null, data, ...extra };
}
function noData(state: ContextSection<never>['state'], extra: Partial<ContextSection<never>> = {}): ContextSection<never> {
  return section<never>(state, null, extra);
}

const INVENTORY_SCOPE: ChatContext['inventoryScope'] = { kind: 'resource_inventory', connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' };

/** Every state and scope kind appears somewhere in this context. */
function everyStateContext(): ChatContext {
  return {
    discovery: section('available', { completedAt: '2026-09-25T06:00:03.693Z' }, { asOf: '2026-09-25T06:00:03.693Z' }),
    account: section('available', { accountId: '123456789012', region: 'us-east-1' }),
    services: section('partial', ['ec2', 's3'], {
      scope: INVENTORY_SCOPE, coverage: 'EC2, RDS, and Lambda resources only',
      reason: 'Latest discovery run is incomplete; inventory data may be stale or incomplete.',
    }),
    costs: chatCosts({
      state: 'available', source: 'actual', current: 15.07, asOf: '2026-09-25T15:17:36.123Z',
      period: { start: '2026-09-01', endExclusive: '2026-09-26' },
      scope: { kind: 'cost_explorer', connectedAccountId: '123456789012', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' },
      topSpenders: [
        { service: 'Amazon Elastic Compute Cloud - Compute', cost: 6.7, percentage: 44.4 },
        { service: 'AWS Cost Explorer', cost: 2.88, percentage: 19.1 },
      ],
      costExplorer: { state: 'available', reason: null },
      estimateCoverage: null,
      comparison: {
        state: 'partial', note: 'some days in the compared windows have no daily Cost Explorer data',
        currentWindow: { start: '2026-09-01', end: '2026-09-25' }, previousWindow: { start: '2026-08-01', end: '2026-08-25' },
        currentWindowTotal: 15.07, previousWindowTotal: 14.33, changeAmount: 0.74, changePercent: 5.2,
        coverage: { currentDays: 24, previousDays: 25, expectedCurrentDays: 25, expectedPreviousDays: 25 },
        currentWindowIncludesToday: true, finishedThrough: null, asOf: '2026-09-25T15:17:36.123Z', basis: COMPARISON_BASIS,
      },
    }),
    inventoryScope: INVENTORY_SCOPE,
    resources: section('available', {
      ec2: { count: 1 },
      rds: { count: 2, estimatedMonthlyCost: 0, estimatedForCount: 2 },
      lambda: { count: 3, invocations: 150, invocationsKnownForCount: 2 },
    }, { asOf: '2026-09-25T06:00:03.693Z', scope: INVENTORY_SCOPE, coverage: 'EC2, RDS, and Lambda resources only' }),
    dora: section('available', { deploymentFrequency: '115 deployments in 30 days', changeFailureRate: '0.9% (1 failed out of 115 finished deployments)', leadTime: '6.2 hours (Average time between consecutive deployments)', mttr: '71.35 minutes (1 incidents recovered)' }, {
      source: 'DevControl deployment records', asOf: '2026-09-25T15:21:05.794Z',
      scope: { kind: 'organization', window: 'last 30 days' },
      coverage: 'deployments and incidents recorded in DevControl for this organization; deployments made outside DevControl are not included',
    }),
    // Every state the registry produces, in words: not provided yet, not in the plan, and available data.
    evidence: evidenceBundle({
      'alerts.history': notBuilt({ source: 'DevControl alert history' }, 'DevControl does not keep a history of past alerts for your organization yet'),
      'security.security_hub': { ...noData('not_entitled', { source: 'AWS Security Hub (last DevControl sync)', reason: "not included in this organization's current plan" }) },
      'ops.cloudwatch_alarms': section('available', {
        outcome: 'found', inAlarmCount: 1, inAlarmComplete: true, configuredCount: 2, configuredCountComplete: true,
        items: [{ ref: 'a1', type: 'metric', namespace: 'AWS/EC2', metric: 'CPUUtilization', comparison: 'GreaterThanThreshold', threshold: 80, inAlarmSince: null, resourceType: 'ec2' }],
      }, {
        source: 'Amazon CloudWatch alarms', asOf: '2026-09-25T15:17:00.000Z', classification: 'measured',
        scope: { kind: 'aws_account_region', connectedAccountId: '123456789012', region: 'us-east-1' },
        untrusted: [{ field: 'a1 alarm name', text: 'web high CPU' }],
      }),
    }),
  };
}

/** The estimate / unavailable / error variants of the cost context. */
function estimatedCostContext(): ChatContext {
  const base = everyStateContext();
  return {
    ...base,
    costs: chatCosts({
      state: 'partial', source: 'estimated', current: 42.5, asOf: '2026-09-25T06:00:03.693Z', period: null,
      scope: INVENTORY_SCOPE, topSpenders: null,
      costExplorer: { state: 'error', reason: 'the Cost Explorer request failed' },
      estimateCoverage: { estimatedResources: 3, totalResources: 4 },
      comparison: {
        state: 'unavailable', note: 'no Cost Explorer data for the current period, so there is nothing to compare',
        currentWindow: null, previousWindow: null, currentWindowTotal: null, previousWindowTotal: null,
        changeAmount: null, changePercent: null, coverage: null, currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: COMPARISON_BASIS,
      },
    }),
    dora: noData('unavailable', { source: 'DevControl deployment records', scope: { kind: 'organization', window: 'last 30 days' }, reason: 'no deployments were recorded for this organization in the last 30 days' }),
  };
}

/** The exact system prompt and first user message chat() sends to the model. */
async function finalModelInput(context: ChatContext, question = 'What is my AWS spend this month?'): Promise<string> {
  const service = new AIChatService({} as Pool);
  // Model calls go through the shared client (services/ai/model-client.ts): a stub stream with no chunks.
  const stream = jest.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() { /* no chunks */ },
    finalMessage: async () => ({ content: [], stop_reason: 'end_turn' }),
    abort: () => undefined,
  });
  setModelClientForTests({ messages: { stream, create: jest.fn() } } as never);
  try {
    for await (const _chunk of service.chat([{ role: 'user', content: question }], context)) { /* drain */ }
  } finally {
    setModelClientForTests(undefined);
  }

  expect(stream).toHaveBeenCalledTimes(1);
  const params = stream.mock.calls[0][0];
  return `${params.system}\n\n${params.messages[0].content}`;
}

describe('final model-facing text never exposes internal identifiers', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('with actual cost data and every section state (available, partial, not supported)', async () => {
    const text = await finalModelInput(everyStateContext());

    // The states and scopes really are present -- in natural language.
    expect(text).toMatch(/Alert history \(past alerts\): DevControl doesn't provide this yet/);
    expect(text).toMatch(/AWS Security Hub: not included in this organization's current plan/);
    expect(text).toMatch(/- in alarm count: 1/);
    expect(text).toMatch(/Status: Partial/);
    expect(text).toMatch(/AWS resources DevControl discovered/);
    expect(text).toMatch(/2026-09-01 through 2026-09-25 inclusive \(September 1–25, 2026\)/);
    expectNoInternalLabels(text);
  });

  it('with an inventory-estimate cost, an unavailable comparison, and an unavailable section', async () => {
    const text = await finalModelInput(estimatedCostContext());

    expect(text).toMatch(/Status: Not available/);
    expectNoInternalLabels(text);
  });

  it('with a context built by the real repository when every getter fails', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error('relation "aws_accounts" does not exist')) } as unknown as Pool;
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('ThrottlingException'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = await new AIChatContextRepository(throwingPool).gatherContext('org-id');

    const text = await finalModelInput(context);

    expect(text).toMatch(/Status: Could not be retrieved/);
    expect(text).not.toMatch(/relation "aws_accounts"|ThrottlingException/);
    expectNoInternalLabels(text);
  });
});

describe('the non-LLM fallback text shown to users never exposes internal identifiers', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterAll(() => { if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey; });

  it.each([
    ['cost', 'What is my AWS spend this month?'],
    ['utilization', 'Which instances are underutilized?'],
    ['generic', 'Give me an overview'],
  ])('%s question', async (_label, question) => {
    for (const context of [everyStateContext(), estimatedCostContext()]) {
      const chunks: string[] = [];
      for await (const chunk of new AIChatService({} as Pool).chat([{ role: 'user', content: question }], context)) chunks.push(chunk);
      expectNoInternalLabels(chunks.join(''));
    }
  });
});
