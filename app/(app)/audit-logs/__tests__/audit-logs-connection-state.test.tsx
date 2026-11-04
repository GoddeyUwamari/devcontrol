/**
 * /audit-logs "connected" (AWS connect PR B): only the server's connection
 * state decides the empty-state wording, never the presence of account rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getConnection = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/audit-logs.service', () => ({
  auditLogsService: {
    getAll: vi.fn(async () => ({ data: [], total: 0 })),
    getActions: vi.fn(async () => []),
    getResourceTypes: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/services/demo-mode.service', () => ({ demoModeService: { isEnabled: () => false } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: { getAccountsAndConnection: async () => {
    // FAIL and PENDING are answered here, not by the spy: a spy that itself returns a
    // rejected or never-settling promise is reported by vitest as the test's own error.
    const r = await getConnection()
    if (r === 'FAIL') throw new Error('500')
    if (r === 'PENDING') return new Promise(() => {})
    return r
  } },
}))

import AuditLogsPage from '../page'

const CONNECTED_COPY = /No audit activity recorded yet\. DevControl captures/
const NOT_CONNECTED_COPY = /Once connected, DevControl will track/

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AuditLogsPage /></QueryClientProvider>)
}

beforeEach(() => getConnection.mockReset())

describe('/audit-logs: connected comes from the server connection state only', () => {
  it.each([
    ['not connected', { accounts: [], connection: 'not_connected' }],
    ['a row that is no longer active', { accounts: [{ id: 'acct-1', status: 'disconnected' }], connection: 'not_connected' }],
    ['more than one active connection', { accounts: [], connection: 'ambiguous' }],
  ])('%s: the not-connected wording', async (_label, answer) => {
    getConnection.mockResolvedValue(answer)
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    expect(await screen.findByText(NOT_CONNECTED_COPY)).toBeInTheDocument()
    expect(screen.queryByText(CONNECTED_COPY)).not.toBeInTheDocument()
  })

  it('error: never the connected wording', async () => {
    getConnection.mockResolvedValue('FAIL')
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    expect(await screen.findByText(NOT_CONNECTED_COPY)).toBeInTheDocument()
    expect(screen.queryByText(CONNECTED_COPY)).not.toBeInTheDocument()
  })

  it('loading: never the connected wording', async () => {
    getConnection.mockResolvedValue('PENDING')
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    expect(await screen.findByText(NOT_CONNECTED_COPY)).toBeInTheDocument()
    expect(screen.queryByText(CONNECTED_COPY)).not.toBeInTheDocument()
  })

  it('connected: the server reports one active connection', async () => {
    getConnection.mockResolvedValue({ accounts: [{ id: 'acct-1', status: 'active' }], connection: 'connected' })
    renderPage()
    expect(await screen.findByText(CONNECTED_COPY)).toBeInTheDocument()
  })
})
