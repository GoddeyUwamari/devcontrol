/**
 * Authentication Middleware
 * Validates JWT tokens and sets organization context for RLS
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { pool } from '../config/database';

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

    // Set PostgreSQL session variable for Row-Level Security
    // This ensures all queries automatically filter by organization_id
    await pool.query(
      "SELECT set_config('app.current_organization_id', $1, false)",
      [decoded.organizationId]
    );

    next();
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

      await pool.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [decoded.organizationId]
      );
    }

    next();
  } catch (error) {
    // Invalid token, but don't fail the request
    next();
  }
};

// Export alias for backwards compatibility
export const authenticateToken = authenticate;
