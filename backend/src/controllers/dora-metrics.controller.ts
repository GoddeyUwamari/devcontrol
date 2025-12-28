import { Request, Response } from 'express';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { DORAMetricsFilters } from '../repositories/dora-metrics.repository';

export class DORAMetricsController {
  constructor(private service: DORAMetricsService) {}

  /**
   * GET /api/metrics/dora
   * Get comprehensive DORA metrics
   */
  async getDORAMetrics(req: Request, res: Response): Promise<void> {
    try {
      const filters: DORAMetricsFilters = {};

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

      // Set service filter
      if (req.query.service_id) {
        filters.serviceId = req.query.service_id as string;
      }

      // Set team filter
      if (req.query.team_id) {
        filters.teamId = req.query.team_id as string;
      }

      // Set environment filter
      if (req.query.environment) {
        filters.environment = req.query.environment as string;
      }

      const metrics = await this.service.getComprehensiveMetrics(filters);

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      console.error('Error fetching DORA metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch DORA metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
