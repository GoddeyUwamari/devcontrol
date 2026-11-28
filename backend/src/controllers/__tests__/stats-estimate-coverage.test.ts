/**
 * Placeholder-costs PR 1 (F-5, D1/D2): GET /api/platform/stats/dashboard carries the
 * K of N coverage of an inventory estimate (cost_estimate_coverage), so the by-team
 * and Infrastructure cards can say "Estimated from K of N priced resources"; billed
 * spend carries none.
 */
jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

import awsCostService from '../../services/aws-cost.service';
import { StatsController } from '../stats.controller';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };

async function stats(fallback: Awaited<ReturnType<typeof awsCostService.getMonthlySpendWithFallback>>) {
  jest.spyOn(awsCostService, 'getMonthlySpendWithFallback').mockResolvedValue(fallback);
  ambientPool.query.mockResolvedValue({ rows: [{ total: '3', healthy: '1', counted_healthy: '0', without_state: '0' }] });
  jest.spyOn(DeploymentsRepository.prototype, 'countByStatus').mockResolvedValue(0 as never);
  jest.spyOn(DeploymentsRepository.prototype, 'findRecentByLimit').mockResolvedValue([] as never);
  const json = jest.fn();
  await new StatsController({ query: jest.fn() } as never).getDashboardStats({ user: { organizationId: 'org' } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0].data;
}

afterEach(() => jest.restoreAllMocks());

describe('dashboard stats: inventory estimate coverage', () => {
  it('an estimate carries its K of N', async () => {
    const data = await stats({ amount: 142, source: 'estimated', estimateCoverage: { pricedResources: 2, totalResources: 20, excludedResources: 0, pricedLambdaResources: 0 } });
    expect(data).toMatchObject({ total_infrastructure_cost: 142, cost_source: 'estimated', cost_estimate_coverage: { priced_resources: 2, total_resources: 20 } });
  });

  it('nothing priced: amount 0 with 0 of N (the frontend shows no figure)', async () => {
    const data = await stats({ amount: 0, source: 'estimated', estimateCoverage: { pricedResources: 0, totalResources: 20, excludedResources: 0, pricedLambdaResources: 0 } });
    expect(data).toMatchObject({ total_infrastructure_cost: 0, cost_estimate_coverage: { priced_resources: 0, total_resources: 20 } });
  });

  it('S-2: an estimate that sums a Lambda figure says how many (the label adds "Lambda before free tier")', async () => {
    const data = await stats({ amount: 142, source: 'estimated', estimateCoverage: { pricedResources: 3, totalResources: 20, excludedResources: 1, pricedLambdaResources: 1 } });
    expect(data.cost_estimate_coverage).toEqual({ priced_resources: 3, total_resources: 20, excluded_resources: 1, priced_lambda_resources: 1 });
  });

  it('billed spend carries no coverage', async () => {
    const data = await stats({ amount: 50, source: 'actual' });
    expect(data).toMatchObject({ cost_source: 'actual', cost_estimate_coverage: null });
  });
});
