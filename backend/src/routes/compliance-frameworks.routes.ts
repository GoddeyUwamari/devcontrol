import { Router } from 'express';
import { pool } from '../config/database';
import { ComplianceFrameworksController } from '../controllers/compliance-frameworks.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';

const router = Router();

// Initialize controller
const controller = new ComplianceFrameworksController(pool);

// All routes require authentication and Enterprise tier
router.use(authenticateToken);
router.use(requireEnterprise);

// Framework management. Every mutation below, and starting a scan, is member
// or above; viewers keep the reads.
router.get('/', (req, res) => controller.listFrameworks(req, res));
router.post('/', requireMember, (req, res) => controller.createFramework(req, res));
router.get('/:id', (req, res) => controller.getFramework(req, res));
router.put('/:id', requireMember, (req, res) => controller.updateFramework(req, res));
router.delete('/:id', requireMember, (req, res) => controller.deleteFramework(req, res));

// Rule management
router.post('/:id/rules', requireMember, (req, res) => controller.createRule(req, res));
router.put('/rules/:ruleId', requireMember, (req, res) => controller.updateRule(req, res));
router.delete('/rules/:ruleId', requireMember, (req, res) => controller.deleteRule(req, res));

// Scan execution
router.post('/:id/scan', requireMember, (req, res) => controller.executeScan(req, res));

// Scan history and results
router.get('/scans/list', (req, res) => controller.listScans(req, res));
router.get('/scans/:scanId', (req, res) => controller.getScanResults(req, res));

export default router;
