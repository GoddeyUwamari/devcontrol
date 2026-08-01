/**
 * Organization Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { organizationController } from '../controllers/organization.controller';
import { authenticate } from '../middleware/auth.middleware';
import {
  requireOwner,
  requireAdmin,
  requireMember,
  requirePermission,
} from '../middleware/rbac.middleware';
import { checkResourceLimit } from '../middleware/subscription.middleware';

const router = Router();

// authenticate only proves who the caller is and which org their own JWT
// belongs to — requireAdmin/requireOwner (rbac.middleware.ts) only check
// that role against the CALLER's own org, never against :id in the URL. Every
// route below that targets a specific organization by id needs this too, or
// any authenticated user (from any org) can read/modify/delete a
// *different* org purely by putting its UUID in the URL — including
// deleting it or reading/replacing its AWS credentials. 404 (not 403) to
// match how every other org-scoped resource in this codebase responds to a
// cross-tenant id, rather than confirming the target org exists.
function requireOwnOrg(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.params.id !== req.user.organizationId) {
    res.status(404).json({ success: false, error: 'Organization not found' });
    return;
  }
  next();
}

// Public endpoint — no auth required
router.get('/founding-count', async (req, res) => {
  try {
    const { pool } = await import('../config/database');
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM organizations
       WHERE subscription_tier != 'free' AND subscription_tier IS NOT NULL`
    );
    res.json({ count: result.rows[0].count });
  } catch {
    res.json({ count: 5 });
  }
});

// All organization routes require authentication
router.use(authenticate);

// Organization CRUD
router.post('/', organizationController.createOrganization.bind(organizationController));
router.get('/', organizationController.getOrganizations.bind(organizationController));
router.get('/:id', requireOwnOrg, organizationController.getOrganization.bind(organizationController));
// Slug isn't the org id, so requireOwnOrg can't gate this one up front — the
// controller resolves slug -> org and checks ownership itself.
router.get('/slug/:slug', organizationController.getOrganizationBySlug.bind(organizationController));

// Organization updates (requires admin or owner)
router.patch(
  '/:id',
  requireOwnOrg,
  requireAdmin,
  organizationController.updateOrganization.bind(organizationController)
);

// Organization deletion (requires owner only)
router.delete(
  '/:id',
  requireOwnOrg,
  requireOwner,
  organizationController.deleteOrganization.bind(organizationController)
);

// Member management
router.get('/:id/members', requireOwnOrg, organizationController.getMembers.bind(organizationController));

// Invite users (requires admin or owner, checks user limit)
router.post(
  '/:id/invite',
  requireOwnOrg,
  requireAdmin,
  checkResourceLimit('users', 1),
  organizationController.inviteUser.bind(organizationController)
);

// Accept invitation (any authenticated user, checks user limit) — deliberately
// NOT gated by requireOwnOrg: this is how a user joins an org they aren't a
// member of yet, so the target org legitimately differs from their current one.
router.post(
  '/accept-invitation',
  checkResourceLimit('users', 1),
  organizationController.acceptInvitation.bind(organizationController)
);

// Remove users (requires admin or owner)
router.delete(
  '/:id/members/:userId',
  requireOwnOrg,
  requireAdmin,
  organizationController.removeUser.bind(organizationController)
);

// Update user roles (requires admin or owner)
router.patch(
  '/:id/members/:userId/role',
  requireOwnOrg,
  requireAdmin,
  organizationController.updateUserRole.bind(organizationController)
);

// AWS credentials management (requires owner only)
router.post(
  '/:id/aws-credentials',
  requireOwnOrg,
  requireOwner,
  organizationController.setAWSCredentials.bind(organizationController)
);

router.get(
  '/:id/aws-credentials',
  requireOwnOrg,
  requireAdmin,
  organizationController.getAWSCredentials.bind(organizationController)
);

router.delete(
  '/:id/aws-credentials',
  requireOwnOrg,
  requireOwner,
  organizationController.deleteAWSCredentials.bind(organizationController)
);

export default router;
