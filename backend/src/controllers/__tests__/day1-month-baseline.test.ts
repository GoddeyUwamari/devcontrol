/**
 * Day-1 month boundary (day1-step1.md): what every backend money surface says
 * around 00:00 UTC on the first of a month, pinned in __fixtures__/day1-month/.
 * A change in any of them shows up as a diff of those files. To regenerate
 * after an approved change:
 *   DAY1_MONTH_FIXTURES=write npx jest day1-month-baseline
 *
 * Cases (all UTC; the synthetic ledger has charges through `dataThrough`):
 *   d1_0030          2026-12-01T00:30Z, nothing reported for December yet
 *   d1_absent        2026-12-01T00:30Z, Cost Explorer leaves out the empty December result
 *   d1_charge        2026-12-01T18:00Z, Dec 1 already has charges
 *   d2_none          2026-12-02T00:30Z, nothing reported for December yet
 *   d2_charge        2026-12-02T18:00Z, Dec 1 has charges
 *   d3               2026-12-03T00:30Z, Dec 1-2 have charges
 *   d3_metric_key    2026-12-03T00:30Z, groups carry the amount under another metric key
 *   d15              2026-12-15T18:00Z, mid-month (review M-2: no previous-month total for the model)
 *
 * Surfaces: the cost summary (GET /api/platform/costs/summary), the AI
 * summary's spend facts, AI chat's cost context and its no-model reply, the
 * AI report's deterministic spend sentence, and Costs "Ask AI" (NL query).
 * Cost Explorer, STS and the database are stubs: no AWS, database or model call.
 */
const mockCostExplorerSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  ...jest.requireActual('@aws-sdk/client-sts'),
  STSClient: class {
    send = jest.fn(async () => ({ Credentials: { AccessKeyId: 'ASIATESTTEMP', SecretAccessKey: 'test-secret', SessionToken: 'test-session' } }));
  },
}));
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  ...jest.requireActual('@aws-sdk/client-cost-explorer'),
  CostExplorerClient: class {
    send = (...args: unknown[]) => mockCostExplorerSend(...args);
  },
}));
jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import awsCostService from '../../services/aws-cost.service';
import { StatsController } from '../stats.controller';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { AIChatService } from '../../services/ai-chat.service';
import { AISummaryService } from '../../services/ai-summary.service';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';
import { NLQueryExecutorService } from '../../services/nl-query-executor.service';
import { collectSection } from '../../services/ai-context-contract';
import { monthOverMonthSection, spendSection } from '../../services/cost-context-sections';
import { spendProvider } from '../../services/ai/evidence/providers/cost';
import { ceLedgerResponse, ACCOUNT_ROW, type CeInput } from './dashboard-money-fixtures';

import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };

const DIR = path.join(__dirname, '__fixtures__', 'day1-month');
const WRITE = process.env.DAY1_MONTH_FIXTURES === 'write';
const ORG = ACCOUNT_ROW.org_id;

type Ce = ReturnType<typeof ceLedgerResponse>;
interface Case {
  at: string;
  dataThrough: string;
  transform?: (r: Ce, input: CeInput) => Ce;
}

const DAY1_CASES: Record<string, Case> = {
  d1_0030: { at: '2026-12-01T00:30:00.000Z', dataThrough: '2026-11-30' },
  d1_absent: {
    at: '2026-12-01T00:30:00.000Z',
    dataThrough: '2026-11-30',
    transform: (r, input) => (input.Granularity === 'MONTHLY' ? { ...r, ResultsByTime: r.ResultsByTime.filter((x) => x.TimePeriod.Start !== '2026-12-01') } : r),
  },
  d1_charge: { at: '2026-12-01T18:00:00.000Z', dataThrough: '2026-12-01' },
  d2_none: { at: '2026-12-02T00:30:00.000Z', dataThrough: '2026-11-30' },
  d2_charge: { at: '2026-12-02T18:00:00.000Z', dataThrough: '2026-12-01' },
  d3: { at: '2026-12-03T00:30:00.000Z', dataThrough: '2026-12-02' },
  d3_metric_key: {
    at: '2026-12-03T00:30:00.000Z',
    dataThrough: '2026-12-02',
    transform: (r) => ({
      ...r,
      ResultsByTime: r.ResultsByTime.map((x) => ({
        ...x,
        Groups: x.Groups.map((g) => ({ ...g, Metrics: { UNBLENDED_COST: g.Metrics.UnblendedCost } as never })),
      })),
    }),
  },
  d15: { at: '2026-12-15T18:00:00.000Z', dataThrough: '2026-12-14' },
};

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, body);
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'));
}

