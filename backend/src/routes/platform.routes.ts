import { Router } from 'express';
import { StatsController } from '../controllers/stats.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new StatsController();

router.get('/stats/dashboard', authenticateToken, (req, res) => controller.getDashboardStats(req, res));

export default router;
