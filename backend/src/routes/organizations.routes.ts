/**
 * Organization Routes
 */

import { Router } from 'express';
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

// All organization routes require authentication
router.use(authenticate);

// Organization CRUD
router.post('/', organizationController.createOrganization.bind(organizationController));
router.get('/', organizationController.getOrganizations.bind(organizationController));
router.get('/:id', organizationController.getOrganization.bind(organizationController));
router.get('/slug/:slug', organizationController.getOrganizationBySlug.bind(organizationController));

// Organization updates (requires admin or owner)
router.patch(
  '/:id',
  requireAdmin,
  organizationController.updateOrganization.bind(organizationController)
);

// Organization deletion (requires owner only)
router.delete(
  '/:id',
  requireOwner,
  organizationController.deleteOrganization.bind(organizationController)
);

// Member management
router.get('/:id/members', organizationController.getMembers.bind(organizationController));

// Invite users (requires admin or owner, checks user limit)
router.post(
  '/:id/invite',
  requireAdmin,
  checkResourceLimit('users', 1),
  organizationController.inviteUser.bind(organizationController)
);

// Accept invitation (any authenticated user, checks user limit)
router.post(
  '/accept-invitation',
  checkResourceLimit('users', 1),
  organizationController.acceptInvitation.bind(organizationController)
);

// Remove users (requires admin or owner)
router.delete(
  '/:id/members/:userId',
  requireAdmin,
  organizationController.removeUser.bind(organizationController)
);

// Update user roles (requires admin or owner)
router.patch(
  '/:id/members/:userId/role',
  requireAdmin,
  organizationController.updateUserRole.bind(organizationController)
);

// AWS credentials management (requires owner only)
router.post(
  '/:id/aws-credentials',
  requireOwner,
  organizationController.setAWSCredentials.bind(organizationController)
);

router.get(
  '/:id/aws-credentials',
  requireAdmin,
  organizationController.getAWSCredentials.bind(organizationController)
);

router.delete(
  '/:id/aws-credentials',
  requireOwner,
  organizationController.deleteAWSCredentials.bind(organizationController)
);

export default router;
