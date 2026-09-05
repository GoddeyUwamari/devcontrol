/**
 * GET /api/admin/activation-funnel
 *
 * Read-only, platform-wide activation funnel summary derived from the
 * canonical `analytics_events` table. First real consumer of that table --
 * see backend/src/services/activationFunnel.service.ts for the RLS-safe
 * aggregation this depends on and why a naive query would be wrong here.
 */
import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requirePlatformStaff } from '../middleware/platformAuth.middleware';
import { getActivationFunnelSummary } from '../services/activationFunnel.service';

const router = express.Router();

// This endpoint returns aggregate counts about every organization, so it
// must not be gated by a per-organization role (requireAdmin/requireOwner)
// -- every self-service customer is already 'owner' of their own org, which
// would let any customer see platform-wide business metrics. Gated instead
// by requirePlatformStaff (platformAuth.middleware.ts), which checks the
// platform_staff table -- an authorization boundary independent of
// organization_memberships.role entirely. See that table's migration
// (database/migrations/202609051200_create_platform_staff.sql) for why.
router.get('/', authenticate, requirePlatformStaff, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await getActivationFunnelSummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
