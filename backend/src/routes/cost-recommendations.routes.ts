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

// Manual cost-analysis run history (must be registered before the /:id route
// below, or Express would treat "analysis-runs" as an :id param)
router.get('/analysis-runs', authenticateToken, (req, res) => controller.getAnalysisRuns(req, res));

// Optimization Rule Registry catalog (implemented + planned rules, grouped
// by service) -- also must be registered before /:id, same reason as above.
// Not Enterprise-gated: this returns only static parameter DEFINITIONS
// (which rules are configurable, their type/default/min/max/unit), never any
// organization's actual configured value -- see the controller method's own
// doc comment for why that split is safe.
router.get('/optimization-rules', authenticateToken, (req, res) => controller.getOptimizationRules(req, res));

// Enterprise Workstream 3B, Phase E: Enterprise Optimization Controls API.
// GET returns this organization's actual effective configuration (default or
// override) for every configurable rule/parameter -- Enterprise-gated,
// unlike the public catalog above, since this is organization-specific data.
// PUT/DELETE mutate that organization's override. All three are registered
// before /:id below for the same route-ordering reason as /optimization-rules
// itself, and organizationId is always taken from the authenticated request
// context inside the controller -- never accepted from the URL or body.
router.get('/optimization-rules/configuration', authenticateToken, requireEnterprise, (req, res) => controller.getOptimizationRulesConfiguration(req, res));
router.put('/optimization-rules/configuration/:ruleId/:parameterId', authenticateToken, requireEnterprise, (req, res) => controller.updateOptimizationRuleConfiguration(req, res));
router.delete('/optimization-rules/configuration/:ruleId/:parameterId', authenticateToken, requireEnterprise, (req, res) => controller.resetOptimizationRuleConfiguration(req, res));

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
