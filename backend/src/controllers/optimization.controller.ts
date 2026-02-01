/**
 * Optimization Controller
 * Handles cost optimization recommendation endpoints
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { OptimizationScannerService } from '../services/optimization-scanner.service';
import { OptimizationAIService } from '../services/optimization-ai.service';
import { OptimizationRepository } from '../repositories/optimization.repository';

export class OptimizationController {
  private scanner: OptimizationScannerService;
  private aiService: OptimizationAIService;
  private repository: OptimizationRepository;

  constructor(pool: Pool) {
    this.scanner = new OptimizationScannerService(pool);
    this.aiService = new OptimizationAIService();
    this.repository = new OptimizationRepository(pool);
  }

  /**
   * POST /api/optimizations/scan
   * Scan for optimization opportunities
   */
  scan = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - organization ID required',
        });
      }

      console.log(`[Optimization] Starting scan for org ${organizationId}...`);

      // Scan for opportunities
      let recommendations = await this.scanner.scanOrganization(organizationId);

      // AI prioritization
      recommendations = await this.aiService.prioritizeRecommendations(recommendations);

      // Save to database
      await this.repository.saveRecommendations(recommendations);

      // Get summary
      const summary = await this.repository.getSummary(organizationId);

      console.log(`[Optimization] Scan complete: ${recommendations.length} recommendations, $${summary.totalMonthlySavings.toFixed(2)}/mo potential savings`);

      res.json({
        success: true,
        data: {
          recommendations,
          summary,
        },
      });
    } catch (error: any) {
      console.error('[Optimization] Scan error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  /**
   * GET /api/optimizations
   * Get all recommendations
   */
  getRecommendations = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      const { status } = req.query;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const recommendations = await this.repository.getRecommendations(
        organizationId,
        status as string
      );

      const summary = await this.repository.getSummary(organizationId);

      res.json({
        success: true,
        data: {
          recommendations,
          summary,
        },
      });
    } catch (error: any) {
      console.error('[Optimization] Get recommendations error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  /**
   * PATCH /api/optimizations/:id/status
   * Update recommendation status
   */
  updateStatus = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['approved', 'applied', 'dismissed'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be one of: approved, applied, dismissed',
        });
      }

      const appliedAt = status === 'applied' ? new Date() : undefined;

      await this.repository.updateStatus(id, status, appliedAt);

      res.json({
        success: true,
        message: `Recommendation status updated to ${status}`,
      });
    } catch (error: any) {
      console.error('[Optimization] Update status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  /**
   * GET /api/optimizations/summary
   * Get optimization summary
   */
  getSummary = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const summary = await this.repository.getSummary(organizationId);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      console.error('[Optimization] Summary error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  /**
   * DELETE /api/optimizations/cleanup
   * Delete old dismissed recommendations
   */
  cleanup = async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).user?.organizationId;
      const { daysOld = 90 } = req.query;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const count = await this.repository.deleteOldDismissed(
        organizationId,
        parseInt(daysOld as string)
      );

      res.json({
        success: true,
        message: `Deleted ${count} old dismissed recommendations`,
        data: { count },
      });
    } catch (error: any) {
      console.error('[Optimization] Cleanup error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
}
