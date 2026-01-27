import { Router } from 'express';
import { pool } from '../config/database';
import { RiskTrackingService } from '../services/risk-tracking.service';
import { RiskScoreController } from '../controllers/risk-score.controller';
import { authenticate } from '../middleware/auth.middleware';

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
 * Requires: Pro+ subscription (canViewRiskScore)
 */
router.get('/trend', (req, res) => controller.getTrend(req, res));

/**
 * GET /api/risk-score/current
 * Get current risk score without historical data
 *
 * Requires: Pro+ subscription (canViewRiskScore)
 */
router.get('/current', (req, res) => controller.getCurrent(req, res));

export default router;
