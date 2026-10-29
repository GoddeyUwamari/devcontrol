import { describe, it, expect } from 'vitest'
import { PLAN_DISPLAY_NAME } from '../plan-names'
import { SEE_PLANS, planRequiredText, responseError, tierRequiredOf } from '../tier-required'
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
