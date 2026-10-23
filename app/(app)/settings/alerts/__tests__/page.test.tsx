/**
 * Alert settings page with write-only credentials.
 *
 * The server never returns a saved credential, only whether one is saved. The
 * page shows saved credentials as a placeholder with empty inputs, reads each
 * channel's status from those flags, sends blank credentials on save (which
 * keeps the saved ones) and lists removed ones in clearSecrets. Callers who are
 * not an owner or admin see the same page read-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertSettingsPage from '../page'

const mocks = vi.hoisted(() => ({
  role: { current: 'admin' as string | null },
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  testChannel: vi.fn(),
}))

vi.mock('@/lib/services/alert-config.service', () => ({
  alertConfigService: {
    getConfig: mocks.getConfig,
    updateConfig: mocks.updateConfig,
    testChannel: mocks.testChannel,
  },
}))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => mocks.role.current }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/safe-log', () => ({ logError: vi.fn() }))

const SAVED = '••• saved — leave blank to keep'

/** What GET returns once every channel has a saved credential. */
function redactedConfig() {
  return {
    email: {
      enabled: true,
      recipients: ['ops@example.com'],
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'alerts@example.com',
      smtpPass: '',
      smtpPassSet: true,
    },
    slack: { enabled: true, webhookUrl: '', webhookUrlSet: true, channel: '#alerts' },
    webhook: { enabled: true, url: '', urlSet: true, headers: { 'X-Auth': '' }, headersSet: ['X-Auth'] },
    jira: {
      enabled: true,
      baseUrl: 'https://example.atlassian.net',
      email: 'jira@example.com',
      apiToken: '',
      apiTokenSet: true,
      projectKey: 'OPS',
      issueType: 'Task',
    },
  }
}

async function renderPage() {
  render(<AlertSettingsPage />)
  await screen.findByText('Save Configuration')
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
}

beforeEach(() => {
  mocks.role.current = 'admin'
  mocks.getConfig.mockReset().mockResolvedValue(redactedConfig())
  mocks.updateConfig.mockReset().mockResolvedValue(undefined)
  mocks.testChannel.mockReset().mockResolvedValue(undefined)
})

describe('alert settings: saved credentials', () => {
  it('shows saved credentials as a placeholder with an empty input, and reads status from the saved flags', async () => {
    await renderPage()

    const smtpPass = screen.getByPlaceholderText(SAVED)
    expect(smtpPass).toHaveValue('')
    expect(screen.getAllByText('Connected')).toHaveLength(4)

    openTab('Slack')
    expect(await screen.findByPlaceholderText(SAVED)).toHaveValue('')
    openTab('Jira')
    expect(await screen.findByPlaceholderText(SAVED)).toHaveValue('')
    openTab('Webhook')
    expect(await screen.findByPlaceholderText(SAVED)).toHaveValue('')
  })

  it('an untouched save sends every credential blank and removes nothing', async () => {
    await renderPage()

    fireEvent.click(screen.getByText('Save Configuration'))

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1))
    const sent = mocks.updateConfig.mock.calls[0][0]
    expect(sent.email.smtpPass).toBe('')
    expect(sent.slack.webhookUrl).toBe('')
    expect(sent.webhook.url).toBe('')
    expect(sent.webhook.headers).toEqual({ 'X-Auth': '' })
    expect(sent.jira.apiToken).toBe('')
    expect(sent.clearSecrets).toEqual([])
    expect(JSON.stringify(sent)).not.toContain(SAVED)
  })

  it('Remove lists the credential in clearSecrets on the next save', async () => {
    await renderPage()
    openTab('Slack')

    fireEvent.click(await screen.findByRole('button', { name: 'Remove saved webhook URL' }))
    expect(screen.queryByPlaceholderText(SAVED)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Save Configuration'))

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1))
    expect(mocks.updateConfig.mock.calls[0][0].clearSecrets).toEqual(['slack.webhookUrl'])
  })
})

describe('alert settings: read-only for members and viewers', () => {
  it.each(['viewer', 'member', null])('role %s: inputs, Save and Test are disabled and nothing is saved', async (role) => {
    mocks.role.current = role
    await renderPage()

    expect(screen.getByText('Only owners and admins can change alert settings.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(SAVED)).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save Configuration/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Send Test Email/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Remove saved/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save Configuration/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send Test Email/ }))
    expect(mocks.updateConfig).not.toHaveBeenCalled()
    expect(mocks.testChannel).not.toHaveBeenCalled()
  })

  it('an admin sees no read-only note and can save', async () => {
    await renderPage()

    expect(screen.queryByText('Only owners and admins can change alert settings.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save Configuration/ })).toBeEnabled()
  })
})
