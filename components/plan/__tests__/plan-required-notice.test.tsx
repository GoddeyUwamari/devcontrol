/**
 * Billing safety PR B (B4): PlanRequiredNotice shows the billing sentence
 * only when the organization's stored plan includes the feature, the tier the
 * server enforces does not, and the server reported a hold
 * (organization.entitlementHold). Owners and admins get Go to billing;
 * everyone else the ask-an-admin sentence. Otherwise the plan sentence and
 * See plans, as before. The approved copy is written out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { tokenManager } from '@/lib/services/auth.service'
import { PlanRequiredNotice } from '../plan-required-notice'

const auth: { tier: string; effective: string; hold: string | null } = { tier: 'pro', effective: 'free', hold: 'payment' }
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: auth.tier, effectiveTier: auth.effective, entitlementHold: auth.hold },
    organizationStatus: 'ready',
    retryOrganizationLoad: vi.fn(),
  }),
}))

const PAYMENT = (plan: string) =>
  `This feature is paused because of a payment issue. Your ${plan} plan is unchanged — update your payment details to restore access.`
const INACTIVE = (plan: string) =>
  `This feature is paused because your ${plan} subscription isn't active. Go to billing to complete or resume it.`
const ASK = 'Ask an organization owner or admin to update billing.'
const PLAN = (plan: string) => `This feature is on the ${plan} plan.`

async function renderAs(role: string | null, requiredTier: 'starter' | 'pro' | 'enterprise') {
  vi.spyOn(tokenManager, 'getCurrentRole').mockReturnValue(role)
  render(<PlanRequiredNotice requiredTier={requiredTier} testId="notice" />)
  // The role is read after mount (useCurrentRole).
  await act(async () => {})
}

const link = () => screen.queryByRole('link')

beforeEach(() => {
  Object.assign(auth, { tier: 'pro', effective: 'free', hold: 'payment' })
})
afterEach(() => vi.restoreAllMocks())

describe('payment hold on a feature the plan includes', () => {
  it.each(['owner', 'admin'])('%s: the payment sentence and Go to billing (/settings/billing)', async (role) => {
    await renderAs(role, 'pro')
    expect(screen.getByTestId('notice').textContent).toContain(PAYMENT('Optimization Engine'))
    expect(link()?.textContent).toBe('Go to billing')
    expect(link()?.getAttribute('href')).toBe('/settings/billing')
    expect(screen.queryByText(ASK)).toBeNull()
  })

  it.each(['member', 'viewer', null])('%s: the payment sentence and the ask-an-admin sentence, no link', async (role) => {
    await renderAs(role, 'pro')
    expect(screen.getByText(PAYMENT('Optimization Engine'))).toBeTruthy()
    expect(screen.getByText(ASK)).toBeTruthy()
    expect(link()).toBeNull()
  })
})

describe('inactive subscription on a feature the plan includes', () => {
  beforeEach(() => Object.assign(auth, { hold: 'subscription_inactive' }))

  it('admin: the inactive sentence and Go to billing', async () => {
    await renderAs('admin', 'starter')
    expect(screen.getByText(INACTIVE('Optimization Engine'))).toBeTruthy()
    expect(link()?.textContent).toBe('Go to billing')
    expect(link()?.getAttribute('href')).toBe('/settings/billing')
  })

  it('member: the inactive sentence and the ask-an-admin sentence, no link', async () => {
    await renderAs('member', 'starter')
    expect(screen.getByText(INACTIVE('Optimization Engine'))).toBeTruthy()
    expect(screen.getByText(ASK)).toBeTruthy()
    expect(link()).toBeNull()
  })
})

describe('the plan sentence and See plans when updating billing would not unlock the feature', () => {
  it.each([
    ['the stored plan is below the feature (Cost Control, payment hold, Optimization Engine feature)', { tier: 'starter', effective: 'free', hold: 'payment' }, 'pro', 'Optimization Engine'],
    ['a Revenue Protection feature on a held Optimization Engine plan', { tier: 'pro', effective: 'free', hold: 'payment' }, 'enterprise', 'Revenue Protection'],
    ['no hold (a canceled subscription)', { tier: 'pro', effective: 'free', hold: null }, 'pro', 'Optimization Engine'],
    ['free plan', { tier: 'free', effective: 'free', hold: null }, 'pro', 'Optimization Engine'],
  ])('%s', async (_label, state, requiredTier, planName) => {
    Object.assign(auth, state)
    for (const role of ['owner', 'member']) {
      await renderAs(role, requiredTier as 'pro' | 'enterprise')
      expect(screen.getByText(PLAN(planName))).toBeTruthy()
      expect(link()?.textContent).toBe('See plans')
      expect(screen.queryByText(ASK)).toBeNull()
      expect(screen.queryByText(/paused/)).toBeNull()
      document.body.innerHTML = ''
    }
  })
})
