/**
 * The welcome modal may only claim what the product does today: a read-only
 * connect, a scan after connecting and on a schedule, cost findings with
 * estimated savings, and security findings alongside. Its primary button
 * takes the user to the real connect flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { push, completeStep, dismiss } = vi.hoisted(() => ({
  push: vi.fn(),
  completeStep: vi.fn(async () => {}),
  dismiss: vi.fn(async () => {}),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/components/demo/demo-mode-toggle', () => ({
  useDemoMode: () => false,
}))

vi.mock('@/lib/stores/onboarding-store', () => ({
  useOnboarding: () => ({
    status: { currentStage: 'welcome' },
    currentStage: 'welcome',
    completedStages: [],
    completeStep,
    dismiss,
  }),
}))

import { WelcomeModal } from '../welcome-modal'

// Claims the product cannot back today. Matched as whole words, ignoring case.
const BANNED_TERMS = [
  'one-click',
  'cost spikes',
  'oversized',
  '5 minutes',
  'minutes',
  'exactly',
  'measurable',
  'before they become incidents',
  'AI',
  'insight',
  'every 6 hours',
]

const ALLOWED_STEPS = [
  'Connect AWS: create a read-only IAM role. DevControl makes no changes to your account.',
  'DevControl scans: right after you connect, then on a regular schedule.',
  'Review findings: cost findings show estimated monthly savings; security findings are listed alongside.',
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function openModal() {
  render(<WelcomeModal />)
  return screen.findByRole('dialog')
}

describe('WelcomeModal copy', () => {
  beforeEach(() => {
    push.mockClear()
    completeStep.mockClear()
    dismiss.mockClear()
  })

  it('the banned-term matcher matches whole words only', () => {
    const ai = new RegExp(`\\b${escapeRegExp('AI')}\\b`, 'i')
    expect(ai.test('maintain')).toBe(false)
    expect(ai.test('AI Analysis')).toBe(true)
  })

  it('contains none of the banned claims', async () => {
    const text = (await openModal()).textContent ?? ''
    for (const term of BANNED_TERMS) {
      expect(text, term).not.toMatch(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i'))
    }
  })

  it('contains no percentages', async () => {
    const text = (await openModal()).textContent ?? ''
    expect(text).not.toMatch(/\d\s*%/)
  })

  it('the steps match the allowlist exactly', async () => {
    await openModal()
    const steps = screen.getAllByTestId('welcome-step').map((li) => li.textContent)
    expect(steps).toEqual(ALLOWED_STEPS)
  })

  it('the primary button completes the welcome step, then opens /connect-aws', async () => {
    await openModal()
    fireEvent.click(screen.getByRole('button', { name: 'Connect AWS →' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/connect-aws'))
    expect(completeStep).toHaveBeenCalledWith('welcome')
    expect(completeStep.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0])
    expect(dismiss).not.toHaveBeenCalled()
  })
})
