/**
 * Trend-lag round 2, the forecast follow-ups from trend-lag-review.md:
 *   - R3-L3: history ends on the last FINISHED day, a few days before today.
 *     The period totals (predicted30Day ..) start at today (UTC), not at the
 *     day after the last finished day, and the response says where
 *     (forecastStartDate) so the page can put its "Today" marker there.
 *   - R3-L4: fewer than 7 finished days is a state (422 with a code), not a
 *     server error; estimated gap fills do not count as finished days. A
 *     failed Cost Explorer read is still an error (500), never "not enough
 *     history".
 * Cost Explorer is a stub (fetchCostTrend); no AWS, database or model call.
 */
jest.mock('../aws-cost.service', () => ({ __esModule: true, default: { fetchCostTrend: jest.fn() } }));

import type { Pool } from 'pg';
import awsCostService from '../aws-cost.service';
import { CostForecastService, InsufficientForecastHistoryError, MIN_FINISHED_FORECAST_DAYS } from '../cost-forecast.service';
import { costReportStates } from '../cost-trend-report-state';
import { ForecastController } from '../../controllers/forecast.controller';

const NOV17 = new Date('2026-11-17T03:00:00.000Z');
const fetchCostTrend = awsCostService.fetchCostTrend as jest.Mock;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** A daily trend `from`..Nov 17 with `amount(day)` per charged day (null = no line items); states from the real rule at Nov 17. */
function trend(from: string, amount: (d: string) => number | null) {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse('2026-11-17T00:00:00Z'); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const states = costReportStates(days.map((d) => ({ lastDay: d, lineItems: amount(d) === null ? 0 : 1, estimated: null })), NOV17);
  return days.map((d, i) => ({ date: d, total: amount(d) ?? 0, lineItems: amount(d) === null ? 0 : 1, reportState: states[i] }));
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fetchCostTrend.mockReset();
});
afterEach(() => jest.restoreAllMocks());

describe('R3-L3: the forecast starts at today', () => {
  it('the Nov 17 shape (rising daily spend through Nov 13, Nov 14-17 not reported): history ends Nov 12, predictions continue from Nov 13, totals start Nov 17', async () => {
    // Rising by a cent a day, so a window that starts 4 days earlier sums to a different total.
    fetchCostTrend.mockResolvedValue(trend('2026-08-19', (d) => (d <= '2026-11-13' ? 5 + (Date.parse(d) - Date.parse('2026-08-19')) / 8_640_000_000 : null)));
    const f = await new CostForecastService({} as Pool).generateForecast('org-test', '90d', NOV17);

    expect(day(f.historicalEndDate)).toBe('2026-11-12');
    expect(day(f.predictionStartDate)).toBe('2026-11-13');
    expect(day(f.forecastStartDate!)).toBe('2026-11-17');
    // Nov 13-16 (not finished yet) are predicted too, then 90 days from today.
    expect(f.predictions).toHaveLength(4 + 90);
    const sum = (from: number, n: number) => f.predictions.slice(from, from + n).reduce((s, p) => s + p.value, 0);
    expect(day(f.predictions[4].date)).toBe('2026-11-17');
    expect(f.predicted30Day).toBeCloseTo(sum(4, 30), 9);
    expect(f.predicted90Day).toBeCloseTo(sum(4, 90), 9);
    // Not the old window that began at the day after the last finished day.
    expect(f.predicted30Day).not.toBeCloseTo(sum(0, 30), 9);
  });

  it('history that ends yesterday (no lead): predictions and totals both start today', async () => {
    fetchCostTrend.mockResolvedValue(trend('2026-08-19', (d) => (d <= '2026-11-17' ? 5 : null)).map((p) => ({ ...p, reportState: p.date <= '2026-11-16' ? 'final' : 'updating' })));
    const f = await new CostForecastService({} as Pool).generateForecast('org-test', '30d', NOV17);
    expect(day(f.historicalEndDate)).toBe('2026-11-16');
    expect(day(f.predictionStartDate)).toBe('2026-11-17');
    expect(day(f.forecastStartDate!)).toBe('2026-11-17');
    expect(f.predictions).toHaveLength(30);
  });
});

describe('R3-L4: fewer than 7 finished days', () => {
  it('a new account with 4 finished days: InsufficientForecastHistoryError(4), not a generic error', async () => {
    fetchCostTrend.mockResolvedValue(trend('2026-11-09', (d) => (d <= '2026-11-13' ? 2 : null)));
    const err = await new CostForecastService({} as Pool).generateForecast('org-test', '90d', NOV17).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientForecastHistoryError);
    expect(err).toMatchObject({ code: 'INSUFFICIENT_FORECAST_HISTORY', finishedDays: 4, requiredDays: MIN_FINISHED_FORECAST_DAYS });
    expect(MIN_FINISHED_FORECAST_DAYS).toBe(7);
  });

  it('estimated gap fills do not count: 6 finished days spread over 11 days is still not enough', async () => {
    const charged = new Set(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08', '2026-11-10', '2026-11-12', '2026-11-13']);
    // Nov 13 is updating; the finished days are the other six, with zero-line-item days dropped from the input entirely.
    fetchCostTrend.mockResolvedValue(trend('2026-11-01', (d) => (charged.has(d) ? 3 : d > '2026-11-13' ? null : 0)).filter((p) => charged.has(p.date) || p.date > '2026-11-13'));
    const err = await new CostForecastService({} as Pool).generateForecast('org-test', '90d', NOV17).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientForecastHistoryError);
    expect(err.finishedDays).toBe(6);
  });

  it('exactly 7 finished days forecasts', async () => {
    fetchCostTrend.mockResolvedValue(trend('2026-11-06', (d) => (d <= '2026-11-13' ? 2 : null)));
    const f = await new CostForecastService({} as Pool).generateForecast('org-test', '30d', NOV17);
    expect(f.historicalData.filter((p) => p.actual !== false)).toHaveLength(7);
  });
});

describe('the API', () => {
  const call = async () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    await new ForecastController({} as Pool).getForecast({ user: { organizationId: 'org-test' }, query: {} } as never, { json, status } as never);
    return { status, json };
  };

  it('fewer than 7 finished days: 422 with the code and the counts, never a 500', async () => {
    fetchCostTrend.mockResolvedValue(trend('2026-11-10', (d) => (d <= '2026-11-13' ? 2 : null)));
    const { status, json } = await call();
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'INSUFFICIENT_FORECAST_HISTORY', finishedDays: 3, requiredDays: 7 }));
  });

  it('a failed Cost Explorer read is still a 500 "Failed to generate forecast", not "not enough history"', async () => {
    fetchCostTrend.mockRejectedValue(new Error('AccessDenied'));
    const { status, json } = await call();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to generate forecast' });
  });
});
