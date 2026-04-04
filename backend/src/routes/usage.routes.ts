import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth.middleware';
import { UsageController } from '../controllers/usage.controller';

const router = Router();
const controller = new UsageController(pool);

router.get('/api-requests', authenticate, (req, res) => controller.getApiRequests(req, res));

export default router;
