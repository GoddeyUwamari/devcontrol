import { Router, Request, Response } from 'express';
import { CostRecommendationsController } from '../controllers/cost-recommendations.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { remediationExecuteRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const controller = new CostRecommendationsController();

function requireAdminOrOwner(req: Request, res: Response): boolean {
  const role = (req as any).user?.role || 'member';
  if (role !== 'admin' && role !== 'owner') {
    res.status(403).json({
      success: false,
      error: 'Only admins and owners can execute automated remediation actions.',
    });
    return false;
  }
  return true;
}

// Get all recommendations
router.get('/', authenticateToken, (req, res) => controller.getAll(req, res));

// Get recommendation statistics
router.get('/stats', authenticateToken, (req, res) => controller.getStats(req, res));

// Analyze AWS resources (create recommendations)
router.post('/analyze', authenticateToken, (req, res) => controller.analyze(req, res));

// Get single recommendation by ID
router.get('/:id', authenticateToken, (req, res) => controller.getById(req, res));

// Resolve recommendation (status-only — unchanged for every recommendation type)
router.patch('/:id/resolve', authenticateToken, (req, res) => controller.resolve(req, res));

// Execute real remediation for an Idle EC2 recommendation — enterprise-tier +
// admin/owner only, rate-limited same as /api/remediation/:id/execute. The
// frontend calls this only after an explicit confirmation dialog; every other
// recommendation type keeps using the plain resolve endpoint above.
router.post(
  '/:id/execute-remediation',
  authenticateToken,
  requireEnterprise,
  remediationExecuteRateLimiter,
  (req, res) => {
    if (!requireAdminOrOwner(req, res)) return;
    controller.executeRemediation(req, res);
  }
);

// Dismiss recommendation
router.patch('/:id/dismiss', authenticateToken, (req, res) => controller.dismiss(req, res));

// Delete recommendation
router.delete('/:id', authenticateToken, (req, res) => controller.delete(req, res));

export default router;
