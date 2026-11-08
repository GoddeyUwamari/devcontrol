import { describe, it, expect } from 'vitest'
import { PLAN_DISPLAY_NAME } from '../plan-names'
import { SEE_PLANS, planNoticeOf, planRequiredText, responseError, tierRequiredOf } from '../tier-required'
import { axiosError, tierRequiredBody } from './tier-required-fixture'

describe('tierRequiredOf', () => {
  it('recognises the TIER_REQUIRED 402 from axios', () => {
    expect(tierRequiredOf(axiosError(402, tierRequiredBody('enterprise')))).toEqual({ requiredTier: 'enterprise' })
    expect(tierRequiredOf(axiosError(402, tierRequiredBody('pro')))).toEqual({ requiredTier: 'pro' })
    expect(tierRequiredOf(axiosError(402, tierRequiredBody('starter')))).toEqual({ requiredTier: 'starter' })
  })

  it('recognises it from a fetch wrapper error (status + body)', () => {
    const err = Object.assign(new Error('x'), { status: 402, body: tierRequiredBody('pro') })
    expect(tierRequiredOf(err)).toEqual({ requiredTier: 'pro' })
  })

  it('takes the plan from details.requiredTier, never from currentTier or nextTier', () => {
    const body = { ...tierRequiredBody('enterprise'), details: { currentTier: 'free', requiredTier: 'enterprise' }, upgrade: { url: '/x', nextTier: 'starter' } }
    expect(tierRequiredOf(axiosError(402, body))).toEqual({ requiredTier: 'enterprise' })
  })

  it.each([
    ['another 402 code', axiosError(402, { ...tierRequiredBody('pro'), code: 'RESOURCE_LIMIT_REACHED' })],
    ['a 402 without a code', axiosError(402, { ...tierRequiredBody('pro'), code: undefined })],
    ['a 402 without a body', axiosError(402, undefined)],
    ['a 402 with a text body', axiosError(402, 'Payment Required')],
    ['an unknown required tier', axiosError(402, tierRequiredBody('platinum'))],
    ['a free required tier', axiosError(402, tierRequiredBody('free'))],
    ['no details', axiosError(402, { ...tierRequiredBody('pro'), details: undefined })],
    ['no upgrade', axiosError(402, { ...tierRequiredBody('pro'), upgrade: undefined })],
    ['an upgrade without a url', axiosError(402, { ...tierRequiredBody('pro'), upgrade: { nextTier: 'pro' } })],
    ['a 403 with the same body', axiosError(403, tierRequiredBody('pro'))],
    ['a 500', axiosError(500, { success: false, error: 'Failed' })],
    ['a fetch error with the body but no status', Object.assign(new Error('x'), { body: tierRequiredBody('pro') })],
    ['a network error', new Error('Network Error')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'TIER_REQUIRED'],
  ])('ignores %s', (_label, error) => {
    expect(tierRequiredOf(error)).toBeNull()
  })
})

describe('copy', () => {
  it('names the plan and links to the upgrade page', () => {
    expect(planRequiredText({ requiredTier: 'enterprise' })).toBe('This feature is on the Revenue Protection plan.')
    expect(planRequiredText({ requiredTier: 'pro' })).toBe('This feature is on the Optimization Engine plan.')
    expect(planRequiredText({ requiredTier: 'starter' })).toBe('This feature is on the Cost Control plan.')
    expect(PLAN_DISPLAY_NAME).toEqual({ starter: 'Cost Control', pro: 'Optimization Engine', enterprise: 'Revenue Protection' })
    expect(SEE_PLANS).toEqual({ label: 'See plans', href: '/settings/billing/upgrade' })
  })
})

describe('responseError', () => {
  it('keeps the status and the JSON body', async () => {
    const res = new Response(JSON.stringify(tierRequiredBody('pro')), { status: 402 })
    const err = await responseError(res, 'Failed to fetch forecast')
    expect(err.message).toBe('Failed to fetch forecast')
    expect(tierRequiredOf(err)).toEqual({ requiredTier: 'pro' })
  })

  it('a body that is not JSON is null', async () => {
    const err = await responseError(new Response('<html>', { status: 502 }), 'Failed')
    expect(err).toMatchObject({ status: 502, body: null })
  })
})

// ─── Billing safety PR B (B4): the billing hold notice ──────────────────────

