import { Router } from 'express';
import { StatsController } from '../controllers/stats.controller';
import { AISummaryController } from '../controllers/ai-summary.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new StatsController();
const aiSummaryController = new AISummaryController();

router.get('/stats/dashboard', authenticateToken, (req, res) => controller.getDashboardStats(req, res));
router.get('/costs/trend', authenticateToken, (req, res) => controller.getCostTrend(req, res));
router.get('/ai-summary', authenticateToken, (req, res) => aiSummaryController.getSummary(req, res));

export default router;
