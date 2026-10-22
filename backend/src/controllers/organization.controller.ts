/**
 * Organization Controller
 * Handles organization-related HTTP requests
 */

import { Request, Response } from 'express';
import { organizationService } from '../services/organization.service';
import { auditRequestContext } from '../services/auditEvents.service';
import { OrganizationAccessError, OrganizationRole } from '../services/organization-authorization';
import type { WebSocketServer } from '../websocket/server';

/**
 * Status for a failed membership operation: authorization/seat errors from
 * the service carry their own (403/404/402), everything else keeps this
 * controller's existing 400.
 */
function membershipErrorResponse(res: Response, error: any, fallback: string): void {
  const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
  res.status(status).json({
    success: false,
    error: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

/**
 * Error response for the member role-change and removal endpoints. Only an
 * OrganizationAccessError (a deliberate authorization or business-rule
 * refusal) reaches the client with its own status and message. Anything
 * else -- including database errors, whose text can describe the schema or
 * the rejected input -- is logged here and answered with a generic message.
 */
function memberMutationErrorResponse(res: Response, error: unknown, fallback: string): void {
  if (error instanceof OrganizationAccessError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  console.error(`[Organizations] ${fallback}:`, error);
  res.status(500).json({ success: false, error: fallback });
}

/**
 * Brings a member's open live-update sockets in line with a membership change
 * that has already committed. Never fails the request: the change itself has
 * succeeded, and every socket is re-checked against membership at handshake.
 */
function syncMemberSockets(req: Request, apply: (ws: WebSocketServer) => void): void {
  const ws = req.app.get('wsServer') as WebSocketServer | undefined;
  if (!ws) return;
  try {
    apply(ws);
  } catch (error) {
    console.error('[Organizations] Failed to update member sockets:', error);
  }
}

export class OrganizationController {
  /**
   * POST /api/organizations
   * Create a new organization
   */
  async createOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { name, slug, displayName, description } = req.body;

      if (!name || !slug || !displayName) {
        res.status(400).json({
          success: false,
          error: 'Name, slug, and display name are required',
        });
        return;
      }

      const organization = await organizationService.createOrganization({
        name,
        slug,
        displayName,
        description,
        createdBy: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: organization,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create organization',
      });
    }
  }

  /**
   * GET /api/organizations
   * Get user's organizations
   */
  async getOrganizations(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const organizations = await organizationService.getUserOrganizations(
        req.user.userId
      );

      res.status(200).json({
        success: true,
        data: organizations,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to get organizations',
      });
    }
  }

  /**
   * GET /api/organizations/:id
   * Get organization by ID
   */
  async getOrganization(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const organization = await organizationService.getOrganization(id);

      res.status(200).json({
        success: true,
        data: organization,
      });
    } catch (error: any) {
      res.status(404).json({
        success: false,
        error: error.message || 'Organization not found',
      });
    }
  }

  /**
   * GET /api/organizations/slug/:slug
   * Get organization by slug
   */
  async getOrganizationBySlug(req: Request, res: Response): Promise<void> {
    try {
      const { slug } = req.params;

      const organization = await organizationService.getOrganizationBySlug(slug);

      // Slug -> org isn't known until after the lookup, so ownership can't be
      // checked via route middleware the way :id routes do — verify here instead.
      if (!req.user || organization.id !== req.user.organizationId) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: organization,
      });
    } catch (error: any) {
      res.status(404).json({
        success: false,
        error: error.message || 'Organization not found',
      });
    }
  }

  /**
   * PATCH /api/organizations/:id
   * Update organization
   */
  async updateOrganization(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, displayName, description, logoUrl, settings } = req.body;

      const organization = await organizationService.updateOrganization(id, {
        name,
        displayName,
        description,
        logoUrl,
        settings,
      });

      res.status(200).json({
        success: true,
        data: organization,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update organization',
      });
    }
  }

  /**
   * DELETE /api/organizations/:id
   * Delete organization
   */
  async deleteOrganization(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await organizationService.deleteOrganization(id);

      res.status(200).json({
        success: true,
        message: 'Organization deleted successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to delete organization',
      });
    }
  }

  /**
   * GET /api/organizations/:id/members
   * Get organization members
   */
  async getMembers(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const members = await organizationService.getMembers(id);

      res.status(200).json({
        success: true,
        data: members,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to get members',
      });
    }
  }

  /**
   * POST /api/organizations/:id/invite
   * Invite user to organization
   */
  async inviteUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id } = req.params;
      const { email, role } = req.body;

      if (!email || !role) {
        res.status(400).json({
          success: false,
          error: 'Email and role are required',
        });
        return;
      }

      const result = await organizationService.inviteUser(
        id,
        {
          email,
          role,
          invitedBy: req.user.userId,
        },
        auditRequestContext(req)
      );

      res.status(200).json({
        success: true,
        message: 'Invitation sent successfully',
        data: result,
      });
    } catch (error: any) {
      membershipErrorResponse(res, error, 'Failed to invite user');
    }
  }

  /**
   * POST /api/organizations/accept-invitation
   * Accept organization invitation
   */
  async acceptInvitation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { invitationToken } = req.body;

      if (!invitationToken) {
        res.status(400).json({
          success: false,
          error: 'Invitation token is required',
        });
        return;
      }

      const result = await organizationService.acceptInvitation(
        invitationToken,
        req.user.userId,
        auditRequestContext(req)
      );

      res.status(200).json({
        success: true,
        message: 'Invitation accepted successfully',
        data: result,
      });
    } catch (error: any) {
      membershipErrorResponse(res, error, 'Failed to accept invitation');
    }
  }

  /**
   * DELETE /api/organizations/:id/members/:userId
   * Remove user from organization
   */
  async removeUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id, userId } = req.params;

      // The caller is always the authenticated token's user -- :userId is
      // only ever the TARGET membership.
      await organizationService.removeUser(id, req.user.userId, userId, auditRequestContext(req));
      syncMemberSockets(req, (ws) => ws.disconnectUserFromOrganization(userId, id));

      res.status(200).json({
        success: true,
        message: 'User removed from organization successfully',
      });
    } catch (error: any) {
      memberMutationErrorResponse(res, error, 'Failed to remove user');
    }
  }

  /**
   * PATCH /api/organizations/:id/members/:userId/role
   * Update user role
   */
  async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        res.status(400).json({
          success: false,
          error: 'Role is required',
        });
        return;
      }

      // The caller is always the authenticated token's user -- :userId is
      // only ever the TARGET membership; role is validated in the service.
      await organizationService.updateUserRole(id, req.user.userId, userId, role, auditRequestContext(req));
      // updateUserRole only succeeds for a valid role.
      syncMemberSockets(req, (ws) => ws.updateUserRoleInOrganization(userId, id, role as OrganizationRole));

      res.status(200).json({
        success: true,
        message: 'User role updated successfully',
      });
    } catch (error: any) {
      memberMutationErrorResponse(res, error, 'Failed to update user role');
    }
  }

  /**
   * GET /api/organizations/:id/aws-credentials
   * Whether legacy AWS credentials are stored (never the keys themselves)
   */
  async getAWSCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const status = await organizationService.getAWSCredentialsStatus(id);

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to get AWS credentials',
      });
    }
  }

  /**
   * DELETE /api/organizations/:id/aws-credentials
   * Delete AWS credentials
   */
  async deleteAWSCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await organizationService.deleteAWSCredentials(id);

      res.status(200).json({
        success: true,
        message: 'AWS credentials deleted successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to delete AWS credentials',
      });
    }
  }
}

export const organizationController = new OrganizationController();
