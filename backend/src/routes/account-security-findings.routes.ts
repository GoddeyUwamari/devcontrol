import { Router } from 'express';
import { AccountSecurityFindingsController } from '../controllers/account-security-findings.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';

const router = Router();
const controller = new AccountSecurityFindingsController();

// Get active account-level security findings
router.get('/', authenticateToken, (req, res) => controller.getActive(req, res));

// Get active-finding statistics (by severity/category)
router.get('/stats', authenticateToken, (req, res) => controller.getStats(req, res));

// Disposition actions — user decisions about an ACTIVE finding. Never mutate
// AWS infrastructure and never change the finding's system-owned status.
// Acknowledge and dismiss are triage: member or above.
router.post('/:id/acknowledge', authenticateToken, requireMember, (req, res) => controller.acknowledge(req, res));
router.post('/:id/dismiss', authenticateToken, requireMember, (req, res) => controller.dismiss(req, res));
router.post('/:id/accept-risk', authenticateToken, (req, res) => controller.acceptRisk(req, res));

export default router;
