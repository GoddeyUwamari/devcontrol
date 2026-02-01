import { Request, Response } from 'express';
import { RiskTrackingService } from '../services/risk-tracking.service';

export class RiskScoreController {
  constructor(private service: RiskTrackingService) {}

  /**
   * GET /api/risk-score/trend
   * Get risk score trend with historical data
   * Premium feature - requires Pro+ subscription (enforced by route middleware)
   */
  async getTrend(req: Request, res: Response): Promise<void> {
    try {
      // Get organization ID from auth middleware
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
        return;
      }

      // Validate date range
      const dateRange = (req.query.date_range as string) || '30d';
      if (!['7d', '30d', '90d'].includes(dateRange)) {
        res.status(400).json({
          success: false,
          error: 'Invalid date_range. Must be one of: 7d, 30d, 90d',
        });
        return;
      }

      const trend = await this.service.getRiskScoreTrend(
        organizationId,
        dateRange as '7d' | '30d' | '90d'
      );

      res.json({
        success: true,
        data: trend,
      });
    } catch (error) {
      console.error('Error fetching risk score trend:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch risk score trend',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/risk-score/current
   * Get current risk score without historical data
   * Premium feature - requires Pro+ subscription (enforced by route middleware)
   */
  async getCurrent(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
        return;
      }

      const current = await this.service.calculateCurrentRiskScore(organizationId);

      res.json({
        success: true,
        data: current,
      });
    } catch (error) {
      console.error('Error fetching current risk score:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch current risk score',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
