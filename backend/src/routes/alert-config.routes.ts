import { Router } from 'express';
import { AlertConfigController } from '../controllers/alert-config.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireTier } from '../middleware/subscription.middleware';

const router = Router();
const controller = new AlertConfigController();

// All routes require authentication
router.use(authenticate);

// Get alert configuration (Pro+ feature for Slack integration)
router.get('/config', requireTier('pro'), controller.getConfig.bind(controller));

// Update alert configuration (Pro+ feature for Slack integration)
router.put('/config', requireTier('pro'), controller.updateConfig.bind(controller));

// Test alert (Pro+ feature)
router.post('/test', requireTier('pro'), controller.testAlert.bind(controller));

export default router;
