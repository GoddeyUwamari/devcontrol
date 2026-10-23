/**
 * Alert settings page with write-only credentials.
 *
 * The server never returns a saved credential, only whether one is saved. The
 * page shows saved credentials as a placeholder with empty inputs, reads each
 * channel's status from those flags, sends blank credentials on save (which
 * keeps the saved ones) and lists removed ones in clearSecrets. Callers who are
 * not an owner or admin see the same page read-only. A failed save or test
 * shows the server's message, never the HTTP client's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
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
const SLACK_EXAMPLE = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX'
const NEW_SLACK = 'https://hooks.slack.com/services/NEW'

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
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

/** How axios rejects a non-2xx answer: its own status line, the server's body under response. */
function httpError(status: number, error: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { success: false, error } },
  })
}

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

  it('Remove and then a new value saves the new value and removes nothing', async () => {
    await renderPage()
    openTab('Slack')

    fireEvent.click(await screen.findByRole('button', { name: 'Remove saved webhook URL' }))
    fireEvent.change(screen.getByPlaceholderText(SLACK_EXAMPLE), { target: { value: NEW_SLACK } })
    fireEvent.click(screen.getByText('Save Configuration'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alert configuration saved successfully'))
    expect(mocks.updateConfig).toHaveBeenCalledTimes(1)
    const sent = mocks.updateConfig.mock.calls[0][0]
    expect(sent.slack.webhookUrl).toBe(NEW_SLACK)
    expect(sent.clearSecrets).toEqual([])
  })

  it('a new value and then Remove removes the saved value and sends none', async () => {
    await renderPage()
    openTab('Slack')

    fireEvent.change(await screen.findByPlaceholderText(SAVED), { target: { value: NEW_SLACK } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved webhook URL' }))
    expect(screen.getByPlaceholderText(SLACK_EXAMPLE)).toHaveValue('')
    fireEvent.click(screen.getByText('Save Configuration'))

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1))
    const sent = mocks.updateConfig.mock.calls[0][0]
    expect(sent.slack.webhookUrl).toBe('')
    expect(sent.clearSecrets).toEqual(['slack.webhookUrl'])
  })
})

describe('alert settings: failures show the server message', () => {
  it('a refused save shows the server message and no success', async () => {
    mocks.updateConfig.mockRejectedValue(httpError(400, 'Jira URL must be HTTPS'))
    await renderPage()

    fireEvent.click(screen.getByText('Save Configuration'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Jira URL must be HTTPS'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByText(/Request failed/)).not.toBeInTheDocument()
  })

  it('a failed test shows the server message, not the status line', async () => {
    const message = 'Test alert to email failed. Check the channel settings and try again.'
    mocks.testChannel.mockRejectedValue(httpError(502, message))
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Send Test Email/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(toast.success).not.toHaveBeenCalled()
    expect(vi.mocked(toast.error).mock.calls.flat().join(' ')).not.toContain('Request failed')
  })

  it.each([
    ['save', 'Failed to save configuration'],
    ['test', 'Failed to send test alert'],
  ])('a %s failure without a server message shows a fixed one', async (action, fallback) => {
    const noAnswer = new Error('Request failed with status code 503')
    if (action === 'save') mocks.updateConfig.mockRejectedValue(noAnswer)
    else mocks.testChannel.mockRejectedValue(noAnswer)
    await renderPage()

    fireEvent.click(
      action === 'save' ? screen.getByText('Save Configuration') : screen.getByRole('button', { name: /Send Test Email/ })
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(fallback))
    expect(toast.success).not.toHaveBeenCalled()
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
