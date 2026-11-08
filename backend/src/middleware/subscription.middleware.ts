/**
 * Subscription Tier Enforcement Middleware
 * Restricts access based on organization's subscription tier
 */

import { Request, Response, NextFunction } from 'express';
import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { PLAN_ENTITLEMENTS, type PlanEntitlement } from '../config/plan-entitlements';
import { isTerminalSubscriptionStatus } from '../config/subscription-status';

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

// Tier hierarchy - higher index = higher tier
const TIER_HIERARCHY: SubscriptionTier[] = ['free', 'starter', 'pro', 'enterprise'];

// Feature limits by tier
export const TIER_LIMITS: Record<SubscriptionTier, {
  maxServices: number;
  maxUsers: number;
  maxDeploymentsPerMonth: number;
  maxResources: number;
  features: string[];
}> = {
  free: {
    maxServices: 5,
    maxUsers: 1,
    maxDeploymentsPerMonth: 10,
    maxResources: 20,
    features: ['basic_dashboard', 'manual_deployments'],
  },
  starter: {
    maxServices: 20,
    maxUsers: 5,
    maxDeploymentsPerMonth: 50,
    maxResources: 60,
    features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts'],
  },
  pro: {
    maxServices: 100,
    maxUsers: 10,
    maxDeploymentsPerMonth: 500,
    maxResources: 500,
    features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts', 'advanced_analytics', 'api_access', 'custom_integrations'],
  },
  enterprise: {
    maxServices: -1, // unlimited
    maxUsers: -1, // unlimited
    maxDeploymentsPerMonth: -1, // unlimited
    maxResources: -1, // unlimited
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
 * Whether an organization's paid entitlements should currently be treated
 * as restricted due to a payment-failure grace period -- either explicitly
 * marked 'restricted' (by the grace-period reconciliation job, see
 * jobs/grace-period-enforcement.job.ts), or still nominally 'grace_period'
 * but past its persisted deadline. The latter is what makes this a lazy,
 * per-request check rather than something that depends on the
 * reconciliation job having already run: once grace_period_ends_at has
 * passed, this returns true on the very next request regardless of
 * whether the hourly job has caught up yet.
 *
 * Never trusts anything but the DB row -- there is no client input here at
 * all, by construction, so this cannot be spoofed by a request body/query.
 */
export function isOrgRestricted(row: {
  billing_lifecycle_state: string | null;
  grace_period_ends_at: Date | string | null;
}): boolean {
  if (row.billing_lifecycle_state === 'restricted') return true;
  if (row.billing_lifecycle_state === 'grace_period' && row.grace_period_ends_at) {
    return new Date(row.grace_period_ends_at).getTime() < Date.now();
  }
  return false;
}

/**
 * Why an organization's effective tier is below its stored tier, when a
 * billing hold is the reason:
 *  - 'payment': a payment failure whose grace period has ended (restricted),
 *    or an 'unpaid' subscription with no grace period running;
 *  - 'subscription_inactive': the recorded subscription is 'incomplete' (its
 *    first payment never completed) or 'paused'.
 * Updating billing would restore the stored tier in both cases.
 */
export type EntitlementHold = 'payment' | 'subscription_inactive';

/** The organization columns the effective-tier decision reads. */
export interface EntitlementRow {
  /** Only for the unrecognised-status warning. */
  id?: string | null;
  subscription_tier: string | null;
  billing_lifecycle_state: string | null;
  grace_period_ends_at: Date | string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
}

export interface Entitlement {
  /** The plan the organization is on, as stored; never rewritten by a hold. */
  storedTier: SubscriptionTier;
  /** The plan the gates enforce. */
  effectiveTier: SubscriptionTier;
  /** The billing hold that lowers it, or null (no hold, or nothing above free to withhold). */
  hold: EntitlementHold | null;
}

/**
 * The one effective-tier decision: what an organization row is entitled to
 * now, from its stored tier, its payment-failure grace (billing lifecycle)
 * and its recorded Stripe subscription's status. Read time only: the stored
 * tier, the grace and the subscription columns are never written here, so
 * recovery needs no repair. In order:
 *
 *  1. A recorded subscription that is terminal (canceled,
 *     incomplete_expired): free, with no hold. Paying would not restore it;
 *     only a new subscription would. This also holds when a late or retried
 *     event wrote a paid stored tier next to the terminal status.
 *  2. Restricted, or a grace period whose deadline has passed
 *     (isOrgRestricted): free, 'payment' hold. The existing grace, unchanged,
 *     whatever the status.
 *  3. No recorded subscription (stripe_subscription_id NULL): the stored
 *     tier. The status column is ignored, so a hand-provisioned organization
 *     ('free', NULL or any other status) keeps its plan.
 *  4. The recorded subscription's status:
 *     - active, trialing, past_due: the stored tier (past_due keeps it while
 *       the grace in 2 runs, as before);
 *     - unpaid: the stored tier while a grace period is still running (its
 *       deadline is never moved), otherwise free with a 'payment' hold;
 *     - incomplete, paused: free, 'subscription_inactive' hold;
 *     - anything else ('free', NULL, an unrecognised string): the stored
 *       tier, never cutting off a possibly paying customer, and a warning
 *       naming the organization id and the status string only.
 *
 * A hold is reported only when it lowers a paid stored tier: an
 * organization stored on free has nothing withheld. An unrecognised stored
 * tier is passed through unchanged when nothing lowers it.
 */
export function entitlementOf(row: EntitlementRow): Entitlement {
  const storedTier = ((row.subscription_tier as SubscriptionTier) || 'free');
  const held = (hold: EntitlementHold): Entitlement => ({
    storedTier,
    effectiveTier: 'free',
    hold: storedTier === 'free' ? null : hold,
  });
  const stored: Entitlement = { storedTier, effectiveTier: storedTier, hold: null };
  const hasRecordedSubscription = row.stripe_subscription_id !== null && row.stripe_subscription_id !== undefined;
  const status = row.subscription_status;

  if (hasRecordedSubscription && isTerminalSubscriptionStatus(status)) {
    return { storedTier, effectiveTier: 'free', hold: null };
  }
  if (isOrgRestricted(row)) return held('payment');
  if (!hasRecordedSubscription) return stored;

  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return stored;
    case 'unpaid':
      // Not restricted (2), so a grace period in 'grace_period' is still running.
      return row.billing_lifecycle_state === 'grace_period' ? stored : held('payment');
    case 'incomplete':
    case 'paused':
      return held('subscription_inactive');
    default:
      console.warn(
        `[Billing] Organization ${row.id ?? '(id not loaded)'} has a recorded subscription with an unrecognised status ${JSON.stringify(status)}; its stored tier is kept.`
      );
      return stored;
  }
}

/**
 * The tier the plan gates enforce for an organization row (entitlementOf).
 * getOrganizationTier resolves every request with it, and the organization
 * responses the UI loads (/api/auth/me, /api/organizations, login,
 * registration) report it as `effectiveTier`, next to `entitlementHold`, so
 * the UI shows what the server will decide.
 */
export function effectiveTierOf(row: EntitlementRow): SubscriptionTier {
  return entitlementOf(row).effectiveTier;
}

/**
 * `effectiveTier` and `entitlementHold` for an organization response: the
 * tier the plan gates enforce and the billing hold that lowers it, both from
 * the one decision (entitlementOf), so the UI shows what the server decides.
 */
export function entitlementFields(row: EntitlementRow): {
  effectiveTier: SubscriptionTier;
  entitlementHold: EntitlementHold | null;
} {
  const { effectiveTier, hold } = entitlementOf(row);
  return { effectiveTier, entitlementHold: hold };
}

/** The columns entitlementOf reads, for the organization lookups below. */
const ENTITLEMENT_COLUMNS =
  'subscription_tier, billing_lifecycle_state, grace_period_ends_at, stripe_subscription_id, subscription_status, id';

/**
 * An organization's entitlement (entitlementOf), or null if it does not
 * exist or is deleted. Never writes anything: the stored tier stays intact
 * for recovery. Contrast with StripeController.getSubscription, which
 * reports the stored paid tier to the client -- a hold affects access, not
 * what plan the customer is shown as being on.
 */
export async function getOrganizationEntitlement(
  organizationId: string,
  executor: Pool | PoolClient = pool
): Promise<Entitlement | null> {
  const result = await executor.query(
    `SELECT ${ENTITLEMENT_COLUMNS}
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId]
  );
  return result.rows.length === 0 ? null : entitlementOf(result.rows[0]);
}

/**
 * The organization's effective tier (entitlementOf), or 'free' if it does
 * not exist. Every server path that decides by plan uses this (or
 * getOrganizationEntitlement), never the stored subscription_tier.
 */
export async function getOrganizationTier(
  organizationId: string,
  executor: Pool | PoolClient = pool
): Promise<SubscriptionTier> {
  const entitlement = await getOrganizationEntitlement(organizationId, executor);
  return entitlement ? entitlement.effectiveTier : 'free';
}

/**
 * The `details.reason` of a 402 TIER_REQUIRED: set only when the stored
 * tier would meet the requirement, the effective tier does not, and a
 * billing hold is why -- so the message says billing only when updating
 * billing would actually unlock the feature. Otherwise undefined (the plan
 * itself is too low, or a terminal subscription).
 */
export type TierRequiredReason = 'BILLING_RESTRICTED' | 'SUBSCRIPTION_INACTIVE';

export function tierRequiredReasonOf(
  entitlement: Entitlement,
  requiredTier: SubscriptionTier
): TierRequiredReason | undefined {
  if (entitlement.hold === null) return undefined;
  if (!tierMeetsRequirement(entitlement.storedTier, requiredTier)) return undefined;
  if (tierMeetsRequirement(entitlement.effectiveTier, requiredTier)) return undefined;
  return entitlement.hold === 'payment' ? 'BILLING_RESTRICTED' : 'SUBSCRIPTION_INACTIVE';
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
      const entitlement = await getOrganizationEntitlement(req.organizationId);
      const currentTier: SubscriptionTier = entitlement ? entitlement.effectiveTier : 'free';

      if (!tierMeetsRequirement(currentTier, minimumTier)) {
        // Looked up for every refusal: an unrecognised stored tier has no
        // entry, so this throws and the request fails closed with the 500 below.
        const cta = UPGRADE_CTA[currentTier];
        const reason = entitlement ? tierRequiredReasonOf(entitlement, minimumTier) : undefined;

        res.status(402).json({
          success: false,
          error: 'Subscription tier insufficient',
          code: 'TIER_REQUIRED',
          details: {
            currentTier,
            requiredTier: minimumTier,
            message: `This feature requires a ${minimumTier} subscription or higher.`,
            ...(reason ? { reason } : {}),
          },
          upgrade: {
            cta: cta.message,
            // The plan this route requires, not the one after the current plan.
            url: `/settings/billing?upgrade=${minimumTier}`,
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
 * requireTier for one feature, at the plan PLAN_ENTITLEMENTS gives it: the
 * same refusal (402 TIER_REQUIRED) and the same fail-closed 500.
 */
export const requireEntitlement = (entitlement: PlanEntitlement) =>
  requireTier(PLAN_ENTITLEMENTS[entitlement]);

/**
 * Whether the organization's plan, resolved as for every request
 * (getOrganizationTier: a restricted or lapsed organization is free),
 * includes the feature. For server paths that adjust a result rather than
 * refuse a request. Throws if the plan cannot be read; callers decide what
 * that means for their result.
 */
export async function organizationHasEntitlement(
  organizationId: string,
  entitlement: PlanEntitlement,
  executor: Pool | PoolClient = pool
): Promise<boolean> {
  const tier = await getOrganizationTier(organizationId, executor);
  return tierMeetsRequirement(tier, PLAN_ENTITLEMENTS[entitlement]);
}

/**
 * Resource limit types that can be checked
 */
export type ResourceLimitType = 'services' | 'users' | 'deployments' | 'aws_resources';

function resolveMaxUsers(
  org: { max_users: number | null },
  tier: SubscriptionTier,
  lowered: boolean
): number {
  return lowered ? TIER_LIMITS.free.maxUsers : (org.max_users || TIER_LIMITS[tier].maxUsers);
}

/**
 * The tier the resource limits use: the effective tier (entitlementOf), and
 * whether it is below the stored one. While it is, the organization's own
 * max_services/max_users/max_deployments_per_month override columns -- which
 * still hold the stored paid tier's numbers, never rewritten by a hold or a
 * cancellation, so recovery needs no repair -- are ignored for the free
 * tier's limits.
 */
function limitsTierOf(org: EntitlementRow): { tier: SubscriptionTier; lowered: boolean } {
  const { storedTier, effectiveTier } = entitlementOf(org);
  return { tier: effectiveTier, lowered: effectiveTier !== storedTier };
}

/**
 * Seat check for a specific organization, resolved exactly as
 * checkResourceLimit('users') resolves it, but against an explicit
 * organization and executor instead of the caller's own org -- invitation
 * acceptance joins a DIFFERENT org than the accepting user's token names,
 * and runs inside its own transaction. Throws if one more active member
 * would exceed the limit. `excludeUserId`'s own membership row is not
 * counted, so accepting an invitation never counts the invitee twice.
 */
export async function assertOrganizationHasSeat(
  executor: Pool | PoolClient,
  organizationId: string,
  excludeUserId: string
): Promise<void> {
  const orgResult = await executor.query(
    `SELECT subscription_tier, max_users, billing_lifecycle_state, grace_period_ends_at,
            stripe_subscription_id, subscription_status, id
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId]
  );
  if (orgResult.rows.length === 0) {
    throw new Error('Organization not found');
  }
  const org = orgResult.rows[0];
  const { tier, lowered } = limitsTierOf(org);
  const maxUsers = resolveMaxUsers(org, tier, lowered);
  if (maxUsers === -1) return;

  const usersResult = await executor.query(
    `SELECT COUNT(*) FROM organization_memberships
     WHERE organization_id = $1 AND is_active = true AND user_id <> $2`,
    [organizationId, excludeUserId]
  );
  const currentUsage = parseInt(usersResult.rows[0].count);
  if (currentUsage + 1 > maxUsers) {
    throw new SeatLimitReachedError(currentUsage, maxUsers);
  }
}

