/**
 * Security Hub evidence/evaluation API -- deliberately a new, isolated namespace, not a
 * retrofit of compliance.routes.ts (hardcoded to soc2/hipaa, backed by the untouched
 * legacy ComplianceEngineService) or compliance-frameworks.routes.ts (the generic
 * user-authored custom-framework builder). Smallest surface needed: capability, manual
 * sync, and Security Hub-backed framework readiness (CIS, PCI DSS v4.0.1, NIST SP
 * 800-53 Rev. 5), all served by one parameterized route (see FRAMEWORK_EVALUATORS below).
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { standardRateLimiter } from '../middleware/rateLimiter';
import { SecurityHubSyncService } from '../services/security-hub-sync.service';
import { SecurityHubComplianceService } from '../services/security-hub-compliance.service';
import { SecurityHubStateRepository } from '../repositories/security-hub-state.repository';

const router = Router();
const syncService = new SecurityHubSyncService();
const complianceService = new SecurityHubComplianceService();
const stateRepo = new SecurityHubStateRepository();

router.use(authenticateToken);

/** GET /api/security-hub/capability — last-known capability + sync bookkeeping, no AWS call. */
router.get('/capability', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const state = await stateRepo.get(organizationId);
    if (!state) {
      res.json({
        success: true,
        capabilityStatus: null,
        syncStatus: 'NEVER_RUN',
        checkedAt: null,
        error: null,
        enabledStandards: [],
      });
      return;
    }

    res.json({
      success: true,
      capabilityStatus: state.capabilityStatus,
      syncStatus: state.lastSyncStatus,
      checkedAt: state.capabilityCheckedAt,
      error: state.capabilityError,
      enabledStandards: state.enabledStandards,
    });
  } catch (error: unknown) {
    console.error('[SecurityHub] Error fetching capability:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/** POST /api/security-hub/sync — Enterprise only, manual trigger, in-flight-deduplicated. */
router.post('/sync', requireEnterprise, standardRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const outcome = await syncService.sync(organizationId);
    res.json({ success: true, message: 'Security Hub sync completed', outcome });
  } catch (error: unknown) {
    console.error('[SecurityHub] Error running sync:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/security-hub/frameworks/:framework — readiness with full coverage breakdown
 * for one Security Hub-backed framework. Parameterized (not three copy-pasted handlers)
 * so a fourth framework never repeats this boilerplate a third time -- see the dispatch
 * table below. An unrecognized `framework` value is a 400, not a 404/500, since it's a
 * client input-validation failure, not a missing route or server error.
 */
const FRAMEWORK_EVALUATORS: Record<string, (organizationId: string) => ReturnType<SecurityHubComplianceService['evaluateCis']>> = {
  cis: (organizationId) => complianceService.evaluateCis(organizationId),
  pci: (organizationId) => complianceService.evaluatePci(organizationId),
  nist: (organizationId) => complianceService.evaluateNist(organizationId),
};

router.get('/frameworks/:framework', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const evaluate = FRAMEWORK_EVALUATORS[req.params.framework];
    if (!evaluate) {
      res.status(400).json({ success: false, error: `Unknown framework "${req.params.framework}". Supported: ${Object.keys(FRAMEWORK_EVALUATORS).join(', ')}.` });
      return;
    }

    const result = await evaluate(organizationId);
    res.json({ success: true, result });
  } catch (error: unknown) {
    console.error(`[SecurityHub] Error evaluating framework "${req.params.framework}":`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