describe('B4: details.reason and the billing hold notice', () => {
  const PAYMENT_PRO =
    'This feature is paused because of a payment issue. Your Optimization Engine plan is unchanged — update your payment details to restore access.'
  const INACTIVE_PRO =
    "This feature is paused because your Optimization Engine subscription isn't active. Go to billing to complete or resume it."
  const ASK = 'Ask an organization owner or admin to update billing.'
  const withReason = (requiredTier: string, reason: unknown) => {
    const body = tierRequiredBody(requiredTier)
    return axiosError(402, { ...body, details: { ...body.details, reason } })
  }

  it('tierRequiredOf carries a known reason, and drops an unknown one', () => {
    expect(tierRequiredOf(withReason('pro', 'BILLING_RESTRICTED'))).toEqual({ requiredTier: 'pro', reason: 'BILLING_RESTRICTED' })
    expect(tierRequiredOf(withReason('pro', 'SUBSCRIPTION_INACTIVE'))).toEqual({ requiredTier: 'pro', reason: 'SUBSCRIPTION_INACTIVE' })
    expect(tierRequiredOf(withReason('pro', 'SOMETHING_ELSE'))).toEqual({ requiredTier: 'pro' })
    expect(tierRequiredOf(withReason('pro', undefined))).toEqual({ requiredTier: 'pro' })
  })

  it('payment hold, owner or admin: the approved sentence and Go to billing', () => {
    expect(planNoticeOf({ requiredTier: 'pro', reason: 'BILLING_RESTRICTED' }, { planTier: 'pro', canManageBilling: true })).toEqual({
      text: PAYMENT_PRO,
      link: { href: '/settings/billing', label: 'Go to billing' },
      note: null,
    })
  })

  it('payment hold, everyone else: the approved sentence and the ask-an-admin sentence, no link', () => {
    expect(planNoticeOf({ requiredTier: 'pro', reason: 'BILLING_RESTRICTED' }, { planTier: 'pro', canManageBilling: false })).toEqual({
      text: PAYMENT_PRO,
      link: null,
      note: ASK,
    })
  })

  it('inactive subscription, owner or admin: the approved sentence and Go to billing', () => {
    expect(planNoticeOf({ requiredTier: 'pro', reason: 'SUBSCRIPTION_INACTIVE' }, { planTier: 'pro', canManageBilling: true })).toEqual({
      text: INACTIVE_PRO,
      link: { href: '/settings/billing', label: 'Go to billing' },
      note: null,
    })
  })

  it('inactive subscription, everyone else: the approved sentence and the ask-an-admin sentence, no link', () => {
    expect(planNoticeOf({ requiredTier: 'pro', reason: 'SUBSCRIPTION_INACTIVE' }, { planTier: 'pro', canManageBilling: false })).toEqual({
      text: INACTIVE_PRO,
      link: null,
      note: ASK,
    })
  })

  it('{Plan} is the organization\'s own plan, not the required one', () => {
    expect(planNoticeOf({ requiredTier: 'starter', reason: 'BILLING_RESTRICTED' }, { planTier: 'enterprise', canManageBilling: true }).text).toBe(
      'This feature is paused because of a payment issue. Your Revenue Protection plan is unchanged — update your payment details to restore access.'
    )
    expect(planNoticeOf({ requiredTier: 'starter', reason: 'SUBSCRIPTION_INACTIVE' }, { planTier: 'starter', canManageBilling: true }).text).toBe(
      "This feature is paused because your Cost Control subscription isn't active. Go to billing to complete or resume it."
    )
  })

  it.each([
    ['no reason', { requiredTier: 'pro' as const }, 'pro'],
    ['a reason but the plan is not known as paid', { requiredTier: 'pro' as const, reason: 'BILLING_RESTRICTED' as const }, 'free'],
    ['a reason but no plan', { requiredTier: 'pro' as const, reason: 'BILLING_RESTRICTED' as const }, undefined],
  ])('%s: the plan sentence and See plans, unchanged', (_label, tierRequired, planTier) => {
    for (const canManageBilling of [true, false]) {
      expect(planNoticeOf(tierRequired, { planTier, canManageBilling })).toEqual({
        text: 'This feature is on the Optimization Engine plan.',
        link: SEE_PLANS,
        note: null,
      })
    }
  })
})
