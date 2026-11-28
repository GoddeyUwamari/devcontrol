/**
 * PR B (dashboard redesign groundwork), B1 + B2 on the cost trend:
 *   B1  every point carries netTotal, the unclamped Σ byService[].amount (a
 *       credit is never lost to the $0 floor), for 7d, 30d and 90d alike;
 *       `total` and byServiceDisplay stay floored exactly as before.
 *   B2  GET /api/platform/costs/trend adds a range-level otherServices: the
 *       display names byServiceDisplay folds into "Other", amount desc then
 *       name, never a top-7 name, never twice; computed without changing the
 *       cached 90d points; the Costs page's points are unchanged.
 * Cost Explorer, STS and the database are stubs (no AWS or database call).
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

import type { Pool } from 'pg';
import type { Request, Response } from 'express';
import awsCostService, { AWSCostService, normalizeServiceName, otherServicesFrom, trendPointNet, type CostTrendPoint, type CostTrendRange } from '../aws-cost.service';
import { ACCOUNT_ROW } from '../../controllers/__tests__/dashboard-money-fixtures';
import { StatsController } from '../../controllers/stats.controller';

const ORG = ACCOUNT_ROW.org_id;
const NOW = '2026-11-16T11:30:00Z';
const RANGES: CostTrendRange[] = ['7d', '30d', '90d'];

type Ledger = ReadonlyArray<readonly [string, number]>;
let ledgerFor: (day: string) => Ledger;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A DAILY GetCostAndUsage response, SERVICE-grouped, from ledgerFor(day). */
function ceResponse(input: { TimePeriod: { Start: string; End: string } }) {
  const results = [];
  for (let d = input.TimePeriod.Start; d < input.TimePeriod.End; d = addDays(d, 1)) {
    results.push({
      TimePeriod: { Start: d, End: addDays(d, 1) },
      Total: {},
      Groups: ledgerFor(d).map(([service, amount]) => ({ Keys: [service], Metrics: { UnblendedCost: { Amount: String(amount), Unit: 'USD' } } })),
      Estimated: false,
    });
  }
  return { ResultsByTime: results, DimensionValueAttributes: [], GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }] };
}

let service: AWSCostService;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(new Date(NOW));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockCostExplorerSend.mockReset();
  mockCostExplorerSend.mockImplementation(async (command: { input: { TimePeriod: { Start: string; End: string } } }) => ceResponse(command.input));
  service = new AWSCostService({ query: jest.fn(async () => ({ rows: [ACCOUNT_ROW] })) } as unknown as Pool);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** The cached 90d entry's points (the only cache entry these ranges use). */
