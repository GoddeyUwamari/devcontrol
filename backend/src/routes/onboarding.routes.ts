/**
 * Onboarding API Routes
 * Endpoints for managing onboarding progress
 */

import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';
import { onboardingService } from '../services/onboarding.service';

const router = express.Router();

// =====================================================
// GET /api/onboarding/status
// Get current onboarding status for the organization
// =====================================================

router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    const userId = (req as any).user?.userId;

    if (!organizationId || !userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const status = await onboardingService.getStatus(organizationId, userId);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// POST /api/onboarding/complete/:step
// Mark a specific step as complete
// =====================================================

router.post('/complete/:step', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    const userId = (req as any).user?.userId;
    const { step } = req.params;

    if (!organizationId || !userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Validate step
    const validSteps = ['welcome', 'discover_resources'];
    if (!validSteps.includes(step)) {
      return res.status(400).json({
        success: false,
        error: `Invalid step. Must be one of: ${validSteps.join(', ')}`,
      });
    }

    // Mark step complete
    await onboardingService.markStepComplete(organizationId, step);

    // Re-fetch updated status
    const status = await onboardingService.getStatus(organizationId, userId);

    res.json({
      success: true,
      data: status,
      message: `Step '${step}' marked as complete`,
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// POST /api/onboarding/dismiss
// Dismiss/skip onboarding
// =====================================================

router.post('/dismiss', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    const userId = (req as any).user?.userId;

    if (!organizationId || !userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    await onboardingService.dismiss(organizationId);

    // Re-fetch updated status
    const status = await onboardingService.getStatus(organizationId, userId);

    res.json({
      success: true,
      data: status,
      message: 'Onboarding dismissed',
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// POST /api/onboarding/re-enable
// Re-enable onboarding if user dismissed it
// =====================================================

router.post('/re-enable', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = (req as any).user?.organizationId;
    const userId = (req as any).user?.userId;

    if (!organizationId || !userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    await onboardingService.reEnable(organizationId);

    // Re-fetch updated status
    const status = await onboardingService.getStatus(organizationId, userId);

    res.json({
      success: true,
      data: status,
      message: 'Onboarding re-enabled',
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// GET /api/onboarding/metrics
// Get overall onboarding metrics (admin only)
// =====================================================

// getMetrics()/getFunnelMetrics() below are platform-wide aggregates (across
// every organization, not just the caller's) — requireAdmin at least closes
// "any authenticated member/viewer" access; a true platform-staff-only role
// doesn't exist yet in this codebase's role model (owner/admin/member/viewer
// are all per-organization), so any org's own admin/owner can still see
// aggregate counts about every other org. Flagged, not solved here.
router.get('/metrics', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metrics = await onboardingService.getMetrics();

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// GET /api/onboarding/funnel
// Get funnel conversion rates (admin only)
// =====================================================

router.get('/funnel', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const funnel = await onboardingService.getFunnelMetrics();

    res.json({
      success: true,
      data: funnel,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
