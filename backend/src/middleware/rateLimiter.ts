/**
 * Rate Limiter Middleware
 * Implements tiered rate limiting based on subscription level
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Extend Express Request type to include user data
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
 * Get rate limit based on subscription tier
 * Different tiers get different request limits per hour
 */
function getRateLimitByTier(tier: string): number {
  const limits: Record<string, number> = {
    free: 100,        // 100 req/hour
    starter: 1000,    // 1,000 req/hour
    pro: 5000,        // 5,000 req/hour
    enterprise: 20000 // 20,000 req/hour
  };
  return limits[tier] || limits.free;
}

/**
 * Main API rate limiter
 * Applies different limits based on user's subscription tier
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window

  // Dynamic limit based on user's subscription tier
  max: (req: Request) => {
    const user = req.user;
    if (!user) return 100; // Unauthenticated requests get free tier limit

    // TODO: Fetch organization's subscription tier from database
    // For now, default to free tier
    const tier = 'free'; // This should come from user.organization?.subscription_tier
    return getRateLimitByTier(tier);
  },

  // Standard headers (RateLimit-* instead of X-RateLimit-*)
  standardHeaders: true,
  legacyHeaders: false,

  // Key generator - rate limit by user ID, otherwise fall back to default IP handler
  keyGenerator: (req: Request) => {
    const user = req.user;
    if (user?.userId) {
      return `user:${user.userId}`;
    }
    // Return undefined to use default IP handler (IPv6 safe)
    return undefined as any;
  },

  // Custom error handler
  handler: (req: Request, res: Response) => {
    const user = req.user;
    const tier = 'free'; // TODO: Get from user.organization?.subscription_tier
    const limit = getRateLimitByTier(tier);

    res.status(429).json({
      success: false,
      error: `Rate limit exceeded. Your ${tier} plan allows ${limit} requests per hour.`,
      tier,
      limit,
      upgrade_url: '/pricing',
      retry_after: 3600, // seconds until window resets
    });
  },

  // Skip rate limiting for certain conditions
  skip: (req: Request) => {
    // Skip rate limiting in development (optional)
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
      return true;
    }
    return false;
  },
});

/**
 * Stricter rate limiter for expensive operations like AWS resource discovery
 * Limits to 10 discoveries per hour regardless of tier
 */
export const discoveryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // Max 10 discoveries per hour

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req: Request) => {
    const user = req.user;
    if (user?.organizationId) {
      return `org:${user.organizationId}`;
    }
    // Return undefined to use default IP handler (IPv6 safe)
    return undefined as any;
  },

  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Discovery rate limit reached. AWS resource discovery is limited to 10 requests per hour to prevent excessive API usage and costs.',
      retry_after: 3600,
    });
  },
});

/**
 * Rate limiter for authentication endpoints (login, register)
 * Prevents brute force attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes

  standardHeaders: true,
  legacyHeaders: false,

  // No keyGenerator - uses default IP handler (IPv6 safe)

  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
      retry_after: 900, // 15 minutes in seconds
    });
  },
});

/**
 * Moderate rate limiter for general API endpoints
 * More lenient than discovery but still protective
 */
export const standardRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute

  standardHeaders: true,
  legacyHeaders: false,

  // No keyGenerator - uses default IP handler (IPv6 safe)

  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please slow down your requests.',
      retry_after: 60,
    });
  },
});