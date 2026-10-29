/**
 * The server's answer when the organization's plan is below a route's
 * (backend requireTier, subscription.middleware.ts): HTTP 402 with
 *
 *   { code: 'TIER_REQUIRED',
 *     details: { currentTier, requiredTier, message },
 *     upgrade: { url, nextTier } }
 *
 * Only that exact shape is recognised. Any other 402 (e.g. a resource
 * limit) or failure is not, and keeps its caller's normal error handling.
 * The client decides nothing from it: it only names the plan the server
 * asked for. upgrade.url is not used (it points at the tier after the
 * current one, not the required one); the link is SEE_PLANS.
 */
import { SEE_PLANS } from '@/lib/compliance/evaluation'
import { PLAN_DISPLAY_NAME, type PaidTier } from './plan-names'

export type { PaidTier }

export interface TierRequired {
  requiredTier: PaidTier
}

/** The upgrade page, labelled as on the Compliance page. */
export { SEE_PLANS }

/** What a gated page says when the server answered TIER_REQUIRED. */
export function planRequiredText({ requiredTier }: TierRequired): string {
  return `This feature is on the ${PLAN_DISPLAY_NAME[requiredTier]} plan.`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPaidTier = (value: unknown): value is PaidTier =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAN_DISPLAY_NAME, value)

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
  return { requiredTier: body.details.requiredTier }
}

/**
 * A fetch failure as an Error with the response's status and parsed body
 * (null if it isn't JSON), so tierRequiredOf can read it.
 */
export async function responseError(response: Response, message: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  return Object.assign(new Error(message), { status: response.status, body })
}
