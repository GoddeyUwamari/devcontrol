/**
 * The UI's copy of the server's plan table (backend/src/config/plan-entitlements.ts):
 * the lowest plan that includes each plan-gated feature. The server decides;
 * pages read this only to avoid asking for what the plan will refuse, and to
 * show the upgrade state instead. A parity test keeps it equal to the server's.
 */
import type { PaidTier } from './plan-names'

export const PLAN_ENTITLEMENTS = {
  doraMetrics: 'pro',
  doraCustomBenchmarks: 'enterprise',
  securityHubStatus: 'pro',
  securityHubSync: 'pro',
  securityHubCis: 'pro',
  securityHubPci: 'pro',
  securityHubNist: 'pro',
  riskScore: 'pro',
  complianceFrameworks: 'enterprise',
  resourceInventoryExport: 'starter',
} as const satisfies Record<string, PaidTier>

export type PlanEntitlement = keyof typeof PLAN_ENTITLEMENTS
