import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth.middleware';
import { ORGANIZATION_ROLES, OrganizationAccessError, requireCurrentRole } from '../services/organization-authorization';
import { ServicesIntelligenceService } from '../services/services-intelligence.service';

const router = Router();
const service = new ServicesIntelligenceService();

/**
 * Reading services intelligence is open to every role, viewers included, but
 * only to a caller who CURRENTLY holds a membership in an active organization
 * (not merely a JWT role claim). Runs after `authenticate`, which has already
 * answered 401 for a missing/invalid token or a revoked membership.
 */
async function requireCurrentMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    await requireCurrentRole(pool, req.user.organizationId, req.user.userId, ORGANIZATION_ROLES);
    next();
  } catch (err: unknown) {
    if (err instanceof OrganizationAccessError && err.statusCode === 403) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    console.error('[Services/intelligence] role check error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify permissions' });
  }
}

// ─── GET /api/services/intelligence ──────────────────────────────────────────
// The organization is the authenticated caller's. Nothing in the query string
// or body selects a tenant, and the request takes no parameters.

router.get('/', authenticate, requireCurrentMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await service.get(req.user!.organizationId);
    res.json({ success: true, data });
  } catch (err: unknown) {
    console.error('[Services/intelligence]', err);
    res.status(500).json({ success: false, error: 'Failed to load services intelligence' });
  }
});

export default router;
