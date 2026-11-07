import { Router } from 'express';
import { pool } from '../config/database';
import { RiskTrackingService } from '../services/risk-tracking.service';
import { RiskScoreController } from '../controllers/risk-score.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireEntitlement } from '../middleware/subscription.middleware';

const router = Router();

// Initialize service and controller
const service = new RiskTrackingService(pool);
const controller = new RiskScoreController(service);

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/risk-score/trend
 * Get risk score trend with historical data
 *
 * Query parameters:
 * - date_range: 7d | 30d | 90d (default: 30d)
 *
 * Requires: the riskScore plan entitlement (config/plan-entitlements.ts)
 */
router.get('/trend', requireEntitlement('riskScore'), (req, res) => controller.getTrend(req, res));

/**
 * GET /api/risk-score/current
 * Get current risk score without historical data
 *
 * Requires: the riskScore plan entitlement (config/plan-entitlements.ts)
 */
router.get('/current', requireEntitlement('riskScore'), (req, res) => controller.getCurrent(req, res));

export default router;
