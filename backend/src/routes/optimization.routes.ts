/**
 * Optimization Routes
 * Cost optimization recommendation endpoints
 */

import { Router } from 'express';
import { pool } from '../config/database';
import { OptimizationController } from '../controllers/optimization.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new OptimizationController(pool);

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/optimizations/scan
 * Trigger optimization scan
 * Scans AWS resources and generates AI-prioritized recommendations
 */
router.post('/scan', controller.scan);

/**
 * GET /api/optimizations
 * Get all recommendations
 * Query params:
 *   - status: Filter by status (pending/approved/applied/dismissed)
 */
router.get('/', controller.getRecommendations);

/**
 * GET /api/optimizations/summary
 * Get optimization summary
 * Returns total savings and counts by type/risk/status
 */
router.get('/summary', controller.getSummary);

/**
 * PATCH /api/optimizations/:id/status
 * Update recommendation status
 * Body: { status: 'approved' | 'applied' | 'dismissed' }
 */
router.patch('/:id/status', controller.updateStatus);

/**
 * DELETE /api/optimizations/cleanup
 * Delete old dismissed recommendations
 * Query params:
 *   - daysOld: Age threshold in days (default: 90)
 */
router.delete('/cleanup', controller.cleanup);

export default router;
