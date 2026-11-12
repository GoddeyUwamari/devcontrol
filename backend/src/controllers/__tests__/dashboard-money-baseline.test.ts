/**
 * Dashboard money: the cost summary, cost-basis strings and cost socket
 * emissions as the backend produces them for synthetic fixtures, pinned in
 * __fixtures__/dashboard-money/. A change in any of them shows up as a diff
 * of those files. To regenerate after an approved change:
 *   DASHBOARD_MONEY_FIXTURES=write npx jest dashboard-money-baseline
 *
 * Cases (dashboard-step1.md §A.1), all on 2026-11-01T00:37Z
 * (Sat Oct 31 2026, 8:37 PM EDT):
 *   A: the cost cache is cold.
 *   B: the cache was filled at 2026-10-31T21:00Z (5 PM EDT).
 * Cost Explorer, STS and the database are stubs: no AWS or database call is made.
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
import { COMPARISON_BASIS } from '../../services/ai-chat.service';
import { AISummaryService } from '../../services/ai-summary.service';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';
import { collectSection } from '../../services/ai-context-contract';
import { spendSection } from '../../services/cost-context-sections';
import { updateBusinessMetrics } from '../../metrics';
import { ceLedgerResponse, ACCOUNT_ROW } from './dashboard-money-fixtures';

import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };

const DIR = path.join(__dirname, '__fixtures__', 'dashboard-money');
const WRITE = process.env.DASHBOARD_MONEY_FIXTURES === 'write';
const ORG = '00000000-0000-4000-8000-0000000000a1';

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (WRITE) fs.writeFileSync(file, body);
  expect(body).toBe(fs.readFileSync(file, 'utf8'));
}

function clearCostCaches(): void {
  for (const key of ['monthlyCostCache', 'monthlyCostInFlight', 'costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
}

async function summaryAt(iso: string): Promise<unknown> {
  jest.setSystemTime(new Date(iso));
  const json = jest.fn();
  await new StatsController({ query: jest.fn() } as unknown as Pool).getCostSummary({ user: { organizationId: ORG } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

beforeAll(() => {
  if (WRITE) fs.mkdirSync(DIR, { recursive: true });
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  clearCostCaches();
  mockCostExplorerSend.mockReset();
  mockCostExplorerSend.mockImplementation(async (command: { input: never }) => ceLedgerResponse(command.input));
  ambientPool.query.mockReset();
  ambientPool.query.mockResolvedValue({ rows: [ACCOUNT_ROW] });
  jest.spyOn(AIChatContextRepository.prototype, 'gatherInventoryBasis').mockImplementation(async () => ({
    discovery: await collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () => ({
      state: 'available', data: { completedAt: '2026-10-31T18:00:00.000Z' }, asOf: '2026-10-31T18:00:00.000Z',
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

describe('cost summary at 2026-11-01T00:37Z (Oct 31 8:37 PM EDT)', () => {
  it('case A: cold cache', async () => {
    const body = await summaryAt('2026-11-01T00:37:00.000Z');
    pin('caseA.summary.json', body);
    pin('caseA.ce-requests.json', mockCostExplorerSend.mock.calls.map(([c]) => (c as { input: unknown }).input));
  });

  it('case B: cache filled at 2026-10-31T21:00Z', async () => {
    await summaryAt('2026-10-31T21:00:00.000Z');
    mockCostExplorerSend.mockClear();
    const body = await summaryAt('2026-11-01T00:37:00.000Z');
    pin('caseB.summary.json', body);
    pin('caseB.ce-requests.json', mockCostExplorerSend.mock.calls.map(([c]) => (c as { input: unknown }).input));
  });
});

describe('previousMonth reaches only the cost summary endpoint', () => {
  it('the AI cost section (spendSection without the option) is unchanged; the summary one carries it', async () => {
    jest.setSystemTime(new Date('2026-11-01T00:37:00.000Z'));
    const { costs } = await new AIChatContextRepository({ query: jest.fn() } as unknown as Pool).gatherCostContext(ORG);
    const forAi = await spendSection(costs);
    const forSummary = await spendSection(costs, { previousMonth: true });
    expect(forAi.data).not.toHaveProperty('previousMonth');
    expect(forSummary.data?.previousMonth).toEqual({ start: '2026-10-01', endExclusive: '2026-11-01', amount: 412.3 });
  });
});

describe('cost basis strings', () => {
  it('as the AI surfaces state them', async () => {
    const mom = await collectSection({ source: 'DevControl month-over-month comparison' }, async () => ({
      state: 'available',
      data: {
        currentWindow: { start: '2026-11-01', end: '2026-11-10' }, previousWindow: { start: '2026-10-01', end: '2026-10-10' },
        currentWindowTotal: 133.0, previousWindowTotal: 126.3, changeAmount: 6.7, changePercent: 5.3, currentWindowIncludesToday: false,
        basis: COMPARISON_BASIS,
      },
    }));
    const unavailable = { state: 'unavailable', data: null, reason: 'fixture', source: 'fixture', provenance: null, asOf: null, coverage: null };
    const sections = new Proxy({ monthOverMonth: mom } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : unavailable) });
    const summaryFacts = new AISummaryService().buildFactLines(sections as never).filter((l) => l.includes('same days last month'));
    const reportSentence = (new AIReportGeneratorService({} as Pool) as unknown as { monthOverMonthSentence: (s: unknown) => string }).monthOverMonthSentence(mom);
    pin('basis.json', { aiChatComparisonBasis: COMPARISON_BASIS, aiSummaryMonthOverMonth: summaryFacts, aiReportMonthOverMonth: reportSentence });
  });
});

describe('cost socket emissions from the 30-second metrics loop', () => {
  function fakePool(costTotalRow: boolean) {
    return {
      query: jest.fn(async (sql: string) => {
        if (/FROM services/.test(sql)) return { rows: [{ total: '0', active: '0' }] };
        if (/resource_type = 'AWS_COST_TOTAL' AND aws_id/.test(sql)) return { rows: costTotalRow ? [{ cost_per_month: '99.00' }] : [] };
        if (/SUM\(cost_per_month\)/.test(sql)) return { rows: [{ total_cost: '1234.56' }] };
        if (/FROM organizations/.test(sql)) return { rows: [{ id: 'org-a' }, { id: 'org-b' }] };
        return { rows: [] };
      }),
    };
  }

  it.each([
    ['no AWS_COST_TOTAL row (sum over every organization)', false, 'socket.no-cost-total-row.json'],
    ['an AWS_COST_TOTAL row (one row, any organization)', true, 'socket.cost-total-row.json'],
  ])('%s', async (_name, costTotalRow, file) => {
    const ws = { emitToOrganization: jest.fn() };
    await (updateBusinessMetrics as (pool: unknown, ws?: unknown) => Promise<void>)(fakePool(costTotalRow), ws);
    pin(file, ws.emitToOrganization.mock.calls.map(([org, event, data]) => {
      const rest = { ...(data as Record<string, unknown>) };
      delete rest.timestamp;
      return { org, event, data: rest };
    }));
  });
});
