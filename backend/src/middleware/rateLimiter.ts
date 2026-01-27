/**
 * Rate Limiter Middleware
 * Implements tiered rate limiting based on subscription level
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { pool } from '../config/database';
import { SubscriptionTier } from './subscription.middleware';

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
    free: 500,        // 500 req/hour
    starter: 2000,    // 2,000 req/hour
    pro: 5000,        // 5,000 req/hour
    enterprise: 20000 // 20,000 req/hour
  };
  return limits[tier] || limits.free;
}

/**
 * Fetch organization's subscription tier from database
 * Caches the result per request to avoid multiple DB queries
 */
const tierCache = new Map<string, { tier: SubscriptionTier; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getOrganizationTier(organizationId: string): Promise<SubscriptionTier> {
  // Check cache first
  const cached = tierCache.get(organizationId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.tier;
  }

  try {
    const result = await pool.query(
      'SELECT subscription_tier FROM organizations WHERE id = $1 AND deleted_at IS NULL',
      [organizationId]
    );

    if (result.rows.length === 0) {
      return 'free'; // Default to free if org not found
    }

    const tier = (result.rows[0].subscription_tier as SubscriptionTier) || 'free';

    // Update cache
    tierCache.set(organizationId, { tier, timestamp: Date.now() });

    return tier;
  } catch (error) {
    console.error('Error fetching organization tier for rate limiting:', error);
    return 'free'; // Fail safe to free tier
  }
}

/**
 * Main API rate limiter
 * Applies different limits based on user's subscription tier
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window

  // Dynamic limit based on user's subscription tier
  max: async (req: Request) => {
    const user = req.user;
    if (!user || !user.organizationId) {
      return 500; // Unauthenticated requests get free tier limit
    }

    // Fetch organization's subscription tier from database
    const tier = await getOrganizationTier(user.organizationId);
    const limit = getRateLimitByTier(tier);

    // Store tier in request for use in handler
    (req as any).rateLimitTier = tier;

    return limit;
  },

  // Standard headers (RateLimit-* instead of X-RateLimit-*)
  standardHeaders: true,
  legacyHeaders: false,

  // Key generator - rate limit by organization ID for fair limiting across team members
  keyGenerator: (req: Request) => {
    const user = req.user;
    if (user?.organizationId) {
      return `org:${user.organizationId}`;
    }
    // Return undefined to use default IP handler (IPv6 safe)
    return undefined as any;
  },

  // Custom error handler
  handler: async (req: Request, res: Response) => {
    const user = req.user;
    let tier: SubscriptionTier = 'free';

    // Try to get tier from request (set in max function) or fetch it
    if ((req as any).rateLimitTier) {
      tier = (req as any).rateLimitTier;
    } else if (user?.organizationId) {
      tier = await getOrganizationTier(user.organizationId);
    }

    const limit = getRateLimitByTier(tier);

    res.status(429).json({
      success: false,
      error: `Rate limit exceeded. Your ${tier} plan allows ${limit} requests per hour.`,
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        tier,
        limit,
        window: '1 hour',
        message: `You have exceeded the rate limit for your ${tier} subscription tier.`,
      },
      upgrade: tier !== 'enterprise' ? {
        message: `Upgrade to increase your rate limit to ${tier === 'free' ? '2,000' : tier === 'starter' ? '5,000' : '20,000'} requests per hour.`,
        url: '/pricing',
      } : undefined,
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
  max: 20, // 20 attempts per 15 minutes (increased for dev comfort)

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

  // Skip rate limiting in development if SKIP_RATE_LIMIT is enabled
  skip: (req: Request) => {
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
      return true;
    }
    return false;
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