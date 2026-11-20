import { Request, Response } from 'express';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { DORAMetricsFilters } from '../repositories/dora-metrics.repository';
import { DoraFilterError, normalizeDoraFilters } from '../services/dora-filters';

export class DORAMetricsController {
  constructor(private service: DORAMetricsService) {}

  /**
   * GET /api/metrics/dora
   * DORA metrics for the request's own organization (never a client-supplied
   * one). Response fields are documented in dora-metrics.routes.ts.
   */
  async getDORAMetrics(req: Request, res: Response): Promise<void> {
    try {
      // Never run unscoped: no organization means no query at all.
      const organizationId =
        (req as any).organizationId ||
        (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized - organization context required' });
        return;
      }

      const filters: DORAMetricsFilters = { organizationId };

      // Validate and set date range
      if (req.query.date_range) {
        const dateRange = req.query.date_range as string;
        if (!['7d', '30d', '90d'].includes(dateRange)) {
          res.status(400).json({
            success: false,
            error: 'Invalid date_range. Must be one of: 7d, 30d, 90d',
          });
          return;
        }
        filters.dateRange = dateRange as '7d' | '30d' | '90d';
      }

      // Service, team and environment: checked before anything is queried,
      // so a bad value is a plain 400, never a database error. Absent, empty
      // or environment=all means "all" and adds no key.
      const normalized = normalizeDoraFilters({
        serviceId: req.query.service_id,
        teamId: req.query.team_id,
        environment: req.query.environment,
      });
      if (normalized.serviceId) filters.serviceId = normalized.serviceId;
      if (normalized.teamId) filters.teamId = normalized.teamId;
      if (normalized.environment) filters.environment = normalized.environment;

      const metrics = await this.service.getComprehensiveMetrics(filters);

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      if (error instanceof DoraFilterError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      // The error is logged, never returned: its text can carry database detail.
      console.error('Error fetching DORA metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch DORA metrics',
      });
    }
  }
}
