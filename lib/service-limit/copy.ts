/**
 * The services limit's customer copy (service-limits stage-a §6.2, approved
 * by the founder as printed, Addendum 1 FQ9). The server's 402 message (C9)
 * is backend/src/middleware/subscription.middleware.ts serviceLimitMessage;
 * D8b's at-limit line (C8) is REPO_COPY in lib/github-connection/copy.ts.
 * Plan names come from the server (PLAN_NAME), never an internal tier id.
 */

/** "See plans" goes where D8b's does (lib/github-connection/copy.ts SEE_PLANS_HREF). */
export const SERVICE_LIMIT_SEE_PLANS_HREF = '/settings/billing/upgrade'
export const SERVICE_LIMIT_UPDATE_BILLING_HREF = '/settings/billing'
/** FQ7: the managed-plan contact. */
export const SERVICE_LIMIT_CONTACT_HREF = 'mailto:support@getdevcontrol.com'

const yourPlan = (plan: string | null) => (plan ? `Your ${plan} plan` : 'Your plan')

export const SERVICE_LIMIT_COPY = {
  /** C1 */
  title: 'Service limit reached',
  /** C2, C3 and C5 (C5 is the same sentence with used > max). */
  planBody: (plan: string | null, max: number, used: number) =>
    `${yourPlan(plan)} includes ${max} services, and this workspace has ${used}. Your existing services, deployments and GitHub mappings aren't affected.`,
  /** C2 link */
  seePlans: 'See plans',
  /** C3: "To change your plan's limits, contact us." with "contact us" a mailto link. */
  managedLead: "To change your plan's limits, ",
  contactUs: 'contact us',
  /** C4 */
  holdBody: (freePlan: string, freeMax: number, used: number) =>
    `Billing needs attention, so this workspace has the ${freePlan} limit of ${freeMax} services until it's resolved. It has ${used}. Your existing services aren't affected.`,
  /** C4 link */
  updateBilling: 'Update billing',
  /** C6 */
  submitReason: 'Service limit reached',
  /** C7 title; the description is the server's 402 `error` (C9). */
  notCreatedTitle: 'Service not created',
  /** C10 */
  billingLabel: 'Registered services',
  billingValue: (used: number, limit: number | null) => (limit === null ? `${used} · Unlimited` : `${used} / ${limit}`),
  /** C12 ("{n} registered" when unlimited). */
  registeredCount: (n: number, max: number | null) => (max === null ? `${n} registered` : `${n} of ${max} registered`),
} as const
