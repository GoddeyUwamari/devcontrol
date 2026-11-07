/**
 * The lowest plan that includes each plan-gated feature, read by every server
 * path that enforces one (routes, and the services that apply a feature's
 * saved settings). Plan entitlement only: resource limits stay in TIER_LIMITS
 * and roles stay with the RBAC middleware, so a plan check never replaces a
 * role or organization check.
 *
 * lib/plan/entitlements.ts mirrors this table for the UI; a parity test keeps
 * the two equal. Tiers are the stored subscription_tier values.
 */
import type { SubscriptionTier } from '../middleware/subscription.middleware';

export const PLAN_ENTITLEMENTS = {
  /** GET /api/metrics/dora, and the DORA-derived fields of GET /api/deployments/stats. */
  doraMetrics: 'pro',
  /** /api/dora/benchmarks, and applying saved benchmarks to DORA results. */
  doraCustomBenchmarks: 'enterprise',
  /** GET /api/security-hub/capability. */
  securityHubStatus: 'pro',
  /** POST /api/security-hub/sync. */
  securityHubSync: 'pro',
  /** GET /api/security-hub/frameworks/cis. */
  securityHubCis: 'pro',
  /** GET /api/security-hub/frameworks/pci. */
  securityHubPci: 'pro',
  /** GET /api/security-hub/frameworks/nist. */
  securityHubNist: 'pro',
  /** GET /api/risk-score/trend and /current: the security posture score and its daily history. */
  riskScore: 'pro',
  /** /api/compliance-frameworks: custom compliance frameworks and their scans. */
  complianceFrameworks: 'enterprise',
  /** POST /api/aws-resources/export (resource inventory export). */
  resourceInventoryExport: 'starter',
} as const satisfies Record<string, SubscriptionTier>;

export type PlanEntitlement = keyof typeof PLAN_ENTITLEMENTS;
