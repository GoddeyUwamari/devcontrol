/**
 * Authentication Middleware
 * Validates JWT tokens, authorizes the caller against their current
 * organization membership, and sets organization context for RLS
 */

import { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { getCurrentMembership } from '../services/organization-authorization';
import { pool, requestContext } from '../config/database';

/** 401 code: the token is valid but its organization membership is not. */
export const MEMBERSHIP_REVOKED_CODE = 'MEMBERSHIP_REVOKED';
/** 503 code: authorization could not be checked (database or pool failure). */
export const AUTH_UNAVAILABLE_CODE = 'AUTH_UNAVAILABLE';

const SET_TENANT_TAG_SQL = "SELECT set_config('app.current_organization_id', $1, false)";

/** The claims a membership lookup is keyed on; anything else is an invalid token. */
export const membershipClaimsSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

/**
 * Check out a dedicated client, set RLS context on it, and run `next()` (and
 * everything downstream — route handlers, services, repositories — via
 * AsyncLocalStorage) inside that context, so plain `pool.query()` calls
 * anywhere in the request automatically use this exact, correctly-tagged
 * connection instead of a fresh one from the pool that may carry a stale or
 * different org's RLS tag. Released once the response finishes (or the
 * connection drops before it does).
 *
 * Exported for use by routes that need RLS context but aren't reached via
 * `authenticate` — e.g. github-webhook.routes.ts, which is authenticated by
 * GitHub's HMAC signature rather than a user JWT and so never runs through
 * that middleware, but still needs its `pool.query()` calls scoped to an org
 * for tables with RLS policies (services, deployments). It performs no
 * membership check: callers must already have authorized `organizationId`.
 */
export async function runWithOrgClient(
  organizationId: string,
  res: Response,
  next: NextFunction
): Promise<void> {
  const client = await pool.connect();

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };
  res.on('finish', release);
  res.on('close', release);

  await client.query(SET_TENANT_TAG_SQL, [organizationId]);

  requestContext.run(client, next);
}

// Extend Express Request type to include user and organization data
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        organizationId: string;
        role: string;
      };
      organizationId?: string;
    }
  }
}

function invalidToken(res: Response): void {
  res.status(401).json({
    success: false,
    error: 'Invalid authentication token',
  });
}

/**
 * Middleware to authenticate requests using JWT
 *
 * Order matters: the token identifies the caller and organization, then the
 * caller's current membership in that organization is read -- on the
 * request's own, still-untagged connection -- and only if it is active is
 * the connection tagged for RLS and the request allowed through. The role on
 * req.user is the membership's current role, never the token's claim, so
 * every role gate downstream authorizes against current membership.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'No authentication token provided',
    });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  let decoded: ReturnType<typeof authService.verifyToken>;
  try {
    decoded = authService.verifyToken(token);
  } catch (error: any) {
    if (error.message === 'Token has expired') {
      res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }
    invalidToken(res);
    return;
  }

  if (decoded.type !== 'access') {
    res.status(401).json({
      success: false,
      error: 'Invalid token type',
    });
    return;
  }

  const claims = membershipClaimsSchema.safeParse(decoded);
  if (!claims.success) {
    invalidToken(res);
    return;
  }
  const { userId, organizationId } = claims.data;

  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error: any) {
    console.error('[auth] could not acquire a database connection:', error?.message ?? error);
    authUnavailable(res);
    return;
  }

  let released = false;
  const release = (err?: Error) => {
    if (!released) {
      released = true;
      client.release(err);
    }
  };
  res.on('finish', () => release());
  res.on('close', () => release());

  let membership: Awaited<ReturnType<typeof getCurrentMembership>>;
  try {
    membership = await getCurrentMembership(client, organizationId, userId);
    // The caller disconnected while the lookup ran: the connection is
    // already back in the pool and may belong to another request now.
    if (released) return;
    if (membership) {
      // Set PostgreSQL session variable for Row-Level Security -- only now
      // that the caller is known to belong to this organization.
      await client.query(SET_TENANT_TAG_SQL, [organizationId]);
    }
  } catch (error: any) {
    console.error('[auth] membership check failed:', error?.message ?? error);
    // Destroy rather than reuse a connection in an unknown state.
    release(error instanceof Error ? error : new Error(String(error)));
    authUnavailable(res);
    return;
  }

  if (!membership) {
    // Never tagged, so it goes back to the pool untouched.
    release();
    res.status(401).json({
      success: false,
      error: 'Organization membership is not active',
      code: MEMBERSHIP_REVOKED_CODE,
    });
    return;
  }

  req.user = {
    userId,
    email: membership.email,
    organizationId,
    role: membership.role,
  };
  req.organizationId = organizationId;

  // Same check after tagging: nothing runs on a connection that has been
  // returned to the pool.
  if (released) return;
  requestContext.run(client, () => {
    // Track API request for usage metering (fire-and-forget, non-blocking)
    pool.query(
      `INSERT INTO api_usage (organization_id, hour, request_count)
       VALUES ($1, date_trunc('hour', NOW()), 1)
       ON CONFLICT (organization_id, hour)
       DO UPDATE SET request_count = api_usage.request_count + 1`,
      [organizationId]
    ).catch(() => { /* non-critical */ });

    next();
  });
};

function authUnavailable(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'Authentication temporarily unavailable',
    code: AUTH_UNAVAILABLE_CODE,
  });
}

// Export alias for backwards compatibility
export const authenticateToken = authenticate;
