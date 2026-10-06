import { Router } from 'express';
import { AlertConfigController } from '../controllers/alert-config.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireTier } from '../middleware/subscription.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';

const router = Router();
const controller = new AlertConfigController();

// All routes require authentication
router.use(authenticate);

// Get alert configuration (Pro+ feature for Slack integration)
router.get('/config', requireTier('pro'), controller.getConfig.bind(controller));

// Update alert configuration (owner/admin; Pro+ feature for Slack integration)
router.put('/config', requireAdmin, requireTier('pro'), controller.updateConfig.bind(controller));

// Test alert (owner/admin; Pro+ feature)
router.post('/test', requireAdmin, requireTier('pro'), controller.testAlert.bind(controller));

export default router;
