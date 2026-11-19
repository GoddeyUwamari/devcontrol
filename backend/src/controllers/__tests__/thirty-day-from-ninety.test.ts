/**
 * CE-2 (review-logs/cost-explorer/ce1-build.md, founder decisions 2026-11-19):
 * the 30-day cost trend is served from the 90-day Cost Explorer result, with
 * each day's report state decided again over the 30-day slice. Nothing a user
 * sees may change: the 7-day chart, the 30-day view, the 90-day view and the
 * weekly email's trend section.
 *
 * BEFORE / AFTER. Each case's responses were pinned in __fixtures__/ce2/ at
 * c8a09ea0, BEFORE the change, when 30d was its own Cost Explorer request:
 *   CE2_FIXTURES=write npx jest thirty-day-from-ninety
 * After the change, the same Cost Explorer data must produce byte-identical
 * responses. Rewriting the fixtures after the change would defeat the test:
 * they are only ever written at a commit whose 30d is its own request.
 *
 * Cases (Cost Explorer stubbed by a per-day ledger that answers any DAILY
 * period, as Cost Explorer does; STS and the database stubbed):
 *   - Today bar ledgers at 2026-11-18 15:00 UTC (today-bar-shared-states):
 *     partial, absent, zero, stopped3, stopped10, quiet;
 *   - stopped30 / stopped31 / stopped45 / stopped89: the last charge at
 *     today-30 (the 30d window's first day), today-31, today-45, today-89.
 *     A 90-day series has line items there and a 30-day one has none, the
 *     case where 90-day states would differ (ce1-build.md A4 (i));
 *   - oldbig: a large service charged only 40-90 days ago, so the top
 *     services over 90 days are not the top services over 30;
 *   - the round-2 production evidence (trend-lag-real-evidence): the
 *     2026-11-16 ~11:30 UTC capture as is, the same with Estimated on every
 *     November day, and 2026-11-17 12:00 UTC with nothing after Nov 13;
 *   - a month boundary (2026-12-01 00:30 UTC) and a year boundary
 *     (2027-01-01 00:10 UTC).
 * No AWS, database or model call.
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

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import awsCostService, { type CostTrendPoint, type CostTrendRange } from '../../services/aws-cost.service';
import { StatsController } from '../stats.controller';
import { WeeklySummaryRepository } from '../../repositories/weekly-summary.repository';
import { ACCOUNT_ROW, type CeInput } from './dashboard-money-fixtures';
import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };
const ORG = ACCOUNT_ROW.org_id;
const DIR = path.join(__dirname, '__fixtures__', 'ce2');
const WRITE = process.env.CE2_FIXTURES === 'write';

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

type Services = Array<[service: string, amount: number]>;
interface Ledger {
  services: (day: string) => Services;
  /** ResultByTime.Estimated per day; undefined leaves the field out. */
  estimated?: (day: string) => boolean | undefined;
}

// --- Today bar ledgers (today-bar-shared-states.test.ts) -------------------
const BAR_NOW = '2026-11-18T15:00:00.000Z';
const BAR_TODAY = '2026-11-18';
const FULL_DAY: Services = [
  ['Amazon Elastic Compute Cloud - Compute', 1.2],
  ['Amazon Simple Storage Service', 0.3],
  ['AmazonCloudWatch', 0.05],
];
const through = (last: string): Ledger => ({ services: (day) => (day <= last ? FULL_DAY : []), estimated: () => true });

// --- Round-2 production evidence (trend-lag-real-evidence.test.ts) ---------
interface EvidencePoint { date: string; lineItems: number; byService: { service: string; amount: number }[] }
const REAL: EvidencePoint[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'trend-lag', 'trend-7d-2026-11-16.json'), 'utf8')
).data;
const REAL_BY_DAY = new Map(REAL.map((p) => [p.date.slice(0, 10), p]));
const FIRST_REAL = REAL[0].date.slice(0, 10);
const asServices = (list: { service: string; amount: number }[]): Services => list.map((s) => [s.service, s.amount]);
/** The real groups Nov 9-16, Nov 9's before that (synthetic, as in trend-lag-real-evidence), none past `last`. */
const evidence = (last?: string) => (day: string): Services => {
  if (last !== undefined) {
    if (day > last) return [];
    const real = REAL_BY_DAY.get(day);
    return asServices(real && real.lineItems > 0 ? real.byService : REAL[0].byService);
  }
  if (day < FIRST_REAL) return asServices(REAL[0].byService);
  return asServices(REAL_BY_DAY.get(day)?.byService ?? []);
};

