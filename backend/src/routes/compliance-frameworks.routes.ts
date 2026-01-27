import { Router } from 'express';
import { pool } from '../config/database';
import { ComplianceFrameworksController } from '../controllers/compliance-frameworks.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';

const router = Router();

// Initialize controller
const controller = new ComplianceFrameworksController(pool);

// All routes require authentication and Enterprise tier
router.use(authenticateToken);
router.use(requireEnterprise);

// Framework management
router.get('/', (req, res) => controller.listFrameworks(req, res));
router.post('/', (req, res) => controller.createFramework(req, res));
router.get('/:id', (req, res) => controller.getFramework(req, res));
router.put('/:id', (req, res) => controller.updateFramework(req, res));
router.delete('/:id', (req, res) => controller.deleteFramework(req, res));

// Rule management
router.post('/:id/rules', (req, res) => controller.createRule(req, res));
router.put('/rules/:ruleId', (req, res) => controller.updateRule(req, res));
router.delete('/rules/:ruleId', (req, res) => controller.deleteRule(req, res));

// Scan execution
router.post('/:id/scan', (req, res) => controller.executeScan(req, res));

// Scan history and results
router.get('/scans/list', (req, res) => controller.listScans(req, res));
router.get('/scans/:scanId', (req, res) => controller.getScanResults(req, res));

export default router;
