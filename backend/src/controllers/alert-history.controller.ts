import { Request, Response } from 'express';
import { Pool } from 'pg';
import { AlertHistoryService } from '../services/alert-history.service';
import { AlertFilters } from '../repositories/alert-history.repository';

export class AlertHistoryController {
  private service: AlertHistoryService;

  constructor(pool: Pool) {
    this.service = new AlertHistoryService(pool);
  }

  /**
   * GET /api/alerts/history
   * Get paginated alert history with optional filters
   */
  async getAlertHistory(req: Request, res: Response): Promise<void> {
    try {
      const filters: AlertFilters = {
        dateRange: req.query.date_range as any,
        serviceId: req.query.service_id as string,
        severity: req.query.severity as any,
        status: req.query.status as any,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        organizationId: (req as any).user?.organizationId,
      };

      const result = await this.service.getAlertHistory(filters);

      res.json({
        success: true,
        data: result.alerts,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error: any) {
      console.error('Error fetching alert history:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch alert history',
      });
    }
  }

  /**
   * GET /api/alerts/stats
   * Get alert statistics
   */
  async getAlertStats(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        dateRange: req.query.date_range as any,
        serviceId: req.query.service_id as string,
        organizationId: (req as any).user?.organizationId,
      };

      const stats = await this.service.getAlertStats(filters);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      console.error('Error fetching alert stats:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch alert statistics',
      });
    }
  }

  /**
   * GET /api/alerts/:id
   * Get a single alert by ID
   */
  async getAlert(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      const alert = await this.service.getAlert(id, organizationId);

      if (!alert) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      res.json({
        success: true,
        data: alert,
      });
    } catch (error: any) {
      console.error('Error fetching alert:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch alert',
      });
    }
  }

  /**
   * PATCH /api/alerts/:id/acknowledge
   * Acknowledge an alert
   */
  async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { user } = req.body;
      const organizationId = (req as any).user?.organizationId;

      const alert = await this.service.acknowledgeAlert(id, organizationId, user || 'admin');

      if (!alert) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      res.json({
        success: true,
        data: alert,
        message: 'Alert acknowledged successfully',
      });
    } catch (error: any) {
      console.error('Error acknowledging alert:', error);

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }

      if (error.message.includes('Cannot acknowledge')) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to acknowledge alert',
      });
    }
  }

  /**
   * PATCH /api/alerts/:id/resolve
   * Resolve an alert
   */
  async resolveAlert(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;

      const alert = await this.service.resolveAlert(id, organizationId);

      if (!alert) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      res.json({
        success: true,
        data: alert,
        message: 'Alert resolved successfully',
      });
    } catch (error: any) {
      console.error('Error resolving alert:', error);

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }

      if (error.message.includes('already resolved')) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to resolve alert',
      });
    }
  }

  /**
   * DELETE /api/alerts/:id
   * Delete an alert
   */
  async deleteAlert(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;

      const deleted = await this.service.deleteAlert(id, organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Alert deleted successfully',
      });
    } catch (error: any) {
      console.error('Error deleting alert:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete alert',
      });
    }
  }
}
