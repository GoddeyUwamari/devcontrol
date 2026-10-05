/**
 * Regression coverage for the Create Team page calling a hardcoded
 * `http://localhost:8080/api/teams` with a raw, unauthenticated fetch. That
 * request was refused in production and could never have carried the Bearer
 * token the teams routes require.
 *
 * The real teamsService and shared axios client are used here, with only the
 * client's transport stubbed, so the assertions cover what actually goes on
 * the wire: relative URL (resolved against the configured base URL), Bearer
 * token, and payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import CreateTeamPage from '../page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
const fetchSpy = vi.fn()

function stubTransport(status: number, body: unknown) {
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config)
    const response = { data: body, status, statusText: '', headers: {}, config }
    if (status >= 400) {
      const { AxiosError } = await import('axios')
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, response)
    }
    return response
  }
  api.defaults.adapter = adapter
}

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Platform Engineering'), { target: { value: 'Platform Team' } })
  fireEvent.change(screen.getByPlaceholderText('owner@company.com'), { target: { value: 'owner@example.com' } })
  fireEvent.change(screen.getByPlaceholderText(/Team responsible for/), { target: { value: 'Owns the platform' } })
  fireEvent.change(screen.getByPlaceholderText('#platform-engineering'), { target: { value: '#platform-team' } })
  fireEvent.click(screen.getByRole('button', { name: /create team/i }))
}

describe('Create Team page — shared authenticated API client', () => {
  beforeEach(() => {
    requests.length = 0
    vi.clearAllMocks()
    localStorage.setItem('accessToken', 'test-access-token')
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('posts the team through the shared client with the Bearer token', async () => {
    stubTransport(201, { success: true, data: { id: 'team-1', name: 'Platform Team' }, message: 'Team created successfully' })

    render(<CreateTeamPage />)
    fillAndSubmit()

    await waitFor(() => expect(requests).toHaveLength(1))
    const [request] = requests
    expect(request.method).toBe('post')
    expect(request.url).toBe('/api/teams')
    expect(request.baseURL).toBe(api.defaults.baseURL)
    expect(request.headers.Authorization).toBe('Bearer test-access-token')
    expect(JSON.parse(request.data)).toEqual({
      name: 'Platform Team',
      description: 'Owns the platform',
      owner: 'owner@example.com',
      slackChannel: '#platform-team',
      members: ['owner@example.com'],
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Team created successfully!'))
    expect(mockPush).toHaveBeenCalledWith('/teams')
  })

  it('omits the optional fields when they are left blank', async () => {
    stubTransport(201, { success: true, data: { id: 'team-1' } })

    render(<CreateTeamPage />)
    fireEvent.change(screen.getByPlaceholderText('Platform Engineering'), { target: { value: 'Platform Team' } })
    fireEvent.change(screen.getByPlaceholderText('owner@company.com'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /create team/i }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(JSON.parse(requests[0].data)).toEqual({
      name: 'Platform Team',
      owner: 'owner@example.com',
      members: ['owner@example.com'],
    })
  })

  it('shows the fallback error and stays on the page when the API rejects the request', async () => {
    // The teams controller reports failures under `error`, not `message`.
    stubTransport(400, { success: false, error: 'Missing required fields: name, owner' })

    render(<CreateTeamPage />)
    fillAndSubmit()

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to create team'))
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /create team/i })).not.toBeDisabled()
  })

  it('has no hardcoded API origin left in the page source', () => {
    const source = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8')
    expect(source).not.toMatch(/localhost/)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})
