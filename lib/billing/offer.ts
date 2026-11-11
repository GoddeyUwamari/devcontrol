/**
 * The public billing offer (backend GET /api/billing/offer): whether the free
 * trial is on right now. One request per minute at most, shared by every
 * trial line and button on the page; an answer older than a minute is asked
 * again (the server caches it for 60 s too), so a switch flip reaches an open
 * tab within about a minute.
 *
 * Fails closed: anything but a well-formed "on" answer naming at least one
 * plan that has a trial (an error, a non-200, a timeout, any other shape)
 * means the trial is off, so no page ever offers a trial the server would
 * not give.
 */
import limits from '@/lib/plan/plan-limits.json'

export interface BillingOffer {
  trialOn: boolean
  days: number
  plans: readonly string[]
}

export const TRIAL_OFF: BillingOffer = Object.freeze({ trialOn: false, days: 0, plans: Object.freeze([]) as readonly string[] })

const TIMEOUT_MS = 3000
/** How long one answer is reused (matches the endpoint's Cache-Control max-age). */
export const OFFER_TTL_MS = 60_000
/** The plans that can have a trial (plan-limits.json, parity-tested against SELF_SERVE_TIERS). */
const TRIAL_PLANS: readonly string[] = limits.trial.plans

export function offerUrl(): string {
  return `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/billing/offer`
}

/** Strict reading of the server's answer; everything unexpected is "off". */
export function parseBillingOffer(body: unknown): BillingOffer {
  if (!body || typeof body !== 'object') return TRIAL_OFF
  const trial = (body as { trial?: unknown }).trial
  if (!trial || typeof trial !== 'object') return TRIAL_OFF
  const t = trial as { enabled?: unknown; days?: unknown; plans?: unknown }
  if (t.enabled !== true) return TRIAL_OFF
  if (typeof t.days !== 'number' || !Number.isInteger(t.days) || t.days <= 0) return TRIAL_OFF
  if (!Array.isArray(t.plans) || !t.plans.every((p) => typeof p === 'string')) return TRIAL_OFF
  // Only plans that can have a trial count; none known means off (no "trial on  (card required)").
  const plans = (t.plans as string[]).filter((p) => TRIAL_PLANS.includes(p))
  if (plans.length === 0) return TRIAL_OFF
  return { trialOn: true, days: t.days, plans: Object.freeze(plans) }
}

let cached: { at: number; promise: Promise<BillingOffer> } | null = null

async function load(): Promise<BillingOffer> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  try {
    const res = await fetch(offerUrl(), { signal: controller?.signal, credentials: 'omit' })
    if (!res.ok) return TRIAL_OFF
    return parseBillingOffer(await res.json())
  } catch {
    return TRIAL_OFF
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The current offer: one request, however many callers, re-asked once the answer is a minute old. */
export function fetchBillingOffer(): Promise<BillingOffer> {
  const now = Date.now()
  if (!cached || now - cached.at >= OFFER_TTL_MS) cached = { at: now, promise: load() }
  return cached.promise
}

/** Tests only: forget the cached answer. */
export function resetBillingOfferForTests(): void {
  cached = null
}
