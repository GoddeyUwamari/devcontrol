/**
 * The UI's plan table is the server's: same features, same plan for each.
 * The server table has no runtime imports, so it is read directly.
 */
import { describe, it, expect } from 'vitest'
import { PLAN_ENTITLEMENTS as UI } from '../entitlements'
import { PLAN_ENTITLEMENTS as SERVER } from '../../../backend/src/config/plan-entitlements'

describe('plan entitlements', () => {
  it('the UI mirror equals the server table', () => {
    expect(UI).toEqual(SERVER)
  })
})
