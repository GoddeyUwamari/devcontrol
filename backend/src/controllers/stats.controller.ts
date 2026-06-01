import { Request, Response } from 'express';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { ApiResponse, PlatformStats } from '../types';
import { pool } from '../config/database';

const deploymentsRepo = new DeploymentsRepository();

export class StatsController {
  async getDashboardStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        const stats: PlatformStats = {
          total_services: 0,
          active_deployments: 0,
          total_infrastructure_cost: 0,
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
        costResult,
        healthyCountResult,
        activeDeployments,
        recentDeployments,
      ] = await Promise.all([
        pool.query(
          'SELECT COUNT(*) as total FROM aws_resources WHERE organization_id = $1',
          [organizationId]
        ),
        pool.query(
          'SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1',
          [organizationId]
        ),
        pool.query(
          "SELECT COUNT(*) as healthy FROM aws_resources WHERE organization_id = $1 AND status IN ('running', 'active', 'available')",
          [organizationId]
        ),
        deploymentsRepo.countByStatus('running'),
        deploymentsRepo.findRecentByLimit(5),
      ]);

      const totalResources = parseInt(resourceCountResult.rows[0].total, 10);
      const totalCost = parseFloat(costResult.rows[0].total);
      const healthyResources = parseInt(healthyCountResult.rows[0].healthy, 10);

      const stats: PlatformStats = {
        total_services: totalResources,
        active_deployments: activeDeployments,
        total_infrastructure_cost: totalCost,
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
}
