/**
 * WE-D1 (founder 2026-11-11): the weekly email is listed for what it is -- a
 * summary with no model-written text -- and its AI part is its own Coming soon
 * row on the same plan. Nothing removed: both rows sit on the Visibility card.
 */
import { describe, it, expect } from 'vitest'
import { feature, plan, COMING_SOON_BADGE } from '../plan-catalog'

describe('weekly email catalog rows (WE-D1)', () => {
  it('"Weekly summary email": same id, same plan, verified, no AI chip, no "AI" in the label', () => {
    const f = feature('weekly-ai-summary')
    expect(f.label).toBe('Weekly summary email')
    expect(f.tier).toBe('free')
    expect(f.status).toBe('verified')
    expect(f.ai).toBeFalsy()
    expect(f.label).not.toMatch(/\bAI\b/)
  })

  it('"AI recommendations in the weekly email": Coming soon, AI chip, same plan', () => {
    const f = feature('weekly-ai-recommendations')
    expect(f.label).toBe('AI recommendations in the weekly email')
    expect(f.tier).toBe('free')
    expect(f.status).toBe('coming_soon')
    expect(f.badge).toBe(COMING_SOON_BADGE)
    expect(f.ai).toBe(true)
  })

  it('both are on the Visibility card, the AI row right after the email row', () => {
    const card = plan('free').card
    const at = card.indexOf('weekly-ai-summary')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(card[at + 1]).toBe('weekly-ai-recommendations')
  })
})
