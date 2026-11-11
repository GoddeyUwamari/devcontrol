/**
 * The founding-member banner (hidden on every surface while
 * FOUNDING_OFFER_VISIBLE is false, C1-D9): when it is turned on it carries the
 * approved price-lock copy (F2/F3/F5, founder 2026-11-11, L-7), shows a real
 * count or none (F1/F6), fills the dots from the count (F4) and hides itself
 * once the spots are taken (F8). No "forever" or "never pay more" anywhere.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FoundingBanner, FOUNDING_COPY } from '../founding-banner'
import { FOUNDING_OFFER_VISIBLE, FOUNDING_SPOTS } from '@/lib/plan/plan-catalog'

const ROOT = join(__dirname, '..', '..', '..')

function serve(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => vi.restoreAllMocks())

describe('founding-member banner', () => {
  it('stays hidden: the flag is off', () => {
    expect(FOUNDING_OFFER_VISIBLE).toBe(false)
  })

  it('approved copy (F2/F3/F5)', () => {
    expect(FOUNDING_COPY.title).toBe('Founding member pricing — keep your rate for as long as you stay subscribed')
    expect(FOUNDING_COPY.detail(50)).toBe('Prices go up after the first 50 customers. Founding members keep their rate.')
    expect(FOUNDING_COPY.claimed(7, 50)).toBe('7 of 50 founding spots claimed')
  })

  it('a real count: shown, with the dots filled from it', async () => {
    serve({ count: 20 })
    render(<FoundingBanner />)
    expect(await screen.findByText(FOUNDING_COPY.claimed(20, FOUNDING_SPOTS))).toBeTruthy()
    const dots = screen.getByTestId('founding-count').querySelectorAll('[data-dot="filled"]')
    expect(dots).toHaveLength(Math.round((20 / FOUNDING_SPOTS) * 10))
    expect(screen.getByTestId('founding-banner').textContent).toContain(FOUNDING_COPY.title)
  })

  it.each([
    ['the server failing (503, count null)', { count: null }, 503],
    ['a malformed answer', { count: '5' }, 200],
    ['a negative number', { count: -1 }, 200],
  ])('%s: no counter, never an invented number', async (_name, body, status) => {
    const fetchMock = serve(body, status)
    render(<FoundingBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('founding-count')).toBeNull()
    expect(screen.getByTestId('founding-banner').textContent).not.toMatch(/spots claimed/)
  })

  it('full: the banner hides itself', async () => {
    serve({ count: FOUNDING_SPOTS })
    const { container } = render(<FoundingBanner />)
    await waitFor(() => expect(container.querySelector('[data-testid="founding-banner"]')).toBeNull())
  })

  it('no "forever" or "never pay more" in the banner or the pricing page', () => {
    for (const file of ['components/billing/founding-banner.tsx', 'app/(marketing)/pricing/page.tsx']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/locked in forever|rate[^.]*forever|never pay more/i)
    }
  })
})
