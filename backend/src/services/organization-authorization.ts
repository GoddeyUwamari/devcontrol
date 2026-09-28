/**
 * Organization role authorization
 *
 * The single source of truth for which organization roles exist and which
 * roles a caller may grant, change, or remove. Every membership mutation
 * (role change, removal, invitation, invitation acceptance) and every
 * owner-only security operation (SSO configuration) authorizes against the
 * caller's CURRENT membership row read here -- never against the role
 * claim in their JWT, which can be days stale (see auth.service.ts's
 * refreshAccessToken, which copies the old claim forward), and never
 * against anything the client sent.
 *
 * Policy:
 *   - owner  may manage owner/admin/member/viewer memberships.
 *   - admin  may manage member/viewer memberships only -- never owners or
 *            peer admins, and may only invite member/viewer.
 *   - member / viewer may not manage memberships at all.
 *   - Nobody may change or remove their own membership through the
 *     membership-management endpoints (enforced by the callers).
 */

import { Pool, PoolClient } from 'pg';

export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Roles an invitation may carry. Owners are made by promotion, never by invite. */
export const INVITABLE_ROLES: readonly OrganizationRole[] = ['admin', 'member', 'viewer'];

/**
 * Runtime role check -- TypeScript types are erased and never reach the
 * request body or a database column, so every role that crosses a trust
 * boundary goes through this.
 */
export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function isInvitableRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && (INVITABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Whether a caller holding `actorRole` may create, modify, or remove a
 * membership whose role is (or would become) `targetRole`. Callers check
 * both the target's current role and the requested new role, and validate
 * a requested new role with isOrganizationRole/isInvitableRole first -- an
 * owner may act on a membership whose STORED role is malformed (to repair
 * or remove it), which is why owner is not restricted to valid roles here.
 */
export function canManageRole(actorRole: OrganizationRole, targetRole: unknown): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'member' || targetRole === 'viewer';
  return false;
}

/**
 * Carries the HTTP status the controller should answer with, so an
 * authorization refusal is a 403 rather than the generic 400 the
 * organization controller uses for every other service error.
 */
export class OrganizationAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'OrganizationAccessError';
  }
}

/**
 * The caller's current role in `organizationId`, or null unless they hold an
 * active, ACCEPTED membership with a valid role on an active, non-deleted
 * user account. A pending invitation (invitation_token still set) is not a
 * membership for authorization purposes, whatever its is_active value.
 */
export async function getActiveMembershipRole(
  executor: Pool | PoolClient,
  organizationId: string,
  userId: string
): Promise<OrganizationRole | null> {
  const result = await executor.query(
    `SELECT om.role
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1
        AND om.user_id = $2
        AND om.is_active = true
        AND om.invitation_token IS NULL
        AND u.is_active = true
        AND u.deleted_at IS NULL`,
    [organizationId, userId]
  );
  const role = result.rows[0]?.role;
  return isOrganizationRole(role) ? role : null;
}

/**
 * Serializes membership mutations for one organization for the rest of the
 * caller's transaction, so check-then-write sequences (last-owner
 * protection, seat limits) can't interleave -- e.g. two owners demoting each
 * other concurrently and both seeing "one other owner remains".
 */
export async function lockOrganizationMemberships(
  client: PoolClient,
  organizationId: string
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('organization_memberships:' || $1::text, 0))",
    [organizationId]
  );
}

/**
 * Throws 403 unless `userId` currently holds one of `allowedRoles` in
 * `organizationId`.
 */
export async function requireCurrentRole(
  executor: Pool | PoolClient,
  organizationId: string,
  userId: string,
  allowedRoles: readonly OrganizationRole[]
): Promise<OrganizationRole> {
  const role = await getActiveMembershipRole(executor, organizationId, userId);
  if (!role || !allowedRoles.includes(role)) {
    throw new OrganizationAccessError('Insufficient permissions', 403);
  }
  return role;
}
