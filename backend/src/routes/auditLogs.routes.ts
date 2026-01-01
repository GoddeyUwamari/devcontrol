/**
 * Audit Logs Routes
 * API endpoints for querying audit logs
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { auditLogger } from '../services/auditLogger.service';

const router = Router();

/**
 * GET /api/audit-logs
 * Query audit logs with filters (requires authentication)
 */
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;

    const filters = {
      organizationId,
      userId: req.query.user_id as string,
      action: req.query.action as string,
      resourceType: req.query.resource_type as string,
      startDate: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
      endDate: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const [logs, total] = await Promise.all([
      auditLogger.getLogs(filters),
      auditLogger.getCount(filters),
    ]);

    res.json({
      success: true,
      data: logs,
      total,
      page: Math.floor(filters.offset / filters.limit) + 1,
      limit: filters.limit,
    });
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit logs',
    });
  }
});

/**
 * GET /api/audit-logs/actions
 * Get unique actions for filter dropdown
 */
router.get('/actions', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;
    const actions = await auditLogger.getUniqueActions(organizationId);

    res.json({
      success: true,
      data: actions,
    });
  } catch (error) {
    console.error('Failed to fetch audit actions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit actions',
    });
  }
});

/**
 * GET /api/audit-logs/resource-types
 * Get unique resource types for filter dropdown
 */
router.get('/resource-types', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;
    const resourceTypes = await auditLogger.getUniqueResourceTypes(organizationId);

    res.json({
      success: true,
      data: resourceTypes,
    });
  } catch (error) {
    console.error('Failed to fetch resource types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch resource types',
    });
  }
});

export default router;
