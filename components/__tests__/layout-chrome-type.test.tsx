/**
 * The layout chrome rendered by app/(app)/layout.tsx is on the app type scale (typography plan T2c):
 * DemoBanner, ErrorBoundary, WelcomeModal and the AI chat widget. Nothing below 12 px, no gray-400/500
 * text, no faded white, and the welcome modal's title is the dialog title role (18/26 at every width) and
 * the dialog's accessible name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const demo = vi.hoisted(() => ({ on: true }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false, toggle: vi.fn() }) }))
vi.mock('@/lib/safe-log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/services/ai-chat.service', () => ({ aiChatService: { sendMessage: vi.fn() } }))
const onboarding = vi.hoisted(() => ({
  status: { currentStage: 'welcome' }, currentStage: 'welcome', completedStages: [] as string[],
  completeStep: async () => {}, dismiss: async () => {},
}))
vi.mock('@/lib/stores/onboarding-store', () => ({ useOnboarding: () => onboarding }))

import { DemoBanner } from '../demo/DemoBanner'
import { ErrorBoundary } from '../error-boundary'
import { WelcomeModal } from '../onboarding/welcome-modal'
import { AIChatWidget } from '../ai/AIChatWidget'

const classes = (el: Element) => el.className.split(/\s+/)
// dark: variants are exempt (dark mode is not wired up; typography plan Q3).
const NO_SMALL_OR_FADED = /text-\[0\.\d+rem\]|text-\[1[01]px\]|(?<![\w:-])text-xs|text-white\/\d+|(?<!dark:)text-gray-(?:400|500)(?![\w-])/

describe('DemoBanner', () => {
  beforeEach(() => { demo.on = true })

  it('label 12 px (13 from sm), the sentence in full white, the button white 600 with no inline type', () => {
    render(<DemoBanner />)
    const banner = screen.getByTestId('demo-banner')
    expect(banner.innerHTML).not.toMatch(NO_SMALL_OR_FADED)
    expect(classes(screen.getByText('Demo Mode active'))).toEqual(expect.arrayContaining(['text-label', 'sm:text-meta', 'font-semibold', 'text-white']))
    expect(classes(screen.getByText(/Showing sample data/))).toEqual(expect.arrayContaining(['text-meta', 'text-white']))
    const button = screen.getByRole('button', { name: 'Switch to real data' })
    expect(classes(button)).toEqual(expect.arrayContaining(['text-label', 'sm:text-meta', 'font-semibold', 'text-white']))
    expect(button.getAttribute('style')).not.toMatch(/font-weight|(?:^|;\s*)color:/)
  })
})

describe('ErrorBoundary', () => {
  it('the fallback title is the section role in ink, the copy body in muted ink', () => {
    const Boom = () => { throw new Error('boom') }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    spy.mockRestore()
    expect(classes(screen.getByRole('heading', { name: 'Something went wrong' }))).toEqual(expect.arrayContaining(['text-section', 'text-ink']))
    expect(classes(screen.getByText(/Your data is safe/))).toEqual(expect.arrayContaining(['text-body', 'text-ink-muted']))
    expect(screen.getByRole('heading', { name: 'Something went wrong' }).className).not.toMatch(/text-xl|text-gray-900/)
  })
})

describe('WelcomeModal', () => {
  beforeEach(() => { demo.on = false })

  it('its title is the dialog title role at every width, and names the dialog', async () => {
    vi.useFakeTimers()
    render(<WelcomeModal />)
    await act(async () => { vi.advanceTimersByTime(600) })
    vi.useRealTimers()
    const dialog = screen.getByRole('dialog', { name: 'Connect AWS to get started' })
    const title = dialog.querySelector('[data-slot="dialog-title"]')!
    expect(title.textContent).toContain('Connect AWS to get started')
    expect(classes(title)).toEqual(expect.arrayContaining(['text-section', 'font-semibold']))
    expect(title.className).not.toMatch(/text-(?:lg|xl|2xl)/)
    expect(classes(screen.getByText(/reads your AWS account/))).toEqual(expect.arrayContaining(['text-body', 'text-ink-muted']))
    expect(classes(dialog.querySelector('ol')!)).toEqual(expect.arrayContaining(['text-ui', 'text-ink-body']))
    expect(classes(screen.getByText('Read-only access'))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))
    expect(dialog.innerHTML).not.toMatch(NO_SMALL_OR_FADED)
  })
})

describe('AI chat widget', () => {
  it('header, empty state, prompts, input and footer are on the type roles; no gray-400/500 text', () => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
    render(<AIChatWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Open AI Assistant' }))
    expect(classes(screen.getByText('AWS AI Assistant'))).toContain('text-card-title')
    expect(classes(screen.getByRole('heading', { name: 'AWS Infrastructure Assistant' }))).toEqual(expect.arrayContaining(['text-section', 'text-ink']))
    expect(classes(screen.getByText(/Ask me anything/))).toEqual(expect.arrayContaining(['text-body', 'text-ink-muted']))
    expect(classes(screen.getByText('Quick questions:'))).toEqual(expect.arrayContaining(['text-meta', 'font-medium', 'text-ink-muted']))
    const input = screen.getByPlaceholderText('Ask about your AWS environment...')
    expect(classes(input)).toEqual(expect.arrayContaining(['text-ui', 'text-ink', 'placeholder:text-ink-muted']))
    expect(classes(screen.getByText('Press Enter to send'))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))
    expect(document.body.innerHTML).not.toMatch(NO_SMALL_OR_FADED)
  })
})
