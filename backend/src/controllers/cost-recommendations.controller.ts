import { Request, Response } from 'express';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import costOptimizationService from '../services/cost-optimization.service';
import { RecommendationFilters, ApiResponse, RecommendationStatus } from '../types';

const repository = new CostRecommendationsRepository();

export class CostRecommendationsController {
  /**
   * GET /api/cost-recommendations
   * Get all recommendations with optional filters
   */
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const filters: RecommendationFilters = {
        severity: req.query.severity as any,
        status: req.query.status as any,
        resource_type: req.query.resource_type as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const recommendations = await repository.findAll(organizationId, filters);

      const response: ApiResponse = {
        success: true,
        data: recommendations,
        total: recommendations.length,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching cost recommendations:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch cost recommendations',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/stats
   * Get recommendation statistics
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const stats = await repository.getStats(organizationId);

      const response: ApiResponse = {
        success: true,
        data: stats,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching recommendation stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch recommendation statistics',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/:id
   * Get a single recommendation by ID
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const recommendation = await repository.findById(id, organizationId);

      if (!recommendation) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: recommendation,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * POST /api/cost-recommendations/analyze
   * Analyze AWS resources and generate recommendations
   */
  async analyze(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      console.log(`Starting cost optimization analysis for org ${organizationId}...`);

      // Run the analysis against this org's connected AWS account
      const recommendations = await costOptimizationService.analyzeAllResources(organizationId);

      // Clear existing ACTIVE recommendations before inserting new ones
      await repository.deleteAllActive(organizationId);

      // Save new recommendations
      const insertedCount = await repository.createBulk(recommendations, organizationId);

      // Get updated stats
      const stats = await repository.getStats(organizationId);

      const response: ApiResponse = {
        success: true,
        data: {
          recommendationsFound: insertedCount,
          totalPotentialSavings: stats.total_potential_savings,
          bySeverity: stats.by_severity,
          timestamp: new Date().toISOString(),
        },
        message: `Analysis complete. Found ${insertedCount} optimization opportunities with potential savings of $${stats.total_potential_savings.toFixed(2)}/month.`,
      };

      res.json(response);
    } catch (error: any) {
      console.error('Error analyzing AWS resources:', error);

      // Check for specific AWS errors
      if (error.message && error.message.includes('AWS_NOT_CONNECTED')) {
        const response: ApiResponse = {
          success: false,
          error: 'No AWS account connected for this organization. Connect one to run cost analysis.',
        };
        res.status(400).json(response);
        return;
      }

      if (error.message && error.message.includes('not enabled')) {
        const response: ApiResponse = {
          success: false,
          error: 'AWS Cost Explorer or CloudWatch is not enabled. Please enable it in your AWS account.',
        };
        res.status(503).json(response);
        return;
      }

      const response: ApiResponse = {
        success: false,
        error: `Failed to analyze AWS resources: ${error.message || 'Unknown error'}`,
      };
      res.status(500).json(response);
    }
  }

  /**
   * PATCH /api/cost-recommendations/:id/resolve
   * Mark a recommendation as resolved
   */
  async resolve(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'RESOLVED', organizationId);

      if (!updated) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: updated,
        message: 'Recommendation marked as resolved',
      };

      res.json(response);
    } catch (error) {
      console.error('Error resolving recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to resolve recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * PATCH /api/cost-recommendations/:id/dismiss
   * Mark a recommendation as dismissed
   */
  async dismiss(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'DISMISSED', organizationId);

      if (!updated) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: updated,
        message: 'Recommendation dismissed',
      };

      res.json(response);
    } catch (error) {
      console.error('Error dismissing recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to dismiss recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * DELETE /api/cost-recommendations/:id
   * Delete a recommendation
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const deleted = await repository.delete(id, organizationId);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        message: 'Recommendation deleted successfully',
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete recommendation',
      };
      res.status(500).json(response);
    }
  }
}
