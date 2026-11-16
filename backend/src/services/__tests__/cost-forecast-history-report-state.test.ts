/**
 * trend-lag-build.md: the cost forecast's history (CostForecastService
 * getHistoricalCosts, from AWSCostService.fetchCostTrend) never learns a day
 * Cost Explorer has not reported yet as a $0 day. Input: the backend's output
 * for production's 2026-11-16 7d trend (fixtures/trend-lag/*.new.json).
 */
jest.mock('../aws-cost.service', () => ({ __esModule: true, default: { fetchCostTrend: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import awsCostService from '../aws-cost.service';
import { CostForecastService } from '../cost-forecast.service';

const REAL = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-16.new.json'), 'utf8',
)).data as Array<{ date: string; total: number; reportState: string }>;

it('Nov 14-16 (not reported) are not in the history as $0; reported days keep their amounts', async () => {
  (awsCostService.fetchCostTrend as jest.Mock).mockResolvedValue(REAL);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const service = new CostForecastService({} as Pool) as unknown as { getHistoricalCosts(org: string, days: number): Promise<Array<{ date: Date; value: number }>> };
  const history = await service.getHistoricalCosts('org-test', 5);
  expect(history.map((p) => [p.date.toISOString().slice(0, 10), Math.round(p.value * 10000) / 10000])).toEqual([
    ['2026-11-09', 0.5767], ['2026-11-10', 0.61], ['2026-11-11', 0.7738], ['2026-11-12', 0.8319], ['2026-11-13', 0.0594],
  ]);
  expect(history.some((p) => p.value === 0)).toBe(false);
});
