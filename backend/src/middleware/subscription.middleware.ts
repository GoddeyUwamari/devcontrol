/**
 * Subscription Tier Enforcement Middleware
 * Restricts access based on organization's subscription tier
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

// Tier hierarchy - higher index = higher tier
const TIER_HIERARCHY: SubscriptionTier[] = ['free', 'starter', 'pro', 'enterprise'];

// Feature limits by tier
export const TIER_LIMITS: Record<SubscriptionTier, {
  maxServices: number;
  maxUsers: number;
  maxDeploymentsPerMonth: number;
  features: string[];
}> = {
  free: {
    maxServices: 5,
    maxUsers: 3,
    maxDeploymentsPerMonth: 10,
    features: ['basic_dashboard', 'manual_deployments'],
  },
  starter: {
    maxServices: 20,
    maxUsers: 10,
    maxDeploymentsPerMonth: 50,
    features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts'],
  },
  pro: {
    maxServices: 100,
    maxUsers: 50,
    maxDeploymentsPerMonth: 500,
    features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts', 'advanced_analytics', 'api_access', 'custom_integrations'],
  },
  enterprise: {
    maxServices: -1, // unlimited
    maxUsers: -1, // unlimited
    maxDeploymentsPerMonth: -1, // unlimited
    features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts', 'advanced_analytics', 'api_access', 'custom_integrations', 'sso', 'audit_logs', 'dedicated_support', 'sla'],
  },
};

// Upgrade CTAs by tier
const UPGRADE_CTA: Record<SubscriptionTier, { message: string; upgradeUrl: string; nextTier: SubscriptionTier | null }> = {
  free: {
    message: 'Upgrade to Starter to unlock this feature and get more services, users, and deployments.',
    upgradeUrl: '/settings/billing?upgrade=starter',
    nextTier: 'starter',
  },
  starter: {
    message: 'Upgrade to Pro to unlock advanced analytics, API access, and custom integrations.',
    upgradeUrl: '/settings/billing?upgrade=pro',
    nextTier: 'pro',
  },
  pro: {
    message: 'Upgrade to Enterprise for unlimited resources, SSO, dedicated support, and SLA guarantees.',
    upgradeUrl: '/settings/billing?upgrade=enterprise',
    nextTier: 'enterprise',
  },
  enterprise: {
    message: 'You have access to all features.',
    upgradeUrl: '/settings/billing',
    nextTier: null,
  },
};

/**
 * Check if a tier meets the minimum required tier
 */
export function tierMeetsRequirement(currentTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  const currentIndex = TIER_HIERARCHY.indexOf(currentTier);
  const requiredIndex = TIER_HIERARCHY.indexOf(requiredTier);
  return currentIndex >= requiredIndex;
}

/**
 * Get organization's subscription tier from the database
 */
async function getOrganizationTier(organizationId: string): Promise<SubscriptionTier> {
  const result = await pool.query(
    'SELECT subscription_tier FROM organizations WHERE id = $1 AND deleted_at IS NULL',
    [organizationId]
  );

  if (result.rows.length === 0) {
    return 'free'; // Default to free if org not found
  }

  return (result.rows[0].subscription_tier as SubscriptionTier) || 'free';
}

/**
 * Middleware to require a minimum subscription tier
 * @param minimumTier - The minimum tier required to access the endpoint
 */
export const requireTier = (minimumTier: SubscriptionTier) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check if user is authenticated
    if (!req.user || !req.organizationId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      const currentTier = await getOrganizationTier(req.organizationId);

      if (!tierMeetsRequirement(currentTier, minimumTier)) {
        const cta = UPGRADE_CTA[currentTier];

        res.status(402).json({
          success: false,
          error: 'Subscription tier insufficient',
          code: 'TIER_REQUIRED',
          details: {
            currentTier,
            requiredTier: minimumTier,
            message: `This feature requires a ${minimumTier} subscription or higher.`,
          },
          upgrade: {
            cta: cta.message,
            url: cta.upgradeUrl,
            nextTier: cta.nextTier,
          },
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Error checking subscription tier:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify subscription tier',
      });
    }
  };
};

/**
 * Middleware to check if organization has a specific feature
 * @param feature - The feature name to check
 */
export const requireFeature = (feature: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || !req.organizationId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      const currentTier = await getOrganizationTier(req.organizationId);
      const tierFeatures = TIER_LIMITS[currentTier].features;

      if (!tierFeatures.includes(feature)) {
        const cta = UPGRADE_CTA[currentTier];

        res.status(402).json({
          success: false,
          error: 'Feature not available',
          code: 'FEATURE_REQUIRED',
          details: {
            currentTier,
            requiredFeature: feature,
            message: `The "${feature}" feature is not available on the ${currentTier} plan.`,
          },
          upgrade: {
            cta: cta.message,
            url: cta.upgradeUrl,
            nextTier: cta.nextTier,
          },
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Error checking feature access:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify feature access',
      });
    }
  };
};

// Convenience middleware for common tier requirements
export const requireStarter = requireTier('starter');
export const requirePro = requireTier('pro');
export const requireEnterprise = requireTier('enterprise');

