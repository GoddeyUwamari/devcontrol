import { Request, Response } from 'express';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import costOptimizationService from '../services/cost-optimization.service';
import { RemediationService } from '../services/remediation.service';
import { pool } from '../config/database';
import { RecommendationFilters, ApiResponse, RecommendationStatus } from '../types';
import { trackFunnelEventOnce } from '../services/analyticsEvents';

const repository = new CostRecommendationsRepository();
const remediationService = new RemediationService(pool);

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

      // first_value_viewed: the real customer-facing recommendation read
      // path (this endpoint, filtered to ACTIVE, is what the Cost
      // Optimization page and Dashboard both actually call). Gated on the
      // request being scoped to ACTIVE recommendations with a real dollar
      // amount to see, so an unfiltered/historical read or an empty result
      // doesn't count as "value seen." Guarded once-per-org by
      // trackFunnelEventOnce, so every refresh after the first is a no-op.
      if (filters.status === 'ACTIVE') {
        const totalActiveSavings = recommendations.reduce(
          (sum, r: any) => sum + (Number(r.potential_savings) || 0),
          0
        );
        if (totalActiveSavings > 0) {
          await trackFunnelEventOnce({
            organizationId,
            userId: (req as any).user?.userId ?? null,
            eventName: 'first_value_viewed',
            properties: { totalMonthlySavings: totalActiveSavings },
          });
        }
      }

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

      // first_insight_generated: any persisted recommendation existing for
      // this org after a real scan, regardless of dollar amount -- mirrors
      // the funnel's original intent, now against the authoritative table.
      // Guarded once-per-org so repeated/retried scans never re-fire it.
      if (insertedCount > 0) {
        await trackFunnelEventOnce({
          organizationId,
          userId: (req as any).user?.userId ?? null,
          eventName: 'first_insight_generated',
          properties: {
            recommendationCount: insertedCount,
            totalMonthlySavings: stats.total_potential_savings,
          },
        });
      }

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
   * POST /api/cost-recommendations/:id/execute-remediation
   * Idle EC2 recommendations only. Creates, approves, and executes a real
   * stop_instance remediation workflow via RemediationService, then marks the
   * recommendation resolved. Route-level middleware restricts this to
   * enterprise-tier orgs with an admin/owner user — see cost-recommendations.routes.ts.
   * Deliberately a separate endpoint from PATCH /:id/resolve so execution is
   * never a side effect of a routine status update; the frontend calls this
   * only after the user confirms an explicit "this will stop instance X" dialog.
   */
  async executeRemediation(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    let workflowId: string | undefined;

    try {
      const organizationId = (req as any).user?.organizationId;
      const userId = (req as any).user?.userId || (req as any).user?.id;
      if (!organizationId || !userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const recommendation = await repository.findById(id, organizationId);

      if (!recommendation) {
        res.status(404).json({ success: false, error: 'Recommendation not found' });
        return;
      }

      if (recommendation.resource_type !== 'EC2' || recommendation.issue !== 'Idle Instance') {
        res.status(400).json({
          success: false,
          error: 'Automated execution is only available for Idle EC2 recommendations.',
        });
        return;
      }

      if (recommendation.status !== 'ACTIVE') {
        res.status(400).json({
          success: false,
          error: `Cannot execute — recommendation is already ${recommendation.status}.`,
        });
        return;
      }

      const workflow = await remediationService.createWorkflow(
        organizationId,
        {
          recommendationId: recommendation.id,
          resourceId: recommendation.resource_id,
          resourceType: 'EC2',
          actionType: 'stop_instance',
          actionParams: {
            resource_id: recommendation.resource_id,
            region: recommendation.aws_region,
          },
          estimatedSavings: Number(recommendation.potential_savings) || 0,
          riskLevel: 'low',
        },
        userId
      );
      workflowId = workflow.id;

      await remediationService.approve(workflow.id, organizationId, userId, req.ip);

      try {
        const executed = await remediationService.execute(workflow.id, organizationId, userId, req.ip);
        const resolved = await repository.updateStatus(id, 'RESOLVED', organizationId);

        res.json({
          success: true,
          data: { recommendation: resolved, workflow: executed },
          message: `Instance ${recommendation.resource_id} stopped successfully.`,
        });
      } catch (execErr: any) {
        if (execErr.message?.startsWith('DRY_RUN_MODE')) {
          // Kill-switch is off — same outcome as the pre-existing status-only
          // resolve, but the workflow row records that execution was attempted.
          const resolved = await repository.updateStatus(id, 'RESOLVED', organizationId);
          res.json({
            success: true,
            data: { recommendation: resolved, workflow: null },
            message: 'Automated remediation is disabled (dry-run mode) — recommendation marked resolved without taking any AWS action.',
          });
          return;
        }

        if (execErr.message?.startsWith('REMEDIATION_BLOCKED')) {
          // Safety guard tripped — leave the recommendation ACTIVE so the
          // block is visible, do not silently mark it resolved.
          console.error(`[Remediation] blocked for recommendation ${id}:`, execErr.message);
          res.status(403).json({ success: false, error: execErr.message, data: { workflowId: workflow.id } });
          return;
        }

        // Real execution failure — leave the recommendation ACTIVE so it can
        // be retried or investigated via the Remediation page's audit trail.
        console.error(`[Remediation] execution failed for recommendation ${id}:`, execErr);
        res.status(500).json({
          success: false,
          error: `Execution failed: ${execErr.message}`,
          data: { workflowId: workflow.id },
        });
      }
    } catch (error: any) {
      console.error('Error executing remediation for recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute remediation',
        data: workflowId ? { workflowId } : undefined,
      });
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
