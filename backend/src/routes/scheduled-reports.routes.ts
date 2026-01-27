import { Router } from 'express';
import { pool } from '../config/database';
import { ScheduledReportsService } from '../services/scheduled-reports.service';
import { ScheduledReportsController } from '../controllers/scheduled-reports.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';

const router = Router();

// Initialize service and controller
const service = new ScheduledReportsService(pool);
const controller = new ScheduledReportsController(service);

// All routes require authentication and Enterprise tier
router.use(authenticateToken);
router.use(requireEnterprise);

// Routes
router.get('/', (req, res) => controller.list(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.get('/:id', (req, res) => controller.get(req, res));
router.put('/:id', (req, res) => controller.update(req, res));
router.delete('/:id', (req, res) => controller.delete(req, res));
router.patch('/:id/toggle', (req, res) => controller.toggle(req, res));
router.post('/:id/test', (req, res) => controller.test(req, res));
router.get('/:id/executions', (req, res) => controller.getExecutions(req, res));

export default router;
