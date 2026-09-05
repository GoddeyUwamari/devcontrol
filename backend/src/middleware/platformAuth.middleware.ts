/**
 * TRUE platform-level (DevControl staff) authorization -- distinct from and
 * independent of rbac.middleware.ts's requireOwner/requireAdmin, which check
 * organization_memberships.role (a per-tenant identity concern that every
 * self-service customer automatically satisfies for their own organization).
 *
 * See database/migrations/202609051200_create_platform_staff.sql for the
 * table this checks and why it deliberately has no organization_id.
 *
 * Note on RLS: unlike analytics_events/onboarding_progress, `platform_staff`
 * has NO row-level security policy at all (it isn't organization-scoped),
 * so the plain, request-context-aware `pool.query()` below is correct and
 * sufficient here -- there is no per-org RLS filtering for it to be
 * accidentally scoped by. This is a different situation from the
 * analytics_events cross-org aggregation problem documented in
 * activationFunnel.service.ts; do not assume the two require the same fix.
 */
import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

export async function requirePlatformStaff(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  try {
    // Existence-only lookup (SELECT 1, not SELECT *) -- the middleware only
    // needs to know whether an active row exists, never the row's contents.
    // Deliberately does NOT consult organization_memberships.role: platform
    // authorization must never be inferable from a tenant role, no matter
    // which organization happens to be active on the caller's JWT.
    const result = await pool.query(
      `SELECT 1 FROM platform_staff WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(403).json({
        success: false,
        error: 'Platform staff authorization required',
      });
      return;
    }

    next();
  } catch (error) {
    // Fail closed: a lookup failure must never be interpreted as "active
    // staff." Log internally (matching this codebase's existing
    // console.error convention -- no dedicated logger exists here), never
    // leak the underlying DB error to the caller.
    console.error('[requirePlatformStaff] platform_staff lookup failed:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization check failed',
    });
  }
}
