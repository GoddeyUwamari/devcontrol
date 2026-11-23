/**
 * GET /api/aws/accounts as the backend sends it (backend/src/routes/aws.routes.ts), for the not-connected
 * page tests (PR4c). The real awsAccountsService parses these, so a test exercises the same parser the app
 * does. Not a test file itself. All values are documented placeholders.
 */
export const ACCOUNTS_NOT_CONNECTED = {
  success: true, data: [], connection: { state: 'not_connected' },
  home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true,
}

export const ACCOUNTS_CONNECTED = {
  success: true,
  data: [{ id: 1, org_id: 'org-test', account_id: '111122223333', role_arn: 'arn:aws:iam::111122223333:role/DevControl', nickname: null, external_id: 'ext', region: 'us-east-1', connected_at: '2026-11-20T09:00:00.000Z', status: 'active' }],
  connection: { state: 'connected', health: { state: 'ok', since: '2026-11-23T08:00:00.000Z' } },
  home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true,
}

export type ConnectionMode = 'not_connected' | 'connected' | 'PENDING' | 'FAIL'

/** The accounts answer for `mode`, as an axios response (or never / a 500, for loading and a failed check). */
export function accountsResponse(mode: ConnectionMode): Promise<{ data: unknown }> {
  if (mode === 'PENDING') return new Promise(() => {})
  if (mode === 'FAIL') return Promise.reject(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { success: false, message: 'Failed to retrieve AWS accounts.' } } }))
  return Promise.resolve({ data: mode === 'connected' ? ACCOUNTS_CONNECTED : ACCOUNTS_NOT_CONNECTED })
}

const PLAN_NAME: Record<string, string> = { starter: 'Cost Control', pro: 'Optimization Engine', enterprise: 'Revenue Protection' }

/** subscription.middleware.ts requireTier / requireEntitlement: 402 TIER_REQUIRED, as an axios error. */
export function tierRequiredError(requiredTier: string, currentTier: string) {
  return Object.assign(new Error('Request failed with status code 402'), {
    response: {
      status: 402,
      data: {
        success: false, error: 'Subscription tier insufficient', code: 'TIER_REQUIRED',
        details: { currentTier, requiredTier, message: `This feature is on the ${PLAN_NAME[requiredTier]} plan.` },
        upgrade: { cta: 'Upgrade', url: `/settings/billing?upgrade=${requiredTier}`, nextTier: 'starter' },
      },
    },
  })
}
