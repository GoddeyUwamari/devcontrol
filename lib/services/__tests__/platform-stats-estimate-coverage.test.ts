/**
 * Placeholder-costs PR 1 (F-5, D2): the dashboard stats mapper keeps the backend's
 * K of N coverage of an inventory estimate, and only a well-formed one.
 */
import { describe, it, expect, vi } from 'vitest'

const mockGet = vi.fn()
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
  handleApiResponse: <T,>(response: { data: { success: boolean; data: T } }): T => response.data.data,
}))

import { platformStatsService } from '../platform-stats.service'

const stats = (extra: Record<string, unknown>) => {
  mockGet.mockResolvedValue({ data: { success: true, data: { total_services: 3, total_infrastructure_cost: 142, cost_source: 'estimated', ...extra } } })
  return platformStatsService.getDashboardStats()
}

describe('platformStatsService.getDashboardStats: costEstimateCoverage', () => {
  it('maps priced/total', async () => {
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20 } })).costEstimateCoverage).toEqual({ pricedResources: 2, totalResources: 20 })
  })

  it('fix round 1 (ruling 9): maps excluded (M) when well-formed, drops it otherwise', async () => {
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20, excluded_resources: 3 } })).costEstimateCoverage).toEqual({ pricedResources: 2, totalResources: 20, excludedResources: 3 })
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20, excluded_resources: -1 } })).costEstimateCoverage).toEqual({ pricedResources: 2, totalResources: 20 })
  })

  it('review fix round (S-2): maps priced Lambda figures when well-formed, drops them otherwise', async () => {
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20, excluded_resources: 0, priced_lambda_resources: 1 } })).costEstimateCoverage)
      .toEqual({ pricedResources: 2, totalResources: 20, excludedResources: 0, pricedLambdaResources: 1 })
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20, priced_lambda_resources: 3 } })).costEstimateCoverage).toEqual({ pricedResources: 2, totalResources: 20 })
    expect((await stats({ cost_estimate_coverage: { priced_resources: 2, total_resources: 20, priced_lambda_resources: '1' } })).costEstimateCoverage).toEqual({ pricedResources: 2, totalResources: 20 })
  })

  it.each([
    ['absent', {}],
    ['null', { cost_estimate_coverage: null }],
    ['priced above total', { cost_estimate_coverage: { priced_resources: 5, total_resources: 2 } }],
    ['not integers', { cost_estimate_coverage: { priced_resources: '2', total_resources: 20 } }],
    ['negative', { cost_estimate_coverage: { priced_resources: -1, total_resources: 20 } }],
  ])('%s -> null', async (_name, extra) => {
    expect((await stats(extra)).costEstimateCoverage).toBeNull()
  })
})
