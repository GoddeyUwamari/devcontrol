import { Request, Response } from 'express';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { ApiResponse, PlatformStats } from '../types';
import { pool } from '../config/database';
import awsCostService, { CostTrendRange } from '../services/aws-cost.service';

const deploymentsRepo = new DeploymentsRepository();
const VALID_TREND_RANGES: CostTrendRange[] = ['7d', '30d', '90d', '6mo', '1yr'];

export class StatsController {
  async getDashboardStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        const stats: PlatformStats = {
          total_services: 0,
          active_deployments: 0,
          total_infrastructure_cost: 0,
          cost_source: 'estimated',
          free_tier_remaining: 25,
          recent_deployments: [],
          service_health: { healthy: 0, unhealthy: 0 },
        };
        const response: ApiResponse<PlatformStats> = { success: true, data: stats };
        res.json(response);
        return;
      }

      const [
        resourceCountResult,
        healthyCountResult,
        activeDeployments,
        recentDeployments,
      ] = await Promise.all([
        pool.query(
          'SELECT COUNT(*) as total FROM aws_resources WHERE organization_id = $1',
          [organizationId]
        ),
        pool.query(
          "SELECT COUNT(*) as healthy FROM aws_resources WHERE organization_id = $1 AND status IN ('running', 'active', 'available')",
          [organizationId]
        ),
        deploymentsRepo.countByStatus('running'),
        deploymentsRepo.findRecentByLimit(5),
      ]);

      // Try live Cost Explorer first; fall back to DB estimate on error or no data.
      let totalCost: number;
      let costSource: 'actual' | 'estimated';
      try {
        const liveCost = await awsCostService.fetchMonthlyCosts(organizationId);
        if (liveCost.total > 0) {
          totalCost = liveCost.total;
          costSource = 'actual';
        } else {
          const estimateResult = await pool.query(
            'SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1',
            [organizationId]
          );
          totalCost = parseFloat(estimateResult.rows[0].total);
          costSource = 'estimated';
        }
      } catch (_err) {
        const estimateResult = await pool.query(
          'SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1',
          [organizationId]
        );
        totalCost = parseFloat(estimateResult.rows[0].total);
        costSource = 'estimated';
      }

      const totalResources = parseInt(resourceCountResult.rows[0].total, 10);
      const healthyResources = parseInt(healthyCountResult.rows[0].healthy, 10);

      const stats: PlatformStats = {
        total_services: totalResources,
        active_deployments: activeDeployments,
        total_infrastructure_cost: totalCost,
        cost_source: costSource,
        free_tier_remaining: Math.max(0, 25 - totalCost),
        recent_deployments: recentDeployments,
        service_health: {
          healthy: healthyResources,
          unhealthy: totalResources - healthyResources,
        },
      };

      const response: ApiResponse<PlatformStats> = { success: true, data: stats };
      res.json(response);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch dashboard stats',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/platform/costs/trend
   * Time-series cost breakdown by category (compute/storage/database/network/other)
   * from AWS Cost Explorer, for the requested range.
   */
  async getCostTrend(req: Request, res: Response): Promise<void> {
    const organizationId = (req as any).user?.organizationId;
    const rangeParam = (req.query.range as string) || '90d';

    if (!VALID_TREND_RANGES.includes(rangeParam as CostTrendRange)) {
      res.status(400).json({
        success: false,
        error: `Invalid range. Must be one of: ${VALID_TREND_RANGES.join(', ')}`,
      });
      return;
    }

    try {
      const data = await awsCostService.fetchCostTrend(organizationId, rangeParam as CostTrendRange);
      res.json({ success: true, data });
    } catch (error) {
      // Not-connected / Cost Explorer hiccups shouldn't break the dashboard —
      // degrade to an honest empty series rather than a 500.
      console.error('Error fetching cost trend:', error);
      res.json({ success: true, data: [] });
    }
  }
}
