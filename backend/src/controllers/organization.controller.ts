/**
 * Organization Controller
 * Handles organization-related HTTP requests
 */

import { Request, Response } from 'express';
import { organizationService } from '../services/organization.service';

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

      const result = await organizationService.inviteUser(id, {
        email,
        role,
        invitedBy: req.user.userId,
      });

      res.status(200).json({
        success: true,
        message: 'Invitation sent successfully',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to invite user',
      });
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
        req.user.userId
      );

      res.status(200).json({
        success: true,
        message: 'Invitation accepted successfully',
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to accept invitation',
      });
    }
  }

  /**
   * DELETE /api/organizations/:id/members/:userId
   * Remove user from organization
   */
  async removeUser(req: Request, res: Response): Promise<void> {
    try {
      const { id, userId } = req.params;

      await organizationService.removeUser(id, userId);

      res.status(200).json({
        success: true,
        message: 'User removed from organization successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to remove user',
      });
    }
  }

  /**
   * PATCH /api/organizations/:id/members/:userId/role
   * Update user role
   */
  async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      const { id, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        res.status(400).json({
          success: false,
          error: 'Role is required',
        });
        return;
      }

      await organizationService.updateUserRole(id, userId, role);

      res.status(200).json({
        success: true,
        message: 'User role updated successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update user role',
      });
    }
  }

  /**
   * POST /api/organizations/:id/aws-credentials
   * Set AWS credentials
   */
  async setAWSCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { accessKeyId, secretAccessKey, region } = req.body;

      if (!accessKeyId || !secretAccessKey) {
        res.status(400).json({
          success: false,
          error: 'AWS access key ID and secret access key are required',
        });
        return;
      }

      await organizationService.setAWSCredentials(id, {
        accessKeyId,
        secretAccessKey,
        region,
      });

      // Emit onboarding event for AWS connection
      const user = (req as any).user;
      if (user) {
        const { emitOnboardingEvent } = require('../services/onboardingEvents');
        emitOnboardingEvent('aws:connected', {
          organizationId: id,
          userId: user.userId || user.id,
        });
      }

      res.status(200).json({
        success: true,
        message: 'AWS credentials saved successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to save AWS credentials',
      });
    }
  }

  /**
   * GET /api/organizations/:id/aws-credentials
   * Get AWS credentials (returns only if exists, not the actual keys)
   */
  async getAWSCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const credentials = await organizationService.getAWSCredentials(id);

      res.status(200).json({
        success: true,
        data: {
          hasCredentials: !!credentials,
          region: credentials?.region || null,
        },
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
