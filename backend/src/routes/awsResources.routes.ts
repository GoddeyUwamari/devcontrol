import { Router } from 'express';
import { pool } from '../config/database';
import { AWSResourcesController } from '../controllers/awsResources.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';
import { discoveryRateLimiter } from '../middleware/rateLimiter';
import { checkDiscoveryLimit, requireTier } from '../middleware/subscription.middleware';
import { TaggingComplianceService } from '../services/taggingCompliance.service';
import { AWSTaggingService } from '../services/awsTagging.service';

const router = Router();
const controller = new AWSResourcesController(pool);

/**
 * GET /api/aws-resources
 * List all AWS resources with optional filters
 */
router.get('/', authenticate, (req, res, next) => controller.getAll(req, res, next));

/**
 * GET /api/aws-resources/stats
 * Get resource statistics and summary
 */
router.get('/stats', authenticate, (req, res, next) => controller.getStats(req, res, next));

/**
 * GET /api/aws-resources/compliance
 * Get all compliance issues (Pro+ feature)
 */
router.get('/compliance', authenticate, requireTier('pro'), (req, res, next) => controller.getComplianceIssues(req, res, next));

/**
 * GET /api/aws-resources/orphaned
 * Get orphaned resources (Starter+ feature)
 */
router.get('/orphaned', authenticate, requireTier('starter'), (req, res, next) => controller.getOrphaned(req, res, next));

/**
 * GET /api/aws-resources/discovery/jobs
 * Get discovery job history
 */
router.get('/discovery/jobs', authenticate, (req, res, next) => controller.getDiscoveryJobs(req, res, next));

/**
 * POST /api/aws-resources/discover
 * Trigger resource discovery scan (Admin only, rate limited to 10/hour, resource limit enforced)
 */
router.post('/discover', authenticate, requireAdmin, checkDiscoveryLimit, discoveryRateLimiter, (req, res, next) => controller.discover(req, res, next));

/**
 * GET /api/aws-resources/:id
 * Get single resource by ID
 */
router.get('/:id', authenticate, (req, res, next) => controller.getById(req, res, next));

/**
 * DELETE /api/aws-resources/:id
 * Delete resource tracking (Admin only)
 * Note: This only removes tracking, not the actual AWS resource
 */
router.delete('/:id', authenticate, requireAdmin, (req, res, next) => controller.delete(req, res, next));

/**
 * POST /api/aws-resources/export
 * Export AWS resources to CSV or PDF (Starter+ feature)
 */
router.post('/export', authenticate, requireTier('starter'), (req, res, next) => controller.exportResources(req, res, next));

/**
 * GET /api/aws-resources/tagging-compliance
 * Get tagging compliance report (Pro+ feature)
 */
router.get('/tagging-compliance', authenticate, requireTier('pro'), async (req, res) => {
  try {
    const organizationId = (req as any).user?.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID not found'
      });
    }

    const complianceService = new TaggingComplianceService(pool);
    const report = await complianceService.auditAllResources(organizationId);

    res.json({ success: true, data: report });
  } catch (error: any) {
    console.error('[Tagging Compliance] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate tagging compliance report'
    });
  }
});

/**
 * POST /api/aws-resources/bulk-tag
 * Apply tags to multiple resources (Admin only)
 */
router.post('/bulk-tag', authenticate, requireAdmin, async (req, res) => {
  try {
    const { resourceIds, tags } = req.body;
    const organizationId = (req as any).user?.organization_id;

    // Validate inputs
    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'resourceIds must be a non-empty array'
      });
    }

    if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'tags must be a non-empty object'
      });
    }

    // Fetch resources from database
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM aws_resources
         WHERE organization_id = $1 AND id = ANY($2)`,
        [organizationId, resourceIds]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No resources found with the provided IDs'
        });
      }

      const resources = result.rows.map(row => ({
        ...row,
        tags: row.tags || {},
        metadata: row.metadata || {},
        compliance_issues: row.compliance_issues || [],
      }));

      // Apply tags using AWS Tagging Service
      const taggingService = new AWSTaggingService(pool);
      const result_summary = await taggingService.bulkTagResources(resources, tags);

      res.json({
        success: true,
        message: `Successfully tagged ${result_summary.success} resources`,
        data: result_summary
      });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[Bulk Tag] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply tags'
    });
  }
});

export default router;
