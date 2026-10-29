/** The body backend requireTier sends with its 402 (subscription.middleware.ts). Not a test file itself. */
export function tierRequiredBody(requiredTier: string, url = '/settings/billing?upgrade=enterprise') {
  return {
    success: false,
    error: 'Subscription tier insufficient',
    code: 'TIER_REQUIRED',
    details: { currentTier: 'pro', requiredTier, message: `This feature requires a ${requiredTier} subscription or higher.` },
    upgrade: { cta: 'Upgrade', url, nextTier: 'enterprise' },
  }
}

/** An axios-shaped error with this status and body. */
export const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } })

/** A 402 with a different code: must keep normal error handling. */
export const resourceLimitBody = () => ({ success: false, error: 'Limit reached', code: 'RESOURCE_LIMIT_REACHED', upgrade: { url: '/x', nextTier: 'pro' } })
