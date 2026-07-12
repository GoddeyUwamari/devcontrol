import { Router } from 'express';
import { StatsController } from '../controllers/stats.controller';
import { AISummaryController } from '../controllers/ai-summary.controller';
import { ActivityFeedController } from '../controllers/activity-feed.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new StatsController();
const aiSummaryController = new AISummaryController();
const activityFeedController = new ActivityFeedController();

router.get('/stats/dashboard', authenticateToken, (req, res) => controller.getDashboardStats(req, res));
router.get('/costs/trend', authenticateToken, (req, res) => controller.getCostTrend(req, res));
router.get('/ai-summary', authenticateToken, (req, res) => aiSummaryController.getSummary(req, res));
router.get('/activity', authenticateToken, (req, res) => activityFeedController.getActivity(req, res));

export default router;
