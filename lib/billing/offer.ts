/**
 * The public billing offer (backend GET /api/billing/offer): whether the free
 * trial is on right now. One request per page load, shared by every trial
 * line and button on the page.
 *
 * Fails closed: anything but a well-formed "on" answer (an error, a non-200,
 * a timeout, any other shape) means the trial is off, so no page ever offers
 * a trial the server would not give.
 */

export interface BillingOffer {
  trialOn: boolean
  days: number
  plans: readonly string[]
}

export const TRIAL_OFF: BillingOffer = Object.freeze({ trialOn: false, days: 0, plans: Object.freeze([]) as readonly string[] })

const TIMEOUT_MS = 3000

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
  return { trialOn: true, days: t.days, plans: Object.freeze([...(t.plans as string[])]) }
}

let pending: Promise<BillingOffer> | null = null

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

/** The offer for this page load (one request, however many callers). */
export function fetchBillingOffer(): Promise<BillingOffer> {
  if (!pending) pending = load()
  return pending
}

/** Tests only: forget the cached answer. */
export function resetBillingOfferForTests(): void {
  pending = null
}
