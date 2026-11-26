/**
 * The services limit's customer copy (stage-a §6.2, approved as printed) and
 * the recognizer for the server's 402.
 */
import { describe, expect, it } from 'vitest'
import { SERVICE_LIMIT_COPY as C, SERVICE_LIMIT_CONTACT_HREF, SERVICE_LIMIT_SEE_PLANS_HREF, SERVICE_LIMIT_UPDATE_BILLING_HREF } from '../copy'
import { serviceLimitRefusalMessage } from '../refusal'

describe('approved copy', () => {
  it('C1-C7, C10, C12 word for word', () => {
    expect(C.title).toBe('Service limit reached')
    expect(C.planBody('Visibility', 5, 5)).toBe("Your Visibility plan includes 5 services, and this workspace has 5. Your existing services, deployments and GitHub mappings aren't affected.")
    expect(C.planBody(null, 3, 4)).toBe("Your plan includes 3 services, and this workspace has 4. Your existing services, deployments and GitHub mappings aren't affected.")
    expect(C.seePlans).toBe('See plans')
    expect(`${C.managedLead}${C.contactUs}.`).toBe("To change your plan's limits, contact us.")
    expect(C.holdBody('Visibility', 5, 8)).toBe("Billing needs attention, so this workspace has the Visibility limit of 5 services until it's resolved. It has 8. Your existing services aren't affected.")
    expect(C.updateBilling).toBe('Update billing')
    expect(C.submitReason).toBe('Service limit reached')
    expect(C.notCreatedTitle).toBe('Service not created')
    expect(C.billingLabel).toBe('Registered services')
    expect([C.billingValue(4, 5), C.billingValue(12, null)]).toEqual(['4 / 5', '12 · Unlimited'])
    expect([C.registeredCount(4, 5), C.registeredCount(4, null)]).toEqual(['4 of 5 registered', '4 registered'])
  })

  it('links: See plans, Update billing, the support mailbox (FQ7)', () => {
    expect(SERVICE_LIMIT_SEE_PLANS_HREF).toBe('/settings/billing/upgrade')
    expect(SERVICE_LIMIT_UPDATE_BILLING_HREF).toBe('/settings/billing')
    expect(SERVICE_LIMIT_CONTACT_HREF).toBe('mailto:support@getdevcontrol.com')
  })

  it('no internal tier id in any string', () => {
    const all = [C.title, C.planBody('Cost Control', 20, 20), C.holdBody('Visibility', 5, 5), C.submitReason, C.notCreatedTitle, C.billingLabel]
    for (const text of all) expect(text).not.toMatch(/\b(free|starter|pro|enterprise)\b/)
  })
})

describe('serviceLimitRefusalMessage', () => {
  const refusal = (over: Record<string, unknown> = {}, status = 402) => ({
    response: { status, data: { success: false, error: 'the server message', code: 'RESOURCE_LIMIT_REACHED', details: { resourceType: 'services' }, ...over } },
  })

  it('the server\'s message for a services 402', () => {
    expect(serviceLimitRefusalMessage(refusal())).toBe('the server message')
  })

  it.each([
    ['another status', refusal({}, 403)],
    ['another code', refusal({ code: 'TIER_REQUIRED' })],
    ['another resource (seats)', refusal({ details: { resourceType: 'users' } })],
    ['no message', refusal({ error: '' })],
    ['no response', new Error('Network Error')],
    ['nothing', null],
  ])('null for %s', (_label, error) => {
    expect(serviceLimitRefusalMessage(error)).toBeNull()
  })
})