export class SeatLimitReachedError extends Error {
  readonly statusCode = 402;
  readonly code = 'RESOURCE_LIMIT_REACHED';
  constructor(public readonly currentUsage: number, public readonly maxLimit: number) {
    super(`This organization has reached its users limit (${currentUsage}/${maxLimit}).`);
    this.name = 'SeatLimitReachedError';
  }
}

/**
 * Get organization's resource limits and current usage
 */
async function getOrganizationLimits(organizationId: string): Promise<{
  tier: SubscriptionTier;
  limits: {
    maxServices: number;
    maxUsers: number;
    maxDeploymentsPerMonth: number;
    maxResources: number;
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
    `SELECT subscription_tier, max_services, max_users, max_deployments_per_month,
            billing_lifecycle_state, grace_period_ends_at, stripe_subscription_id, subscription_status, id
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId]
  );

  if (orgResult.rows.length === 0) {
    throw new Error('Organization not found');
  }

  const org = orgResult.rows[0];
  // While the effective tier is below the stored one, the free tier's limits
  // (limitsTierOf).
  const { tier, lowered: restricted } = limitsTierOf(org);

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
      // Tier resource quota — a soft-terminated resource no longer exists in AWS
      // and must not count against the org's maxResources limit.
      `SELECT COUNT(*) FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
      [organizationId]
    ),
  ]);

  return {
    tier,
    limits: {
      maxServices: restricted ? TIER_LIMITS.free.maxServices : (org.max_services || TIER_LIMITS[tier].maxServices),
      maxUsers: resolveMaxUsers(org, tier, restricted),
      maxDeploymentsPerMonth: restricted ? TIER_LIMITS.free.maxDeploymentsPerMonth : (org.max_deployments_per_month || TIER_LIMITS[tier].maxDeploymentsPerMonth),
      maxResources: TIER_LIMITS[tier].maxResources,
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
          currentUsage = usage.services;
          maxLimit = limits.maxServices;
          resourceName = 'services';
          break;
        case 'aws_resources':
          currentUsage = usage.awsResources;
          maxLimit = limits.maxResources;
          resourceName = 'AWS resources';
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
              resourceType === 'aws_resources' ? 'maxResources' :
              resourceType === 'services' ? 'maxServices' :
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