/**
 * Resource limit types that can be checked
 */
export type ResourceLimitType = 'services' | 'users' | 'deployments' | 'aws_resources';

/**
 * Get organization's resource limits and current usage
 */
async function getOrganizationLimits(organizationId: string): Promise<{
  tier: SubscriptionTier;
  limits: {
    maxServices: number;
    maxUsers: number;
    maxDeploymentsPerMonth: number;
  };
  usage: {
    services: number;
    users: number;
    deploymentsThisMonth: number;
    awsResources: number;
  };
}> {
  // Get organization limits
  const orgResult = await pool.query(
    `SELECT subscription_tier, max_services, max_users, max_deployments_per_month
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId]
  );

  if (orgResult.rows.length === 0) {
    throw new Error('Organization not found');
  }

  const org = orgResult.rows[0];
  const tier = (org.subscription_tier as SubscriptionTier) || 'free';

  // Get current usage counts in parallel
  const [servicesResult, usersResult, deploymentsResult, awsResourcesResult] = await Promise.all([
    pool.query(
      'SELECT COUNT(*) FROM services WHERE organization_id = $1',
      [organizationId]
    ),
    pool.query(
      'SELECT COUNT(*) FROM organization_memberships WHERE organization_id = $1 AND is_active = true',
      [organizationId]
    ),
    pool.query(
      `SELECT COUNT(*) FROM deployments
       WHERE organization_id = $1
       AND deployed_at >= date_trunc('month', CURRENT_DATE)`,
      [organizationId]
    ),
    pool.query(
      'SELECT COUNT(*) FROM aws_resources WHERE organization_id = $1',
      [organizationId]
    ),
  ]);

  return {
    tier,
    limits: {
      maxServices: org.max_services || TIER_LIMITS[tier].maxServices,
      maxUsers: org.max_users || TIER_LIMITS[tier].maxUsers,
      maxDeploymentsPerMonth: org.max_deployments_per_month || TIER_LIMITS[tier].maxDeploymentsPerMonth,
    },
    usage: {
      services: parseInt(servicesResult.rows[0].count),
      users: parseInt(usersResult.rows[0].count),
      deploymentsThisMonth: parseInt(deploymentsResult.rows[0].count),
      awsResources: parseInt(awsResourcesResult.rows[0].count),
    },
  };
}

/**
 * Middleware to check resource limits before allowing an operation
 * @param resourceType - The type of resource to check limits for
 * @param incrementBy - How many resources will be added (default: 1)
 */
export const checkResourceLimit = (resourceType: ResourceLimitType, incrementBy: number = 1) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || !req.organizationId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    try {
      const { tier, limits, usage } = await getOrganizationLimits(req.organizationId);
      const cta = UPGRADE_CTA[tier];

      let currentUsage: number;
      let maxLimit: number;
      let resourceName: string;

      switch (resourceType) {
        case 'services':
        case 'aws_resources':
          // Both services and aws_resources count against max_services limit
          currentUsage = Math.max(usage.services, usage.awsResources);
          maxLimit = limits.maxServices;
          resourceName = 'resources';
          break;
        case 'users':
          currentUsage = usage.users;
          maxLimit = limits.maxUsers;
          resourceName = 'users';
          break;
        case 'deployments':
          currentUsage = usage.deploymentsThisMonth;
          maxLimit = limits.maxDeploymentsPerMonth;
          resourceName = 'deployments this month';
          break;
        default:
          next();
          return;
      }

      // -1 means unlimited
      if (maxLimit !== -1 && currentUsage + incrementBy > maxLimit) {
        res.status(402).json({
          success: false,
          error: 'Resource limit reached',
          code: 'RESOURCE_LIMIT_REACHED',
          details: {
            resourceType,
            currentUsage,
            maxLimit,
            tier,
            message: `You have reached your ${resourceName} limit (${currentUsage}/${maxLimit}). Upgrade to add more ${resourceName}.`,
          },
          upgrade: {
            cta: `Upgrade to ${cta.nextTier || 'a higher plan'} to increase your ${resourceName} limit.`,
            url: cta.upgradeUrl,
            nextTier: cta.nextTier,
            currentLimit: maxLimit,
            nextLimit: cta.nextTier ? TIER_LIMITS[cta.nextTier][
              resourceType === 'services' || resourceType === 'aws_resources' ? 'maxServices' :
              resourceType === 'users' ? 'maxUsers' : 'maxDeploymentsPerMonth'
            ] : null,
          },
        });
        return;
      }

      // Attach limits info to request for downstream use
      (req as any).resourceLimits = { tier, limits, usage };

      next();
    } catch (error) {
      console.error('Error checking resource limits:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify resource limits',
      });
    }
  };
};

/**
 * Middleware specifically for AWS resource discovery
 * Blocks discovery if organization has reached their resource limit
 */
export const checkDiscoveryLimit = checkResourceLimit('aws_resources', 0);

/**
 * Get current resource usage for an organization (utility function)
 */
export async function getResourceUsage(organizationId: string) {
  return getOrganizationLimits(organizationId);
}
