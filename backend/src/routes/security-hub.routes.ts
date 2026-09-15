/**
 * Security Hub evidence/evaluation API -- deliberately a new, isolated namespace, not a
 * retrofit of compliance.routes.ts (hardcoded to soc2/hipaa, backed by the untouched
 * legacy ComplianceEngineService) or compliance-frameworks.routes.ts (the generic
 * user-authored custom-framework builder). Smallest surface needed for v1: capability,
 * manual sync, standards, and CIS readiness.
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

/** GET /api/security-hub/frameworks/cis — CIS readiness with full coverage breakdown. */
router.get('/frameworks/cis', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const result = await complianceService.evaluateCis(organizationId);
    res.json({ success: true, result });
  } catch (error: unknown) {
    console.error('[SecurityHub] Error evaluating CIS:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/** GET /api/security-hub/frameworks/pci — PCI DSS v4.0.1 readiness with full coverage breakdown. */
router.get('/frameworks/pci', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const result = await complianceService.evaluatePci(organizationId);
    res.json({ success: true, result });
  } catch (error: unknown) {
    console.error('[SecurityHub] Error evaluating PCI DSS:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
