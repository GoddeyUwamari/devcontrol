import { Router } from 'express';
import { pool } from '../config/database';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { AlertHistoryController } from '../controllers/alert-history.controller';

const router = Router();

// Initialize controller
const controller = new AlertHistoryController(pool);

router.use(authenticateToken);

/**
 * GET /api/alerts/history
 * Get paginated alert history with filters
 *
 * Query parameters:
 * - date_range: 7d | 30d | 90d
 * - service_id: Filter by service UUID
 * - severity: critical | warning
 * - status: firing | acknowledged | resolved
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50)
 */
router.get('/history', (req, res) => controller.getAlertHistory(req, res));

/**
 * GET /api/alerts/stats
 * Get alert statistics
 *
 * Query parameters:
 * - date_range: 7d | 30d | 90d
 * - service_id: Filter by service UUID
 */
router.get('/stats', (req, res) => controller.getAlertStats(req, res));

/**
 * GET /api/alerts/:id
 * Get single alert by ID
 */
router.get('/:id', (req, res) => controller.getAlert(req, res));

/**
 * PATCH /api/alerts/:id/acknowledge
 * Acknowledge an alert. Member or above.
 *
 * Body:
 * - user: Username (optional, defaults to 'admin')
 */
router.patch('/:id/acknowledge', requireMember, (req, res) => controller.acknowledgeAlert(req, res));

/**
 * PATCH /api/alerts/:id/resolve
 * Resolve an alert. Member or above.
 */
router.patch('/:id/resolve', requireMember, (req, res) => controller.resolveAlert(req, res));

/**
 * DELETE /api/alerts/:id
 * Delete an alert
 */
router.delete('/:id', (req, res) => controller.deleteAlert(req, res));

export default router;