const CASES: Record<string, { now: string; ledger: Ledger }> = {
  partial: {
    now: BAR_NOW,
    ledger: { services: (day) => (day < BAR_TODAY ? FULL_DAY : FULL_DAY.map(([s, a]) => [s, Math.round(a * 0.14 * 100) / 100])), estimated: () => true },
  },
  absent: { now: BAR_NOW, ledger: through('2026-11-17') },
  zero: { now: BAR_NOW, ledger: { services: (day) => (day < BAR_TODAY ? FULL_DAY : FULL_DAY.map(([s]) => [s, 0])), estimated: () => true } },
  stopped3: { now: BAR_NOW, ledger: through('2026-11-14') },
  stopped10: { now: BAR_NOW, ledger: through('2026-11-08') },
  quiet: { now: BAR_NOW, ledger: { services: () => [], estimated: () => true } },
  stopped30: { now: BAR_NOW, ledger: through(addDays(BAR_TODAY, -30)) },
  stopped31: { now: BAR_NOW, ledger: through(addDays(BAR_TODAY, -31)) },
  stopped45: { now: BAR_NOW, ledger: through(addDays(BAR_TODAY, -45)) },
  stopped89: { now: BAR_NOW, ledger: through(addDays(BAR_TODAY, -89)) },
  oldbig: {
    now: BAR_NOW,
    ledger: {
      services: (day) =>
        day >= addDays(BAR_TODAY, -90) && day <= addDays(BAR_TODAY, -40)
          ? [...FULL_DAY, ['Amazon Redshift', 500]]
          : FULL_DAY,
      estimated: (day) => day >= addDays(BAR_TODAY, -1),
    },
  },
  'evidence-2026-11-16': { now: '2026-11-16T11:30:00.000Z', ledger: { services: evidence() } },
  'evidence-2026-11-16-estimated': {
    now: '2026-11-16T11:30:00.000Z',
    ledger: { services: evidence(), estimated: (day) => day >= '2026-11-01' },
  },
  'evidence-2026-11-17-through-13': { now: '2026-11-17T12:00:00.000Z', ledger: { services: evidence('2026-11-13') } },
  'month-boundary': { now: '2026-12-01T00:30:00.000Z', ledger: through('2026-11-29') },
  'year-boundary': { now: '2027-01-01T00:10:00.000Z', ledger: through('2026-12-30') },
};

function ceResponse(input: CeInput, ledger: Ledger) {
  const { Start, End } = input.TimePeriod;
  if (input.Granularity !== 'DAILY') throw new Error('daily ranges only in this test');
  const results: Array<Record<string, unknown>> = [];
  for (let d = Start; d < End; d = addDays(d, 1)) {
    const est = ledger.estimated?.(d);
    results.push({
      TimePeriod: { Start: d, End: addDays(d, 1) },
      Total: {},
      Groups: ledger.services(d).map(([service, amount]) => ({ Keys: [service], Metrics: { UnblendedCost: { Amount: String(amount), Unit: 'USD' } } })),
      ...(est === undefined ? {} : { Estimated: est }),
    });
  }
  return { ResultsByTime: results, DimensionValueAttributes: [], GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }] };
}

