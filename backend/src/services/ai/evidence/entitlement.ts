/**
 * The one server-side answer to "does this organization's plan include this
 * evidence source?" (A-D13/A-D14). It reads only config/plan-entitlements.ts,
 * through organizationHasEntitlement() -- the same plan resolution every
 * plan-gated route uses (a restricted or lapsed organization is free). There
 * is no second plan table and no pricing copy here.
 */
import { organizationHasEntitlement } from '../../../middleware/subscription.middleware';
import type { PlanEntitlement } from '../../../config/plan-entitlements';

export type EntitlementCheck = (organizationId: string, key: PlanEntitlement) => Promise<boolean>;

export const entitlementFor: EntitlementCheck = (organizationId, key) => organizationHasEntitlement(organizationId, key);

/**
 * The reason an unentitled source gives. It names no plan: the plan's
 * customer-facing name lives with the pricing page, and internal tier ids
 * never reach customers.
 */
export const NOT_ENTITLED_REASON = "not included in this organization's current plan, so DevControl did not read it";
