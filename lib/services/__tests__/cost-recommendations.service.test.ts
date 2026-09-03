/**
 * Focused coverage for costRecommendationsService's transform layer -- the
 * shared boundary Dashboard, /costs, and /cost-optimization all now consume
 * (PR 1 of the DevControl cost-intelligence consolidation; Dashboard was
 * previously bypassing this service with its own raw fetch + reduce).
 *
 * These tests prove the domain-value consistency the consolidation cares
 * about: getAll() and getStats() derive potentialSavings/totalPotentialSavings
 * from the same backend field with the same numeric coercion, so no consumer
 * page can silently diverge by reimplementing the transform itself. Not
 * testing UI text/rendering -- that would be a brittle snapshot test the
 * consolidation explicitly wants to avoid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { costRecommendationsService } from '../cost-recommendations.service';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return {
    api: mockApi,
    default: mockApi,
    handleApiResponse: (response: { data: { success: boolean; data: unknown; message?: string } }) => {
      if (!response.data.success) throw new Error(response.data.message || 'API request failed');
      return response.data.data;
    },
  };
});

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);

function fakeResponse<T>(data: T) {
  return { data: { success: true, data } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('costRecommendationsService.getAll', () => {
  it('transforms potential_savings/resource_type to the camelCase fields every consumer page reads', async () => {
    mockedGet.mockResolvedValue(
      fakeResponse([
        {
          id: 'rec-1',
          resource_id: 'i-abc',
          resource_name: 'prod-api-01',
          resource_type: 'EC2',
          issue: 'Idle Instance',
          potential_savings: '127.50', // real pg NUMERIC columns come back as strings
          severity: 'HIGH',
          status: 'ACTIVE',
          aws_region: 'us-east-1',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ])
    );

    const result = await costRecommendationsService.getAll({ status: 'ACTIVE' });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'rec-1',
        resourceType: 'EC2',
        potentialSavings: 127.5,
        severity: 'HIGH',
        status: 'ACTIVE',
      }),
    ]);
  });

  it('coerces a missing/null potential_savings to 0 rather than NaN', async () => {
    mockedGet.mockResolvedValue(
      fakeResponse([{ id: 'rec-1', resource_type: 'EC2', issue: 'x', potential_savings: null, severity: 'LOW', status: 'ACTIVE' }])
    );

    const [result] = await costRecommendationsService.getAll({ status: 'ACTIVE' });

    expect(result.potentialSavings).toBe(0);
  });
});

describe('costRecommendationsService.getStats', () => {
  it('transforms total_potential_savings to totalPotentialSavings with the same numeric coercion as getAll', async () => {
    mockedGet.mockResolvedValue(
      fakeResponse({
        total_recommendations: 2,
        active_recommendations: 2,
        total_potential_savings: '212.75',
        by_severity: { high: 1, medium: 0, low: 1 },
      })
    );

    const stats = await costRecommendationsService.getStats();

    expect(stats.totalPotentialSavings).toBe(212.75);
    expect(stats.activeRecommendations).toBe(2);
    expect(stats.bySeverity).toEqual({ high: 1, medium: 0, low: 1 });
  });
});

describe('cross-method consistency (the actual domain-value guarantee behind Dashboard/costs/cost-optimization)', () => {
  it('getAll()-summed potentialSavings equals getStats().totalPotentialSavings for the same underlying total', async () => {
    // Same fixture total ($212.75) served through both endpoints, as the
    // real backend does (both derive from the same SUM(potential_savings)
    // WHERE status='ACTIVE' query) -- proves the frontend transform layer
    // doesn't introduce its own divergent rounding/calculation between the
    // two methods Dashboard (getStats) and /cost-optimization (getAll) use
    // for the same aggregate figure.
    mockedGet.mockResolvedValueOnce(
      fakeResponse([
        { id: 'rec-1', resource_type: 'EC2', issue: 'a', potential_savings: '127.50', severity: 'HIGH', status: 'ACTIVE' },
        { id: 'rec-2', resource_type: 'RDS', issue: 'b', potential_savings: '85.25', severity: 'MEDIUM', status: 'ACTIVE' },
      ])
    );
    mockedGet.mockResolvedValueOnce(
      fakeResponse({
        total_recommendations: 2,
        active_recommendations: 2,
        total_potential_savings: '212.75',
        by_severity: { high: 1, medium: 1, low: 0 },
      })
    );

    const list = await costRecommendationsService.getAll({ status: 'ACTIVE' });
    const stats = await costRecommendationsService.getStats();

    const summedFromList = list.reduce((sum, r) => sum + r.potentialSavings, 0);
    expect(summedFromList).toBe(stats.totalPotentialSavings);
  });
});

describe('costRecommendationsService.analyze', () => {
  it('transforms the analyze response used by /cost-optimization "Run scan" and /infrastructure/recommendations "Analyze Costs"', async () => {
    mockedPost.mockResolvedValue(
      fakeResponse({
        recommendationsFound: 3,
        totalPotentialSavings: '212.75',
        bySeverity: { high: 1, medium: 1, low: 1 },
        timestamp: '2026-09-03T00:00:00Z',
      })
    );

    const result = await costRecommendationsService.analyze();

    expect(mockedPost).toHaveBeenCalledWith('/api/cost-recommendations/analyze');
    expect(result).toEqual({
      recommendationsFound: 3,
      totalPotentialSavings: 212.75,
      bySeverity: { high: 1, medium: 1, low: 1 },
      timestamp: '2026-09-03T00:00:00Z',
    });
  });
});