function clearCostCaches(): void {
  for (const key of ['monthlyCostCache', 'monthlyCostInFlight', 'costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
}

function useCase(name: string): void {
  clearCostCaches();
  jest.setSystemTime(new Date(CASES[name].now));
  mockCostExplorerSend.mockImplementation(async (command: { input: CeInput }) => ceResponse(command.input, CASES[name].ledger));
}

async function trendEndpoint(range: CostTrendRange): Promise<{ success: boolean; data: CostTrendPoint[] }> {
  const json = jest.fn();
  await new StatsController({ query: ambientPool.query } as unknown as Pool)
    .getCostTrend({ user: { organizationId: ORG }, query: { range } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

/**
 * Everything a user can see from the trend requests, one compact JSON value per
 * line. The 90d body (unchanged code, and three times the size) is pinned by
 * its SHA-256 and its per-day states, so the fixtures stay small.
 */
async function observed(): Promise<string> {
  const trend30 = await trendEndpoint('30d');
  const trend7 = await trendEndpoint('7d');
  const trend90 = await trendEndpoint('90d');
  const weeklyTrendSection = await new WeeklySummaryRepository({} as Pool).getCostTrendSection(ORG);
  const fetchedAt = {
    '7d': await awsCostService.getCostTrendFetchedAt(ORG, '7d'),
    '30d': await awsCostService.getCostTrendFetchedAt(ORG, '30d'),
    '90d': await awsCostService.getCostTrendFetchedAt(ORG, '90d'),
  };
  const trend90Pin = {
    sha256: createHash('sha256').update(JSON.stringify(trend90)).digest('hex'),
    states: Object.fromEntries(trend90.data.map((p) => [p.date, p.reportState])),
  };
  const doc: Record<string, unknown> = { trend30, trend7, weeklyTrendSection, fetchedAt, trend90: trend90Pin };
  return `{
${Object.entries(doc).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}
}
`;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockCostExplorerSend.mockReset();
  ambientPool.query.mockReset().mockImplementation(async () => ({ rows: [ACCOUNT_ROW] }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(Object.keys(CASES))('%s', (name) => {
  it('7d, 30d, 90d and the weekly email trend section are byte-identical to the responses pinned before CE-2', async () => {
    useCase(name);
    const body = await observed();
    const file = path.join(DIR, `${name}.json`);
    if (WRITE) {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, body);
    }
    expect(body).toBe(fs.readFileSync(file, 'utf8'));
  });
});

describe('the fixtures exercise the cases that matter', () => {
  const pinned = (name: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const states = (points: CostTrendPoint[]) => new Set(points.map((p) => p.reportState));

  it('30d has 31 days (today-30 .. today) and 7d 8 days in every case', () => {
    for (const name of Object.keys(CASES)) {
      expect([name, pinned(name).trend30.data.length, pinned(name).trend7.data.length]).toEqual([name, 31, 8]);
    }
  });

  it('a last charge 31-90 days ago: final $0 days in 30d, but not reported in 90d (states decided per view)', () => {
    for (const name of ['stopped31', 'stopped45', 'stopped89']) {
      const p = pinned(name);
      expect([name, [...states(p.trend30.data)]]).toEqual([name, ['final']]);
      expect([name, Object.values(p.trend90.states).includes('not_reported')]).toEqual([name, true]);
    }
  });

  it('oldbig: the 30d top services leave out the service charged only 40-90 days ago', () => {
    const p = pinned('oldbig');
    const display30 = p.trend30.data[0].byServiceDisplay.map((s: { service: string }) => s.service);
    expect(display30.length).toBeGreaterThan(0);
    expect(display30.some((name: string) => /redshift/i.test(name))).toBe(false);
    // ...while the Cost Explorer data the case serves does include it (90 days).
    expect(CASES.oldbig.ledger.services(addDays(BAR_TODAY, -50)).some(([s]) => /Redshift/.test(s))).toBe(true);
  });

  it('round 2: Nov 13 is updating and Nov 14-17 not reported in 30d at 2026-11-17', () => {
    const byDay = Object.fromEntries(pinned('evidence-2026-11-17-through-13').trend30.data.map((p: CostTrendPoint) => [p.date, p.reportState]));
    expect([byDay['2026-11-13'], byDay['2026-11-14'], byDay['2026-11-17']]).toEqual(['updating', 'not_reported', 'not_reported']);
  });
});
