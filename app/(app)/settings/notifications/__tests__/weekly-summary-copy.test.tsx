/**
 * The weekly summary toggle describes what the email actually contains
 * (weekly-email-step1.md, mock v1 (e), founder Nov 11): no "AI", no anomaly
 * detections, no personalized recommendations, the send time with its zone,
 * and -- for anyone who is not an owner -- that only owners receive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import NotificationsSettingsPage from '../page'

const mocks = vi.hoisted(() => ({
  role: { current: 'owner' as string | null },
  getEmailPreferences: vi.fn(),
}))

vi.mock('@/lib/services/user-preferences.service', () => ({
  userPreferencesService: { getEmailPreferences: mocks.getEmailPreferences, updateSinglePreference: vi.fn() },
}))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => mocks.role.current }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/safe-log', () => ({ logError: vi.fn() }))

const OWNER_NOTE = 'Only organization owners receive the weekly summary. This setting applies if you become an owner.'

async function renderPage() {
  render(<NotificationsSettingsPage />)
  await waitFor(() => expect(screen.getByText('Weekly summary email')).toBeTruthy())
}

beforeEach(() => {
  mocks.getEmailPreferences.mockReset().mockResolvedValue({
    weeklySummary: true, anomalyAlerts: true, costAlerts: true, deploymentAlerts: true,
  })
})

describe('weekly summary toggle copy', () => {
  it('states what the email holds and when, with no AI or unbuilt-feature claim', async () => {
    mocks.role.current = 'owner'
    await renderPage()
    expect(screen.getByText(
      "Every Monday at 09:00 UTC: last week's AWS spend, security findings, estimated savings and deployments for your organization."
    )).toBeTruthy()
    expect(screen.getByText('Sent every Monday at 09:00 UTC')).toBeTruthy()
    const card = screen.getByText('Weekly summary email').closest('div.flex.items-start.justify-between')!
    expect(card.textContent).not.toMatch(/\bAI\b|AI-powered|anomal|personali[sz]ed|comprehensive/i)
    expect(screen.queryByText('Weekly AI Summary')).toBeNull()
  })

  it('an owner sees no owner-only note', async () => {
    mocks.role.current = 'owner'
    await renderPage()
    expect(screen.queryByText(OWNER_NOTE)).toBeNull()
  })

  it.each(['admin', 'member', 'viewer'])('a %s is told only owners receive it', async (role) => {
    mocks.role.current = role
    await renderPage()
    expect(screen.getByText(OWNER_NOTE)).toBeTruthy()
  })

  it('while the role is not known yet, no note is shown', async () => {
    mocks.role.current = null
    await renderPage()
    expect(screen.queryByText(OWNER_NOTE)).toBeNull()
  })
})
