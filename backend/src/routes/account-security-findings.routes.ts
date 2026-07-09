import { Router } from 'express';
import { AccountSecurityFindingsController } from '../controllers/account-security-findings.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new AccountSecurityFindingsController();

// Get active account-level security findings
router.get('/', authenticateToken, (req, res) => controller.getActive(req, res));

// Get active-finding statistics (by severity/category)
router.get('/stats', authenticateToken, (req, res) => controller.getStats(req, res));

export default router;
