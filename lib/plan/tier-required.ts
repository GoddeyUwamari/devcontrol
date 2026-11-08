/**
 * The server's answer when the organization's plan is below a route's
 * (backend requireTier, subscription.middleware.ts): HTTP 402 with
 *
 *   { code: 'TIER_REQUIRED',
 *     details: { currentTier, requiredTier, message, reason? },
 *     upgrade: { url, nextTier } }
 *
 * details.reason (BILLING_RESTRICTED | SUBSCRIPTION_INACTIVE) is present only
 * when the organization's own plan includes the feature and a billing hold
 * is why it is refused, so updating billing would unlock it. The notice then
 * says so (planNoticeOf) instead of naming a plan.
 *
 * Only that exact shape is recognised. Any other 402 (e.g. a resource
 * limit) or failure is not, and keeps its caller's normal error handling.
 * The client decides nothing from it: it only names the plan the server
 * asked for. upgrade.url (the billing page for the required plan) is not
 * used; the link is SEE_PLANS.
 */
import { SEE_PLANS } from '@/lib/compliance/evaluation'
import { PLAN_DISPLAY_NAME, type PaidTier } from './plan-names'

export type { PaidTier }

/** Why a feature the organization's plan includes is refused (backend tierRequiredReasonOf). */
export type TierRequiredReason = 'BILLING_RESTRICTED' | 'SUBSCRIPTION_INACTIVE'

export interface TierRequired {
  requiredTier: PaidTier
  /** Set only when updating billing would unlock the feature. */
  reason?: TierRequiredReason
}

/** The upgrade page, labelled as on the Compliance page. */
export { SEE_PLANS }

/** What a gated page says when the server answered TIER_REQUIRED. */
export function planRequiredText({ requiredTier }: TierRequired): string {
  return `This feature is on the ${PLAN_DISPLAY_NAME[requiredTier]} plan.`
}

/** Where an owner or admin goes to resolve a billing hold. */
export const GO_TO_BILLING = { href: '/settings/billing', label: 'Go to billing' } as const

/** Whether a role can resolve a billing hold itself (owner or admin), as on the billing page. */
export function canManageBillingRole(role: string | null): boolean {
  return role === 'owner' || role === 'admin'
}

/** What everyone else is told instead of the link. */
export const ASK_BILLING_ADMIN = 'Ask an organization owner or admin to update billing.'

/** The approved sentence for a billing hold on the organization's own {Plan}. */
export function billingHoldText(reason: TierRequiredReason, planTier: PaidTier): string {
  const plan = PLAN_DISPLAY_NAME[planTier]
  return reason === 'BILLING_RESTRICTED'
    ? `This feature is paused because of a payment issue. Your ${plan} plan is unchanged — update your payment details to restore access.`
    : `This feature is paused because your ${plan} subscription isn't active. Go to billing to complete or resume it.`
}

/**
 * What a gated place shows: the sentence, then the link (or, when there is
 * none, the note in its place).
 */
export interface PlanNotice {
  text: string
  link: { href: string; label: string } | null
  note: string | null
}

/**
 * The notice for a refusal. With a billing reason and the organization's
 * paid plan known: the billing sentence, and "Go to billing" for an owner or
 * admin or the ask-an-admin sentence for everyone else. Otherwise the plan
 * sentence and See plans, as before.
 */
export function planNoticeOf(
  tierRequired: TierRequired,
  { planTier, canManageBilling }: { planTier: unknown; canManageBilling: boolean }
): PlanNotice {
  if (tierRequired.reason && isPaidTier(planTier)) {
    return {
      text: billingHoldText(tierRequired.reason, planTier),
      link: canManageBilling ? GO_TO_BILLING : null,
      note: canManageBilling ? null : ASK_BILLING_ADMIN,
    }
  }
  return { text: planRequiredText(tierRequired), link: SEE_PLANS, note: null }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isPaidTier(value: unknown): value is PaidTier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAN_DISPLAY_NAME, value)
}

const isReason = (value: unknown): value is TierRequiredReason =>
  value === 'BILLING_RESTRICTED' || value === 'SUBSCRIPTION_INACTIVE'

/**
 * The TIER_REQUIRED 402 carried by an axios error (`response.status`,
 * `response.data`) or by a fetch wrapper's error (`status`, `body`); null
 * for anything else.
 */
export function tierRequiredOf(error: unknown): TierRequired | null {
  if (!isRecord(error)) return null
  const response = isRecord(error.response) ? error.response : null
  const status = response ? response.status : error.status
  const body = response ? response.data : error.body
  if (status !== 402 || !isRecord(body) || body.code !== 'TIER_REQUIRED') return null
  if (!isRecord(body.details) || !isPaidTier(body.details.requiredTier)) return null
  if (!isRecord(body.upgrade) || typeof body.upgrade.url !== 'string') return null
  const reason = body.details.reason
  return isReason(reason)
    ? { requiredTier: body.details.requiredTier, reason }
    : { requiredTier: body.details.requiredTier }
}

/**
 * A fetch failure as an Error with the response's status and parsed body
 * (null if it isn't JSON), so tierRequiredOf can read it.
 */
export async function responseError(response: Response, message: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  return Object.assign(new Error(message), { status: response.status, body })
}