function clearCostCaches(): void {
  for (const key of ['monthlyCostCache', 'monthlyCostInFlight', 'costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
}

function useCase(c: Case): void {
  jest.setSystemTime(new Date(c.at));
  mockCostExplorerSend.mockImplementation(async (command: { input: CeInput }) => {
    const r = ceLedgerResponse(command.input, c.dataThrough);
    return c.transform ? c.transform(r, command.input) : r;
  });
}

async function costSummary(): Promise<unknown> {
  const json = jest.fn();
  await new StatsController({ query: ambientPool.query } as unknown as Pool).getCostSummary({ user: { organizationId: ORG } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

const unavailable = { state: 'unavailable', data: null, reason: 'fixture', source: 'fixture', provenance: null, asOf: null, coverage: null };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  clearCostCaches();
  mockCostExplorerSend.mockReset();
  ambientPool.query.mockReset();
  ambientPool.query.mockImplementation(async (sql: string) => (/aws_resources/.test(sql) ? { rows: [{ total_resources: '0', estimated_resources: '0', total: null }] } : { rows: [ACCOUNT_ROW] }));
  jest.spyOn(AIChatContextRepository.prototype, 'gatherInventoryBasis').mockImplementation(async () => ({
    discovery: await collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () => ({
      state: 'available', data: { completedAt: '2026-11-30T18:00:00.000Z' }, asOf: '2026-11-30T18:00:00.000Z',
    })),
    account: await collectSection<{ accountId: string | null; region: string | null }>({ source: 'DevControl connected AWS account record' }, async () => ({
      state: 'available', data: { accountId: '123456789012', region: 'us-east-1' },
    })),
    inventoryScope: { kind: 'resource_inventory', connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' },
  }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(Object.keys(DAY1_CASES))('%s', (name) => {
  it('cost summary (GET /api/platform/costs/summary)', async () => {
    useCase(DAY1_CASES[name]);
    pin(`${name}.summary.json`, await costSummary());
  });

  it('AI surfaces: summary facts, chat context and reply, report sentence, Ask AI', async () => {
    useCase(DAY1_CASES[name]);
    pin(`${name}.ai.json`, await aiSurfaces());
  });
});

/** Every AI surface's cost output for the current case. */
async function aiSurfaces() {
  const pool = { query: ambientPool.query } as unknown as Pool;
  const { costs } = await new AIChatContextRepository(pool).gatherCostContext(ORG);
  const spend = await spendSection(costs);
  const mom = await monthOverMonthSection(costs);

  const sections = new Proxy({ spend, monthOverMonth: mom } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : unavailable) });
  const summaryFacts = new AISummaryService().buildFactLines(sections as never)
    .filter((l) => /spend|month-over-month|Month-over-month/i.test(l));

  const chat = new AIChatService(pool) as unknown as {
    formatCostSection: (c: unknown) => string;
    getFallbackResponse: (m: unknown, c: unknown) => string;
  };
  const chatContext = chat.formatCostSection(costs);
  const chatFallback = chat.getFallbackResponse([{ role: 'user', content: 'What is my AWS spend this month?' }], { costs });

  const reportSentence = (new AIReportGeneratorService(pool) as unknown as { spendSentence: (s: unknown) => string }).spendSentence(spend);
  const askAi = await (new NLQueryExecutorService(pool) as unknown as { queryCosts: (o: string) => Promise<unknown> }).queryCosts(ORG);

  return {
    modelSpendSection: { state: spend.state, reason: spend.reason, data: spend.data },
    summaryFacts,
    chatContext: chatContext.split('\n'),
    chatFallback: chatFallback.split('\n'),
    reportSentence,
    askAi,
  };
}

describe('contract assertions (beyond the pinned files)', () => {
  it.each(['d1_0030', 'd1_absent', 'd2_none'])('%s: no AI surface is told or says $0; each says there are no billed days yet', async (name) => {
    useCase(DAY1_CASES[name]);
    const out = await aiSurfaces();
    expect(out.modelSpendSection.data).toMatchObject({ amount: null, monthState: { state: 'no_billed_days_yet', amount: null } });
    const said = JSON.stringify([out.summaryFacts, out.chatContext, out.chatFallback, out.reportSentence, (out.askAi as { summary: string }).summary]);
    // The approved wording may say "not $0" / "never say ... $0"; it must never state a $0.00 figure.
    expect(said).not.toMatch(/\$0\.00/);
    for (const text of [out.summaryFacts.join(' '), out.chatContext.join(' '), out.chatFallback.join(' '), out.reportSentence, (out.askAi as { summary: string }).summary]) {
      expect(text).toMatch(/no billed days/i);
    }
  });

  it('d2_charge: AI surfaces state the figure and that the latest days are still updating', async () => {
    useCase(DAY1_CASES.d2_charge);
    const out = await aiSurfaces();
    for (const text of [out.summaryFacts.join(' '), out.chatContext.join(' '), out.reportSentence, (out.askAi as { summary: string }).summary]) {
      expect(text).toContain('$13.30');
      expect(text).toMatch(/latest days are still updating/);
    }
  });

  describe('review M-2: the AI report model gets the previous month only while no day of this month has finished', () => {
    /** The report's model-facing request with the spend section its provider builds (as AI reports do). */
    async function reportPrompt(): Promise<{ prompt: string; spend: Awaited<ReturnType<typeof spendSection>> }> {
      const pool = { query: ambientPool.query } as unknown as Pool;
      const { costs } = await new AIChatContextRepository(pool).gatherCostContext(ORG);
      const spend = await spendProvider.collect({ basis: { costs: async () => costs } } as never);
      const prompt = new AIReportGeneratorService(pool).buildUserPrompt(
        { organizationId: ORG, reportType: 'cost', dateRange: { from: '2026-12-01', to: '2026-12-16' }, sections: { spend } } as never,
        'cost'
      );
      return { prompt, spend };
    }

    it('Dec 15 (month_to_date): no previous-month total in the report request; the cost summary endpoint still has it', async () => {
      useCase(DAY1_CASES.d15);
      const { prompt, spend } = await reportPrompt();
      expect(spend.data?.monthState).toMatchObject({ state: 'month_to_date', previousMonth: null });
      expect(prompt).toContain('"previousMonth":null');
      expect(prompt).not.toMatch(/"previousMonth":\{/);
      expect(prompt).not.toContain('399');
      clearCostCaches();
      const body = (await costSummary()) as { data: { spend: { data: { monthState: { previousMonth: unknown } } } } };
      expect(body.data.spend.data.monthState.previousMonth).toMatchObject({ month: '2026-11', amount: 399 });
    });

    it('Dec 3 (month_to_date): none either', async () => {
      useCase(DAY1_CASES.d3);
      const { prompt } = await reportPrompt();
      expect(prompt).not.toMatch(/"previousMonth":\{/);
    });

    it.each(['d1_0030', 'd1_absent', 'd1_charge', 'd2_none', 'd2_charge'])('%s (no day finished yet): the report request keeps the previous month', async (name) => {
      useCase(DAY1_CASES[name]);
      const { prompt, spend } = await reportPrompt();
      expect(spend.data?.monthState?.previousMonth).toMatchObject({ month: '2026-11', amount: 399 });
      expect(prompt).toMatch(/"previousMonth":\{"month":"2026-11"/);
    });
  });

  it('DAY1-D17: a response without the expected cost metric is unavailable with a reason code, never 0', async () => {
    useCase(DAY1_CASES.d3_metric_key);
    const { costs } = await new AIChatContextRepository({ query: ambientPool.query } as unknown as Pool).gatherCostContext(ORG);
    expect(costs.costExplorer).toEqual({ state: 'unavailable', reason: 'the Cost Explorer response did not include the expected cost metric', code: 'cost_metric_missing' });
    expect(costs.provenance).not.toBe('actual');
    expect(costs.data?.current ?? null).toBeNull();
    expect(costs.monthState).toMatchObject({ state: 'unavailable', amount: null, amountUsable: false, reason: { code: 'cost_metric_missing' } });
    const body = (await costSummary()) as { data: { spend: { state: string; data: unknown }; monthStateReason: unknown } };
    expect(body.data.spend.data).toBeNull();
    // review L-4: the API carries the reason code, not only the words.
    expect(body.data.monthStateReason).toEqual({ code: 'cost_metric_missing', text: 'AWS Cost Explorer has no usable result (the Cost Explorer response did not include the expected cost metric)' });
  });

  it.each([
    ['d1_0030', { code: 'no_line_items_yet', text: 'AWS Cost Explorer has not reported any charges for this UTC month yet' }],
    ['d1_absent', { code: 'no_current_month_result', text: 'AWS Cost Explorer has not reported any charges for this UTC month yet' }],
    ['d2_charge', null],
    ['d15', null],
  ])('review L-4: %s cost summary carries the month state reason code', async (name, reason) => {
    useCase(DAY1_CASES[name]);
    const body = (await costSummary()) as { data: { monthStateReason: unknown } };
    expect(body.data.monthStateReason).toEqual(reason);
  });

  it('every case: the cost path carries the month state with the period of the request', async () => {
    for (const [name, c] of Object.entries(DAY1_CASES)) {
      clearCostCaches();
      useCase(c);
      const { costs } = await new AIChatContextRepository({ query: ambientPool.query } as unknown as Pool).gatherCostContext(ORG);
      expect({ name, month: costs.monthState?.period.month, start: costs.monthState?.period.start }).toEqual({ name, month: '2026-12', start: '2026-12-01' });
    }
  });
});
