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
      const filters: RecommendationFilters = {
        severity: req.query.severity as any,
        status: req.query.status as any,
        resource_type: req.query.resource_type as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const recommendations = await repository.findAll(filters);

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
      const stats = await repository.getStats();

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
      const { id } = req.params;
      const recommendation = await repository.findById(id);

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
      // Check if AWS credentials are configured
      const isConfigured =
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_REGION;

      if (!isConfigured) {
        const response: ApiResponse = {
          success: false,
          error: 'AWS credentials not configured. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION.',
        };
        res.status(400).json(response);
        return;
      }

      console.log('Starting cost optimization analysis...');

      // Run the analysis
      const recommendations = await costOptimizationService.analyzeAllResources();

      // Clear existing ACTIVE recommendations before inserting new ones
      await repository.deleteAllActive();

      // Save new recommendations
      const insertedCount = await repository.createBulk(recommendations);

      // Get updated stats
      const stats = await repository.getStats();

      const response: ApiResponse = {
        success: true,
        data: {
          recommendationsFound: insertedCount,
          totalPotentialSavings: stats.total_potential_savings,
          bySeverity: stats.by_severity,
        },
        message: `Analysis complete. Found ${insertedCount} optimization opportunities with potential savings of $${stats.total_potential_savings.toFixed(2)}/month.`,
      };

      res.json(response);
    } catch (error: any) {
      console.error('Error analyzing AWS resources:', error);

      // Check for specific AWS errors
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
      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'RESOLVED');

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
      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'DISMISSED');

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
      const { id } = req.params;
      const deleted = await repository.delete(id);

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
