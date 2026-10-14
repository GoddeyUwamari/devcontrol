/**
 * GET /api/metrics/dora refuses a request that carries no organization
 * before anything is computed -- it never answers with an unscoped (or
 * all-zero) result.
 */
import { DORAMetricsController } from '../../controllers/dora-metrics.controller';
import type { DORAMetricsService } from '../../services/dora-metrics.service';

function build() {
  const getComprehensiveMetrics = jest.fn().mockResolvedValue({ deployments: { successful: 0, failed: 0, finished: 0 } });
  const controller = new DORAMetricsController({ getComprehensiveMetrics } as unknown as DORAMetricsService);
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  return { controller, getComprehensiveMetrics, res: { status, json } as any, status, json };
}

const ORG = '11111111-1111-4111-8111-111111111111';

describe('GET /api/metrics/dora — organization guard', () => {
  it.each([
    ['no organization on the request', { query: {} }],
    ['an empty organization id', { query: {}, organizationId: '' }],
    ['a user without an organization', { query: {}, user: { userId: 'u' } }],
  ])('answers 401 and computes nothing with %s', async (_name, req) => {
    const { controller, getComprehensiveMetrics, res, status, json } = build();

    await controller.getDORAMetrics(req as any, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Unauthorized - organization context required' });
    expect(getComprehensiveMetrics).not.toHaveBeenCalled();
  });

  it('the guard runs before parameter validation', async () => {
    const { controller, res, status } = build();
    await controller.getDORAMetrics({ query: { date_range: '365d' } } as any, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it("computes for the request's own organization only -- a query-string organization is not read", async () => {
    const { controller, getComprehensiveMetrics, res, status, json } = build();

    await controller.getDORAMetrics(
      { query: { date_range: '7d', organizationId: 'other', organization_id: 'other' }, organizationId: ORG } as any,
      res
    );

    expect(status).not.toHaveBeenCalled();
    expect(getComprehensiveMetrics).toHaveBeenCalledWith({ organizationId: ORG, dateRange: '7d' });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
