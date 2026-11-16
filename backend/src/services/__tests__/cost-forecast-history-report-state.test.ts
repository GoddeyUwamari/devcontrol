/**
 * trend-lag-build.md, review L-2 and M-1: the cost forecast's history
 * (CostForecastService getHistoricalCosts, from AWSCostService.fetchCostTrend)
 *   - uses FINAL days only: never a day Cost Explorer has not reported yet
 *     (as $0 or as a filled average) and never a still-updating partial day;
 *   - fills only gaps BETWEEN real days, labelled `actual: false`, never
 *     past the last real day;
 *   - for an account that stopped spending, ends on real $0 days, so the
 *     forecast is not inflated by invented spend.
 * Inputs: the backend's output for production's 2026-11-16 7d trend
 * (fixtures/trend-lag/*.new.json), and synthetic series whose report states
 * come from the real rule (costReportStates).
 */
jest.mock('../aws-cost.service', () => ({ __esModule: true, default: { fetchCostTrend: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import awsCostService from '../aws-cost.service';
import { CostForecastService } from '../cost-forecast.service';
import { costReportStates } from '../cost-trend-report-state';

type Point = { date: Date; value: number; actual?: boolean };
interface Internals {
  getHistoricalCosts(org: string, days: number): Promise<Point[]>;
  mlService: { generateForecast(h: Point[], days: number, model: string): { predictions: Point[] } };
}

const REAL = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-16.new.json'), 'utf8',
)).data as Array<{ date: string; total: number; reportState: string }>;
const NOW = new Date('2026-11-16T11:30:00.000Z');
const day = (p: Point) => p.date.toISOString().slice(0, 10);

/** A daily trend Aug 18..Nov 16 with `amount(day)` per charged day; report states from the real rule at NOW. */
function trend(amount: (d: string) => number | null, skip: (d: string) => boolean = () => false) {
  const days: string[] = [];
  for (let t = Date.parse('2026-08-18T00:00:00Z'); t <= Date.parse('2026-11-16T00:00:00Z'); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!skip(d)) days.push(d);
  }
  const states = costReportStates(days.map((d) => ({ lastDay: d, lineItems: amount(d) === null ? 0 : 1, estimated: null })), NOW);
  return days.map((d, i) => ({ date: d, total: amount(d) ?? 0, lineItems: amount(d) === null ? 0 : 1, reportState: states[i] }));
}

let service: Internals;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  service = new CostForecastService({} as Pool) as unknown as Internals;
});
afterEach(() => jest.restoreAllMocks());

it('real evidence: final days only -- Nov 9-12; not Nov 13 (updating, partial) nor Nov 14-16 (not reported); all actual', async () => {
  (awsCostService.fetchCostTrend as jest.Mock).mockResolvedValue(REAL);
  const history = await service.getHistoricalCosts('org-test', 5);
  expect(history.map((p) => [day(p), Math.round(p.value * 10000) / 10000, p.actual])).toEqual([
    ['2026-11-09', 0.5767, true], ['2026-11-10', 0.61, true], ['2026-11-11', 0.7738, true], ['2026-11-12', 0.8319, true],
  ]);
});

it('normal lag over 90 days: no filled day after the last final day, so no invented "actual" spend', async () => {
  // $5/day charged through Nov 13 (Nov 13 updating), Nov 14-16 not reported.
  (awsCostService.fetchCostTrend as jest.Mock).mockResolvedValue(trend((d) => (d <= '2026-11-13' ? 5 : null)));
  const history = await service.getHistoricalCosts('org-test', 90);
  expect(day(history.at(-1)!)).toBe('2026-11-12');
  expect(history.every((p) => p.actual === true && p.value === 5)).toBe(true);
});

it('a gap between real days is filled with the average and labelled an estimate (actual: false)', async () => {
  (awsCostService.fetchCostTrend as jest.Mock).mockResolvedValue(trend((d) => (d <= '2026-11-13' ? (d < '2026-10-01' ? 4 : 6) : null), (d) => d === '2026-10-05'));
  const history = await service.getHistoricalCosts('org-test', 90);
  const filled = history.filter((p) => p.actual !== true);
  expect(filled.map(day)).toEqual(['2026-10-05']);
  expect(filled[0].actual).toBe(false);
  expect(day(history.at(-1)!)).toBe('2026-11-12');
});

it('M-1: an account that stopped spending (last charge Oct 20) ends on real $0 days; the forecast is not inflated', async () => {
  const stopped = trend((d) => (d <= '2026-10-20' ? 5 : null));
  (awsCostService.fetchCostTrend as jest.Mock).mockResolvedValue(stopped);
  const history = await service.getHistoricalCosts('org-test', 90);

  // Oct 21..Nov 8: real $0 days (final); Nov 9..16 (not reported) are not in it at all.
  expect(day(history.at(-1)!)).toBe('2026-11-08');
  const afterStop = history.filter((p) => day(p) > '2026-10-20');
  expect(afterStop).toHaveLength(19);
  expect(afterStop.every((p) => p.value === 0 && p.actual === true)).toBe(true);
  expect(history.some((p) => p.actual === false)).toBe(false);

  // The pre-fix history for the same data: Nov 9-16 dropped, then filled with the average and called actual.
  const charged = history.filter((p) => p.value > 0);
  const average = history.reduce((s, p) => s + p.value, 0) / history.length;
  const prefix = [...history, ...['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
    .map((d) => ({ date: new Date(`${d}T00:00:00.000Z`), value: average, actual: true }))];
  const sum30 = (h: Point[]) => service.mlService.generateForecast(h, 30, 'ensemble').predictions.reduce((s, p) => s + p.value, 0);
  expect(charged.length).toBeGreaterThan(0);
  expect(sum30(history)).toBeLessThan(sum30(prefix));
});
