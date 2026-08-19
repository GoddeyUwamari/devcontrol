/**
 * Authentication Middleware
 * Validates JWT tokens and sets organization context for RLS
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { pool, requestContext } from '../config/database';

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
 * `authenticate`/`optionalAuthenticate` — e.g. github-webhook.routes.ts,
 * which is authenticated by GitHub's HMAC signature rather than a user JWT
 * and so never runs through those middlewares, but still needs its
 * `pool.query()` calls scoped to an org for tables with RLS policies
 * (services, deployments).
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

  await client.query(
    "SELECT set_config('app.current_organization_id', $1, false)",
    [organizationId]
  );

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

/**
 * Middleware to authenticate requests using JWT
 * Sets user information and organization context
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
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

    // Verify token
    const decoded = authService.verifyToken(token);

    if (decoded.type !== 'access') {
      res.status(401).json({
        success: false,
        error: 'Invalid token type',
      });
      return;
    }

    // Set user information on request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      organizationId: decoded.organizationId,
      role: decoded.role,
    };

    req.organizationId = decoded.organizationId;

    // Set PostgreSQL session variable for Row-Level Security on a dedicated,
    // request-scoped connection — see runWithOrgClient — so every query for
    // this request (including the one below) is guaranteed to run on a
    // connection actually tagged for this org.
    await runWithOrgClient(decoded.organizationId, res, () => {
      // Track API request for usage metering (fire-and-forget, non-blocking)
      pool.query(
        `INSERT INTO api_usage (organization_id, hour, request_count)
         VALUES ($1, date_trunc('hour', NOW()), 1)
         ON CONFLICT (organization_id, hour)
         DO UPDATE SET request_count = api_usage.request_count + 1`,
        [decoded.organizationId]
      ).catch(() => { /* non-critical */ });

      next();
    });
  } catch (error: any) {
    if (error.message === 'Token has expired') {
      res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: 'Invalid authentication token',
    });
  }
};

/**
 * Optional authentication middleware
 * Does not fail if token is missing, but validates if present
 */
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = authService.verifyToken(token);

    if (decoded.type === 'access') {
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        organizationId: decoded.organizationId,
        role: decoded.role,
      };

      req.organizationId = decoded.organizationId;

      await runWithOrgClient(decoded.organizationId, res, next);
      return;
    }

    next();
  } catch (error) {
    // Invalid token, but don't fail the request
    next();
  }
};

// Export alias for backwards compatibility
export const authenticateToken = authenticate;
