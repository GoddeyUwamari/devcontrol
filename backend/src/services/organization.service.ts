/**
 * Organization Service
 * Handles organization CRUD operations, memberships, and invitations
 */

import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { encryptionService } from './encryption.service';
import { emailService } from './email.service';
import { TIER_LIMITS, assertOrganizationHasSeat } from '../middleware/subscription.middleware';
import {
  OrganizationAccessError,
  canManageRole,
  getActiveMembershipRole,
  isInvitableRole,
  isOrganizationRole,
  lockOrganizationMemberships,
} from './organization-authorization';

interface CreateOrganizationData {
  name: string;
  slug: string;
  displayName: string;
  description?: string;
  createdBy: string; // user ID
}

interface UpdateOrganizationData {
  name?: string;
  displayName?: string;
  description?: string;
  logoUrl?: string;
  settings?: any;
}

interface InviteUserData {
  email: string;
  // Untrusted request input -- validated at runtime in inviteUser().
  role: unknown;
  invitedBy: string;
}

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class OrganizationService {
  /**
   * Create a new organization
   */
  async createOrganization(data: CreateOrganizationData): Promise<any> {
    const { name, slug, displayName, description, createdBy } = data;

    // Validate slug format (alphanumeric and hyphens only)
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slug)) {
      throw new Error('Slug must contain only lowercase letters, numbers, and hyphens');
    }

    // Check if slug already exists
    const existingOrg = await pool.query(
      'SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL',
      [slug]
    );

    if (existingOrg.rows.length > 0) {
      throw new Error('Organization slug already exists');
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create organization
      // Initial limits come from TIER_LIMITS.free (the single authoritative
      // plan-definition source) -- never hard-code Free-tier values here.
      const orgResult = await client.query(
        `INSERT INTO organizations (
          name,
          slug,
          display_name,
          description,
          subscription_tier,
          max_services,
          max_users,
          max_deployments_per_month
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, slug, display_name, description, subscription_tier, created_at`,
        [
          name,
          slug,
          displayName,
          description || null,
          'free',
          TIER_LIMITS.free.maxServices,
          TIER_LIMITS.free.maxUsers,
          TIER_LIMITS.free.maxDeploymentsPerMonth,
        ]
      );

      const organization = orgResult.rows[0];

      // Add creator as owner
      await client.query(
        `INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          joined_at
        ) VALUES ($1, $2, $3, NOW())`,
        [organization.id, createdBy, 'owner']
      );

      await client.query('COMMIT');

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        displayName: organization.display_name,
        description: organization.description,
        subscriptionTier: organization.subscription_tier,
        createdAt: organization.created_at,
        role: 'owner',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get organization by ID
   */
  async getOrganization(organizationId: string): Promise<any> {
    const result = await pool.query(
      `SELECT id, name, slug, display_name, description, logo_url,
              subscription_tier, max_services, max_users, max_deployments_per_month,
              aws_region_default, settings, is_active, created_at, updated_at
       FROM organizations
       WHERE id = $1 AND deleted_at IS NULL`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      throw new Error('Organization not found');
    }

    const org = result.rows[0];

    // Get member count
    const memberCountResult = await pool.query(
      'SELECT COUNT(*) FROM organization_memberships WHERE organization_id = $1 AND is_active = true',
      [organizationId]
    );

    // Get service count
    const serviceCountResult = await pool.query(
      'SELECT COUNT(*) FROM services WHERE organization_id = $1',
      [organizationId]
    );

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: org.display_name,
      description: org.description,
      logoUrl: org.logo_url,
      subscriptionTier: org.subscription_tier,
      maxServices: org.max_services,
      maxUsers: org.max_users,
      maxDeploymentsPerMonth: org.max_deployments_per_month,
      awsRegionDefault: org.aws_region_default,
      settings: org.settings,
      isActive: org.is_active,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      stats: {
        memberCount: parseInt(memberCountResult.rows[0].count),
        serviceCount: parseInt(serviceCountResult.rows[0].count),
      },
    };
  }

  /**
   * Get organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<any> {
    const result = await pool.query(
      'SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL',
      [slug]
    );

    if (result.rows.length === 0) {
      throw new Error('Organization not found');
    }

    return this.getOrganization(result.rows[0].id);
  }

  /**
   * Update organization
   */
  async updateOrganization(
    organizationId: string,
    data: UpdateOrganizationData
  ): Promise<any> {
    const { name, displayName, description, logoUrl, settings } = data;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (displayName !== undefined) {
      updates.push(`display_name = $${paramCount++}`);
      values.push(displayName);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (logoUrl !== undefined) {
      updates.push(`logo_url = $${paramCount++}`);
      values.push(logoUrl);
    }

    if (settings !== undefined) {
      updates.push(`settings = $${paramCount++}`);
      values.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push('updated_at = NOW()');
    values.push(organizationId);

    const result = await pool.query(
      `UPDATE organizations
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND deleted_at IS NULL
       RETURNING id`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Organization not found');
    }

    return this.getOrganization(organizationId);
  }

  /**
   * Delete organization (soft delete)
   */
  async deleteOrganization(organizationId: string): Promise<void> {
    // Check if organization has any services
    const servicesResult = await pool.query(
      'SELECT COUNT(*) FROM services WHERE organization_id = $1',
      [organizationId]
    );

    const serviceCount = parseInt(servicesResult.rows[0].count);

    if (serviceCount > 0) {
      throw new Error(
        `Cannot delete organization with ${serviceCount} active services. Please delete all services first.`
      );
    }

    await pool.query(
      'UPDATE organizations SET deleted_at = NOW() WHERE id = $1',
      [organizationId]
    );
  }

  /**
   * Get organization members
   */
  async getMembers(organizationId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.full_name,
         u.avatar_url,
         om.role,
         om.joined_at,
         om.invited_by,
         om.is_active
       FROM organization_memberships om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1 AND u.deleted_at IS NULL
       ORDER BY
         CASE om.role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'member' THEN 3
           WHEN 'viewer' THEN 4
         END,
         om.joined_at ASC`,
      [organizationId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      role: row.role,
      joinedAt: row.joined_at,
      invitedBy: row.invited_by,
      isActive: row.is_active,
    }));
  }

  /**
   * Invite user to organization
   */
  async inviteUser(
    organizationId: string,
    data: InviteUserData
  ): Promise<{ invitationToken: string }> {
    const { email, role, invitedBy } = data;

    if (!isInvitableRole(role)) {
      throw new OrganizationAccessError('Invalid role. Invitations may grant admin, member, or viewer.', 400);
    }

    // Authorize against the inviter's current membership, not their JWT
    // role: an admin may invite member/viewer only; admins are invited by
    // owners.
    const inviterRole = await getActiveMembershipRole(pool, organizationId, invitedBy);
    if (!inviterRole || !canManageRole(inviterRole, role)) {
      throw new OrganizationAccessError('Insufficient permissions to invite with this role', 403);
    }

    const org = await this.getOrganization(organizationId);

    // Check if user already exists
    let userId: string | null = null;
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;

      // Check if already a member
      const membershipResult = await pool.query(
        'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
        [organizationId, userId]
      );

      if (membershipResult.rows.length > 0) {
        throw new Error('User is already a member of this organization');
      }
    }

    // Generate invitation token
    const invitationToken = encryptionService.generateToken();
    const invitationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    if (userId) {
      // User exists - create a PENDING membership row carrying the
      // invitation. is_active=false explicitly: the column defaults to true,
      // which previously made an unaccepted invitation a live membership
      // everywhere is_active is read (login, /me, member lists, SSO). Only
      // acceptInvitation() activates it.
      await pool.query(
        `INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          invited_by,
          invitation_token,
          invitation_expires_at,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [organizationId, userId, role, invitedBy, invitationToken, invitationExpiry]
      );

      // Only send here: this is the one branch where invitationToken is
      // actually persisted (organization_memberships row above), so the
      // link in the email can later be looked up and accepted. Never
      // throws -- see EmailService.send.
      await emailService.sendInvitationEmail({
        to: email,
        organizationName: org.displayName || org.name,
        role,
        invitationToken,
      });
    } else {
      // User doesn't exist yet - persist a standalone invitation (durable,
      // independent of organization_memberships, which requires a real
      // user_id) so the link can be looked up and completed once they
      // register and call acceptInvitation(). Upsert on
      // (organization_id, lower(email)) WHERE accepted_at IS NULL so
      // re-inviting the same not-yet-registered address refreshes the
      // token/role/expiry instead of accumulating stale pending rows --
      // see 202608231400_create_organization_invitations.sql.
      await pool.query(
        `INSERT INTO organization_invitations (
          organization_id,
          email,
          role,
          invited_by,
          invitation_token,
          invitation_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (organization_id, lower(email)) WHERE accepted_at IS NULL
        DO UPDATE SET
          role = EXCLUDED.role,
          invited_by = EXCLUDED.invited_by,
          invitation_token = EXCLUDED.invitation_token,
          invitation_expires_at = EXCLUDED.invitation_expires_at,
          updated_at = NOW()`,
        [organizationId, email.toLowerCase(), role, invitedBy, invitationToken, invitationExpiry]
      );

      await emailService.sendInvitationEmail({
        to: email,
        organizationName: org.displayName || org.name,
        role,
        invitationToken,
      });

      console.log(
        `📧 Invitation sent to ${email} for organization ${organizationId}`
      );
    }

    return { invitationToken };
  }

  /**
   * Accept invitation
   *
   * An invitation is a request made by its inviter at invite time; it is
   * honored only if it still holds now: the stored role must be a valid
   * invitable role, the inviter must still be an active member currently
   * authorized to grant it, and the organization being JOINED (not the
   * accepting user's own org) must have a free seat.
   */
  async acceptInvitation(invitationToken: string, userId: string): Promise<any> {
    // Unlocked lookup only to learn which org to lock -- the row is re-read
    // under lock below. Taking the org lock before any membership row lock
    // keeps the lock order identical to removeUser()/updateUserRole().
    const lookup = await pool.query(
      `SELECT organization_id FROM organization_memberships
       WHERE invitation_token = $1 AND user_id = $2`,
      [invitationToken, userId]
    );

    if (lookup.rows.length === 0) {
      // Not an organization_memberships invitation for this user -- fall back
      // to a standalone organization_invitations row (inviteUser()'s
      // non-existent-user branch), which the invitee can now redeem since
      // reaching this authenticated endpoint means they've since registered.
      return this.acceptPendingInvitation(invitationToken, userId);
    }

    const organizationId: string = lookup.rows[0].organization_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockOrganizationMemberships(client, organizationId);

      const result = await client.query(
        `SELECT role, invited_by
         FROM organization_memberships
         WHERE invitation_token = $1
           AND invitation_expires_at > NOW()
           AND user_id = $2
           AND organization_id = $3
         FOR UPDATE`,
        [invitationToken, userId, organizationId]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid or expired invitation');
      }

      const { role, invited_by } = result.rows[0];
      await this.assertInvitationStillAuthorized(client, organizationId, role, invited_by);
      await assertOrganizationHasSeat(client, organizationId, userId);

      // Mark as joined
      await client.query(
        `UPDATE organization_memberships
         SET joined_at = NOW(),
             invitation_token = NULL,
             invitation_expires_at = NULL,
             is_active = true
         WHERE invitation_token = $1 AND user_id = $2`,
        [invitationToken, userId]
      );

      await client.query('COMMIT');

      return {
        organizationId,
        role,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Accept a standalone invitation (organization_invitations) issued to an
   * email that had no account at invite time. The invitee must have
   * registered by now -- acceptInvitation() is only reachable authenticated.
   */
  private async acceptPendingInvitation(invitationToken: string, userId: string): Promise<any> {
    const userResult = await pool.query(
      'SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('Invalid or expired invitation');
    }

    const accountEmail: string = userResult.rows[0].email;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // FOR UPDATE: prevents a concurrent double-accept of the same
      // invitation from both passing the accepted_at IS NULL check.
      const invitationResult = await client.query(
        `SELECT id, organization_id, email, role, invited_by
         FROM organization_invitations
         WHERE invitation_token = $1
           AND invitation_expires_at > NOW()
           AND accepted_at IS NULL
         FOR UPDATE`,
        [invitationToken]
      );

      if (invitationResult.rows.length === 0) {
        throw new Error('Invalid or expired invitation');
      }

      const invitation = invitationResult.rows[0];

      if (invitation.email.toLowerCase() !== accountEmail.toLowerCase()) {
        throw new Error('This invitation was sent to a different email address');
      }

      await lockOrganizationMemberships(client, invitation.organization_id);
      await this.assertInvitationStillAuthorized(
        client,
        invitation.organization_id,
        invitation.role,
        invitation.invited_by
      );

      const existingMembership = await client.query(
        'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
        [invitation.organization_id, userId]
      );

      if (existingMembership.rows.length > 0) {
        throw new Error('User is already a member of this organization');
      }

      await assertOrganizationHasSeat(client, invitation.organization_id, userId);

      await client.query(
        `INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          invited_by,
          joined_at,
          is_active
        ) VALUES ($1, $2, $3, $4, NOW(), true)`,
        [invitation.organization_id, userId, invitation.role, invitation.invited_by]
      );

      await client.query(
        `UPDATE organization_invitations
         SET accepted_at = NOW(), accepted_user_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [userId, invitation.id]
      );

      await client.query('COMMIT');

      return {
        organizationId: invitation.organization_id,
        role: invitation.role,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Re-validates a stored invitation at acceptance time: the stored role is
   * never trusted as-is, and an invitation whose inviter has since lost the
   * authority to grant that role (demoted, removed, deactivated) is void.
   */
  private async assertInvitationStillAuthorized(
    client: PoolClient,
    organizationId: string,
    role: unknown,
    invitedBy: string | null
  ): Promise<void> {
    if (!isInvitableRole(role)) {
      throw new Error('Invalid or expired invitation');
    }
    const inviterRole = invitedBy
      ? await getActiveMembershipRole(client, organizationId, invitedBy)
      : null;
    if (!inviterRole || !canManageRole(inviterRole, role)) {
      throw new OrganizationAccessError(
        'This invitation is no longer valid. Ask an organization owner or admin to send a new one.',
        403
      );
    }
  }

  /**
   * Throws unless at least one active, accepted owner other than
   * `excludedUserId` would remain. Must run under lockOrganizationMemberships.
   */
  private async assertAnotherOwnerRemains(
    client: PoolClient,
    organizationId: string,
    excludedUserId: string,
    message: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT COUNT(*) FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
         AND om.user_id <> $2
         AND om.role = 'owner'
         AND om.is_active = true
         AND om.invitation_token IS NULL
         AND u.is_active = true
         AND u.deleted_at IS NULL`,
      [organizationId, excludedUserId]
    );
    if (parseInt(result.rows[0].count) === 0) {
      throw new Error(message);
    }
  }

  /**
   * Remove user from organization
   *
   * `actorUserId` is the authenticated caller (from their token, never the
   * request body). Authorized against the caller's current membership; see
   * organization-authorization.ts for the policy.
   */
  async removeUser(organizationId: string, actorUserId: string, userId: string): Promise<void> {
    if (actorUserId === userId) {
      throw new OrganizationAccessError('You cannot remove your own membership', 403);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockOrganizationMemberships(client, organizationId);

      const actorRole = await getActiveMembershipRole(client, organizationId, actorUserId);
      if (!actorRole) {
        throw new OrganizationAccessError('Insufficient permissions', 403);
      }

      // Any membership row, pending or active -- removing a pending
      // existing-user invitation is how it is revoked.
      const target = await client.query(
        `SELECT role, is_active, invitation_token FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId]
      );

      if (target.rows.length === 0) {
        throw new OrganizationAccessError('User is not a member of this organization', 404);
      }

      if (!canManageRole(actorRole, target.rows[0].role)) {
        throw new OrganizationAccessError('Insufficient permissions to remove this member', 403);
      }

      if (target.rows[0].role === 'owner') {
        await this.assertAnotherOwnerRemains(
          client,
          organizationId,
          userId,
          'Cannot remove the only owner. Transfer ownership or add another owner first.'
        );
      }

      await client.query(
        `DELETE FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update user role
   *
   * `actorUserId` is the authenticated caller; `newRole` is untrusted
   * request input and is validated at runtime here.
   */
  async updateUserRole(
    organizationId: string,
    actorUserId: string,
    userId: string,
    newRole: unknown
  ): Promise<void> {
    if (!isOrganizationRole(newRole)) {
      throw new OrganizationAccessError('Invalid role. Must be one of: owner, admin, member, viewer', 400);
    }

    if (actorUserId === userId) {
      throw new OrganizationAccessError('You cannot change your own role', 403);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockOrganizationMemberships(client, organizationId);

      const actorRole = await getActiveMembershipRole(client, organizationId, actorUserId);
      if (!actorRole) {
        throw new OrganizationAccessError('Insufficient permissions', 403);
      }

      // Only an active, accepted membership has a role to change; a pending
      // invitation's role is fixed by (and re-validated against) its inviter.
      const target = await client.query(
        `SELECT role FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2
           AND is_active = true AND invitation_token IS NULL`,
        [organizationId, userId]
      );

      if (target.rows.length === 0) {
        throw new OrganizationAccessError('User is not a member of this organization', 404);
      }

      const currentRole = target.rows[0].role;

      if (!canManageRole(actorRole, currentRole) || !canManageRole(actorRole, newRole)) {
        throw new OrganizationAccessError('Insufficient permissions to assign this role', 403);
      }

      if (currentRole === 'owner' && newRole !== 'owner') {
        await this.assertAnotherOwnerRemains(
          client,
          organizationId,
          userId,
          'Cannot change role of the only owner. Add another owner first.'
        );
      }

      await client.query(
        `UPDATE organization_memberships
         SET role = $1, updated_at = NOW()
         WHERE organization_id = $2 AND user_id = $3`,
        [newRole, organizationId, userId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user's organizations
   */
  async getUserOrganizations(userId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT
         o.id,
         o.name,
         o.slug,
         o.display_name,
         o.logo_url,
         o.subscription_tier,
         om.role,
         o.created_at
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1
         AND om.is_active = true
         AND o.is_active = true
         AND o.deleted_at IS NULL
       ORDER BY om.created_at ASC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      displayName: row.display_name,
      logoUrl: row.logo_url,
      subscriptionTier: row.subscription_tier,
      role: row.role,
      createdAt: row.created_at,
    }));
  }

  /**
   * Set AWS credentials for organization
   */
  async setAWSCredentials(
    organizationId: string,
    credentials: AWSCredentials
  ): Promise<void> {
    const encrypted = encryptionService.encryptAWSCredentials(credentials);

    await pool.query(
      `UPDATE organizations
       SET aws_credentials_encrypted = $1,
           aws_region_default = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [encrypted, credentials.region || 'us-east-1', organizationId]
    );
  }

  /**
   * Get AWS credentials for organization
   */
  async getAWSCredentials(organizationId: string): Promise<AWSCredentials | null> {
    const result = await pool.query(
      `SELECT aws_credentials_encrypted FROM organizations WHERE id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0 || !result.rows[0].aws_credentials_encrypted) {
      return null;
    }

    return encryptionService.decryptAWSCredentials(
      result.rows[0].aws_credentials_encrypted
    );
  }

  /**
   * Delete AWS credentials
   */
  async deleteAWSCredentials(organizationId: string): Promise<void> {
    await pool.query(
      `UPDATE organizations
       SET aws_credentials_encrypted = NULL, updated_at = NOW()
       WHERE id = $1`,
      [organizationId]
    );
  }
}

// Export singleton instance
export const organizationService = new OrganizationService();