function cachedPoints(): CostTrendPoint[] {
  const entries = [...((service as unknown as { costTrendCache: Map<string, { data: CostTrendPoint[] }> }).costTrendCache.values())];
  expect(entries).toHaveLength(1);
  return entries[0].data;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pointOn = (points: CostTrendPoint[], day: string) => points.find((p) => p.date === day)!;

describe('B1: netTotal is the unclamped net of byService, on every range', () => {
  const CREDIT_DAY = '2026-11-14';
  const NEGATIVE_DAY = '2026-11-13';

  beforeEach(() => {
    ledgerFor = (day) => {
      if (day === CREDIT_DAY) return [['Amazon Elastic Compute Cloud - Compute', 10], ['Amazon Simple Storage Service', -5]];
      if (day === NEGATIVE_DAY) return [['Amazon Elastic Compute Cloud - Compute', 1], ['Amazon Simple Storage Service', -2.2]];
      return [['Amazon Elastic Compute Cloud - Compute', 3], ['Amazon Simple Storage Service', 1.5], ['AWS Lambda', 0.25]];
    };
  });

  it.each(RANGES)('%s: positive-only days are exactly as before (netTotal = total, segments unchanged)', async (range) => {
    const points = await service.fetchCostTrend(ORG, range);
    const plain = points.filter((p) => p.date !== CREDIT_DAY && p.date !== NEGATIVE_DAY);
    expect(plain.length).toBeGreaterThan(0);
    for (const p of plain) {
      expect(p.total).toBeCloseTo(4.75, 10);
      expect(p.netTotal).toBeCloseTo(p.total, 10);
      expect(p.byServiceDisplay).toEqual([
        { service: 'EC2', amount: 3, color: expect.any(String) },
        { service: 'S3', amount: 1.5, color: expect.any(String) },
        { service: 'Lambda', amount: 0.25, color: expect.any(String) },
      ]);
    }
  });

  it.each(RANGES)('%s: a mixed day (+$10 and a -$5 credit) has netTotal $5; total and the segments stay floored', async (range) => {
    const day = pointOn(await service.fetchCostTrend(ORG, range), CREDIT_DAY);
    expect(day.netTotal).toBeCloseTo(5, 10);
    // Display/legacy fields unchanged: categories floored ($10 compute + $0 storage), S3 segment $0.
    expect(day.total).toBe(10);
    expect(day.byServiceDisplay!.find((s) => s.service === 'S3')!.amount).toBe(0);
    expect(day.byService).toEqual([
      { service: 'Amazon Elastic Compute Cloud - Compute', amount: 10 },
      { service: 'Amazon Simple Storage Service', amount: -5 },
    ]);
  });

  it.each(RANGES)('%s: a net-negative day keeps its real negative net (-$1.20), never $0', async (range) => {
    const day = pointOn(await service.fetchCostTrend(ORG, range), NEGATIVE_DAY);
    expect(day.netTotal).toBeCloseTo(-1.2, 10);
    expect(day.total).toBe(1);
  });

  it('netTotal is trendPointNet(): Σ byService, null without byService, 0 for a day with no line items', () => {
    expect(trendPointNet({ byService: [{ amount: 10 }, { amount: -5 }, { amount: 0.25 }] })).toBeCloseTo(5.25, 10);
    expect(trendPointNet({ byService: [] })).toBe(0);
    expect(trendPointNet({})).toBeNull();
    expect(trendPointNet({ byService: null })).toBeNull();
  });
});

const TEN: Ledger = [
  ['Amazon Elastic Compute Cloud - Compute', 50],
  ['Amazon Relational Database Service', 40],
  ['Amazon Simple Storage Service', 30],
  ['AWS Lambda', 20],
  ['Amazon DynamoDB', 15],
  ['Amazon CloudFront', 12],
  ['AWS Key Management Service', 10],
  // Folded into Other: SQS $3, then SNS and Glue tied at $2 (name order: Glue, SNS).
  ['Amazon Simple Queue Service', 3],
  ['Amazon Simple Notification Service', 2],
  ['AWS Glue', 2],
];

describe('B2: otherServices lists exactly the names folded into "Other"', () => {
  it.each(RANGES)('%s: fewer than 8 services -> empty', async (range) => {
    ledgerFor = () => TEN.slice(0, 4);
    expect(otherServicesFrom(await service.fetchCostTrend(ORG, range))).toEqual([]);
  });

  it.each(RANGES)('%s: exactly 7 services -> empty (no "Other" segment either)', async (range) => {
    ledgerFor = () => TEN.slice(0, 7);
    const points = await service.fetchCostTrend(ORG, range);
    expect(otherServicesFrom(points)).toEqual([]);
    expect(points[0].byServiceDisplay!.map((s) => s.service)).not.toContain('Other');
  });

  it.each(RANGES)('%s: 10 services -> the 3 outside the top 7, amount desc then name, none of the top 7', async (range) => {
    ledgerFor = () => TEN;
    const points = await service.fetchCostTrend(ORG, range);
    const other = otherServicesFrom(points);
    expect(other).toEqual(['SQS', 'Glue', 'SNS']);
    const top = points[0].byServiceDisplay!.map((s) => s.service).filter((s) => s !== 'Other');
    expect(top).toEqual(['EC2', 'RDS', 'S3', 'Lambda', 'DynamoDB', 'CloudFront', 'KMS']);
    for (const name of top) expect(other).not.toContain(name);
    expect(new Set([...top, ...other]).size).toBe(10);
  });

  it.each(RANGES)('%s: the range decides membership (a service big only before the 30d window is folded in 7d and 30d)', async (range) => {
    // RDS is $400/day before Oct 1 (inside 90d only; 30d starts Oct 17) and $1/day after: top in 90d, Other in 7d and 30d.
    ledgerFor = (day) => TEN.map(([s, a]) => [s, s === 'Amazon Relational Database Service' ? (day < '2026-10-01' ? 400 : 1) : a] as const);
    const other = otherServicesFrom(await service.fetchCostTrend(ORG, range));
    if (range === '90d') expect(other).not.toContain('RDS');
    else expect(other).toContain('RDS');
  });

  it('raw names that normalize to one display name appear once', async () => {
    expect(normalizeServiceName('AmazonCloudWatch')).toBe('CloudWatch');
    expect(normalizeServiceName('Amazon CloudWatch')).toBe('CloudWatch');
    ledgerFor = () => [...TEN.slice(0, 7), ['AmazonCloudWatch', 1], ['Amazon CloudWatch', 0.5], ['Amazon Simple Queue Service', 3]];
    for (const range of RANGES) {
      const other = otherServicesFrom(await service.fetchCostTrend(ORG, range));
      expect(other).toEqual(['SQS', 'CloudWatch']);
    }
  });

  it('computing it (and serving 7d/30d/90d) never changes the cached 90d points', async () => {
    ledgerFor = (day) => (day === '2026-11-14' ? [...TEN, ['Amazon Elastic Block Store', -4]] : TEN);
    await service.fetchCostTrend(ORG, '90d');
    const before = JSON.stringify(cachedPoints());
    for (const range of RANGES) otherServicesFrom(await service.fetchCostTrend(ORG, range));
    expect(JSON.stringify(cachedPoints())).toBe(before);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/platform/costs/trend: additive fields only; the Costs page points are unchanged', () => {
  function mockReqRes(range: string) {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const req = { user: { organizationId: ORG }, query: { range } } as unknown as Request;
    const res = { json, status } as unknown as Response;
    return { req, res, json, status };
  }

  /** byServiceDisplay as the pre-PR-B code built it (top 7 by range total + floored "Other"), written out independently. */
  function referenceDisplay(points: CostTrendPoint[]) {
    const totals = new Map<string, number>();
    for (const p of points) for (const { service: s, amount } of p.byService ?? []) totals.set(normalizeServiceName(s), (totals.get(normalizeServiceName(s)) ?? 0) + amount);
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([n]) => n);
    return points.map((p) => {
      const day = new Map<string, number>();
      for (const { service: s, amount } of p.byService ?? []) day.set(normalizeServiceName(s), (day.get(normalizeServiceName(s)) ?? 0) + amount);
      const rows = top.map((n) => ({ service: n, amount: Math.max(0, day.get(n) ?? 0) }));
      if (totals.size > top.length) rows.push({ service: 'Other', amount: Math.max(0, sum([...day.entries()].filter(([n]) => !top.includes(n)).map(([, a]) => a))) });
      return rows;
    });
  }

  it.each(RANGES)('%s: body is { success, data, otherServices }; data is the service points, segments as before', async (range) => {
    ledgerFor = (day) => (day === '2026-11-14' ? [...TEN, ['Amazon Elastic Block Store', -4]] : TEN);
    const points = await service.fetchCostTrend(ORG, range);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(points);
    const { req, res, json, status } = mockReqRes(range);

    await new StatsController({ query: jest.fn() } as unknown as Pool).getCostTrend(req, res);

    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(['success', 'data', 'otherServices']);
    expect(body.success).toBe(true);
    expect(body.data).toBe(points);
    expect(body.otherServices).toEqual(otherServicesFrom(points));
    // EBS (an 11th service, a -$4 credit on one day) is folded into Other too: listed, last by amount.
    expect(body.otherServices).toEqual(['SQS', 'Glue', 'SNS', 'EBS']);
    // What the Costs page reads (total, byServiceDisplay) is the pre-PR-B result.
    expect(body.data.map((p: CostTrendPoint) => p.byServiceDisplay!.map(({ service: s, amount }) => ({ service: s, amount })))).toEqual(referenceDisplay(points));
    for (const p of body.data as CostTrendPoint[]) {
      expect(p.total).toBeCloseTo(p.compute + p.storage + p.database + p.network + p.other, 10);
      expect(Object.keys(p).sort()).toEqual(['byService', 'byServiceDisplay', 'compute', 'database', 'date', 'estimated', 'lineItems', 'netTotal', 'network', 'other', 'provisional', 'reportState', 'storage', 'total']);
    }
  });
});
