/**
 * One trial component for every trial mention (CAT-1, C1-D6/D7): off by
 * default and on any doubt; "Get started" while off, "Start 14-day trial"
 * only while the server's switch is on; never "no credit card".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TrialCta, TrialLine, InAppTrialLine, TRIAL_COPY, TRIAL_SIGN_UP_HREF, SIGN_UP_HREF } from '../trial-line'
import { resetBillingOfferForTests } from '@/lib/billing/offer'
import { PricingFAQ } from '../pricing-faq'

const ON = { trial: { enabled: true, days: 14, plans: ['starter', 'pro'], cardRequired: true } }
const OFF = { trial: { enabled: false } }

function serve(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => resetBillingOfferForTests())
afterEach(() => vi.restoreAllMocks())

const settle = async (container: HTMLElement, state: 'on' | 'off') => {
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  await waitFor(() => {
    for (const el of container.querySelectorAll('[data-trial]')) expect(el.getAttribute('data-trial')).toBe(state)
  })
}

describe('TrialCta', () => {
  it('off: "Get started" to sign-up', async () => {
    serve(OFF)
    const { container } = render(<TrialCta />)
    await settle(container, 'off')
    const link = screen.getByRole('link', { name: 'Get started' })
    expect(link.getAttribute('href')).toBe(SIGN_UP_HREF)
  })

  it('on: "Start 14-day trial", landing on the plan picker after sign-up', async () => {
    serve(ON)
    const { container } = render(<TrialCta />)
    await settle(container, 'on')
    const link = screen.getByRole('link', { name: 'Start 14-day trial' })
    expect(link.getAttribute('href')).toBe(TRIAL_SIGN_UP_HREF)
    expect(TRIAL_SIGN_UP_HREF).toBe('/register#from=%2Fsettings%2Fbilling%2Fupgrade')
  })

  it('on, but for a plan without a trial: still "Get started"', async () => {
    serve(ON)
    render(<><TrialCta plan="enterprise" /><TrialCta plan="free" /></>)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getAllByRole('link', { name: 'Get started' })).toHaveLength(2)
  })

  it('before the answer arrives (and on a failure): off', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<TrialCta />)
    expect(screen.getByRole('link', { name: 'Get started' })).toBeTruthy()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Get started' })).toBeTruthy()
  })
})

describe('TrialLine', () => {
  it('off: the trust row starts with "Free Visibility plan"; chip, sentence and table show nothing', async () => {
    serve(OFF)
    const { container } = render(
      <div>
        <TrialLine variant="trust" rest={['Read-only AWS access', 'Cancel anytime']} />
        <TrialLine variant="chip" />
        <TrialLine variant="sentence" />
        <TrialLine variant="table" />
      </div>,
    )
    await settle(container, 'off')
    expect(container.textContent).toBe('Free Visibility plan · Read-only AWS access · Cancel anytime')
  })

  it('on: the approved strings', async () => {
    serve(ON)
    const { container } = render(
      <div>
        <p data-testid="trust"><TrialLine variant="trust" rest={['Cancel anytime']} /></p>
        <p data-testid="chip"><TrialLine variant="chip" /></p>
        <p data-testid="sentence"><TrialLine variant="sentence" /></p>
        <p data-testid="table"><TrialLine variant="table" /></p>
      </div>,
    )
    await settle(container, 'on')
    expect(screen.getByTestId('trust').textContent).toBe('14-day free trial on Cost Control and Optimization Engine (card required) · Cancel anytime')
    expect(screen.getByTestId('chip').textContent).toBe('14-day free trial (card required)')
    expect(screen.getByTestId('sentence').textContent).toBe('14-day free trial on Cost Control and Optimization Engine (card required)')
    expect(screen.getByTestId('table').textContent).toBe('Cost Control and Optimization Engine include a 14-day free trial (card required).')
  })

  it('never says "no credit card", in any variant or state', () => {
    const strings = [
      TRIAL_COPY.ctaOff, TRIAL_COPY.ctaOn(14), TRIAL_COPY.sentence(14, 'X'), TRIAL_COPY.table(14, 'X'),
      TRIAL_COPY.chip(14), TRIAL_COPY.inApp(14), TRIAL_COPY.started(14), TRIAL_COPY.noTrial,
    ]
    for (const s of strings) expect(s).not.toMatch(/no credit card|no card/i)
  })
})

describe('InAppTrialLine', () => {
  it('shows only when the billing summary says this organization may start a trial, and makes no public request', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { container, rerender } = render(<InAppTrialLine eligible={false} />)
    expect(container.textContent).toBe('')
    rerender(<InAppTrialLine eligible />)
    expect(container.textContent).toBe("14-day free trial. Card required; you're charged when the trial ends unless you cancel.")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pricing FAQ trial questions come from the trial line (L-4)', () => {
  it('off: neither trial question is shown', async () => {
    serve(OFF)
    const { container } = render(<PricingFAQ />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).not.toContain(TRIAL_COPY.faqAfterQuestion)
    expect(container.textContent).not.toMatch(/free trial/i)
  })

  it('on: both questions and answers, exactly the TRIAL_COPY strings', async () => {
    serve(ON)
    const { container } = render(<PricingFAQ />)
    await waitFor(() => expect(container.textContent).toContain(TRIAL_COPY.faqAfterQuestion))
    const text = container.textContent ?? ''
    expect(text).toContain(TRIAL_COPY.faqAfterAnswer(14))
    expect(text).toContain(TRIAL_COPY.faqIncludedQuestion(14))
    expect(text).toContain(TRIAL_COPY.faqIncludedAnswer(14, 'Cost Control or Optimization Engine'))
    expect(TRIAL_COPY.faqIncludedAnswer(14, 'Cost Control or Optimization Engine')).toBe(
      "Everything in the plan you choose, for 14 days, on Cost Control or Optimization Engine. A card is required; you're charged when the trial ends unless you cancel.",
    )
  })
})
