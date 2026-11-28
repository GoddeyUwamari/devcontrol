/**
 * /auth/github/callback (D8b-1, Q1, F4). GitHub returns `code`, `installation_id`,
 * `setup_action` and `state` in the query. Before anything else the page takes
 * them out of the address bar and the history entry, parks them for this tab,
 * and goes to the GitHub page on a clean URL. Signed out: "Sign in to finish",
 * whose link returns to the GitHub page only: no callback value ever reaches
 * /login?from=, the URL or history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import GitHubCallbackPage from '../page'
import { GITHUB_PARKED_CALLBACK_KEY, saveReconnectStart, takeParkedCallback } from '@/lib/github-connection/pending-claim'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

let auth = { isAuthenticated: true, isLoading: false }
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth }))

const CODE = 'plantedGitHubOAuthCode0123456789'
const STATE = 'P'.repeat(43)
const INSTALLATION = '87654321'

function visit(path: string) {
  window.history.replaceState({ __NA: true, tree: ['', { children: [`__PAGE__?${JSON.stringify({ code: CODE, state: STATE })}`, {}] }] }, '', path)
}

function expectNothingLeftBehind() {
  const everywhere = [window.location.href, JSON.stringify(window.history.state ?? null), document.body.innerHTML]
  for (const where of everywhere) {
    expect(where).not.toContain(CODE)
    expect(where).not.toContain(STATE)
    expect(where).not.toContain(`installation_id=${INSTALLATION}`)
  }
}

const callbackUrl = (params: Record<string, string>) => `/auth/github/callback?${new URLSearchParams(params).toString()}`

beforeEach(() => {
  sessionStorage.clear()
  replace.mockReset()
  auth = { isAuthenticated: true, isLoading: false }
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('GitHub callback', () => {
  it('signed in: the values leave the URL and history, are parked for this tab, and the GitHub page opens on a clean URL', async () => {
    visit(callbackUrl({ code: CODE, installation_id: INSTALLATION, setup_action: 'install', state: STATE }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/integrations/github'))
    expect(window.location.pathname).toBe('/auth/github/callback')
    expect(window.location.search).toBe('')
    await new Promise((r) => setTimeout(r, 5))
    expectNothingLeftBehind()
    expect(replace.mock.calls.flat().join(' ')).not.toContain(CODE)
    expect(localStorage.length).toBe(0)
    expect(takeParkedCallback()).toMatchObject({ code: CODE, installationId: INSTALLATION, setupAction: 'install', state: STATE })
  })

  it('signed out during GitHub: "Sign in to finish connecting GitHub"; the sign-in link returns to the GitHub page and carries no callback value', async () => {
    auth = { isAuthenticated: false, isLoading: false }
    visit(callbackUrl({ code: CODE, installation_id: INSTALLATION, setup_action: 'install', state: STATE }))
    render(<GitHubCallbackPage />)
    expect(await screen.findByText('Sign in to finish connecting GitHub')).toBeInTheDocument()
    expect(screen.getByText("Your DevControl session ended while you were on GitHub. Sign in and we'll finish the connection.")).toBeInTheDocument()
    const link = screen.getByTestId('github-callback-sign-in-link')
    expect(link.getAttribute('href')).toBe('/login?from=%2Fsettings%2Fintegrations%2Fgithub')
    expect(replace).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 5))
    expectNothingLeftBehind()
    // Parked for after sign-in, in this tab only.
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toContain(CODE)
    expect(localStorage.length).toBe(0)
  })

  it('while the session is still loading: the finishing card only, no navigation yet', async () => {
    auth = { isAuthenticated: false, isLoading: true }
    visit(callbackUrl({ code: CODE, installation_id: INSTALLATION, state: STATE }))
    render(<GitHubCallbackPage />)
    expect(screen.getByText('Finishing your GitHub connection…')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 5))
    expect(replace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('github-callback-sign-in')).toBeNull()
    expectNothingLeftBehind()
  })

  it('malformed values are cleaned from the URL but never parked', async () => {
    visit(callbackUrl({ code: 'has spaces<script>', installation_id: '0042', setup_action: 'hack', state: 'short' }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/integrations/github'))
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
  })

  it('setup_action=request with no code is parked (approval requested)', async () => {
    visit(callbackUrl({ setup_action: 'request', state: STATE }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(takeParkedCallback()).toMatchObject({ setupAction: 'request', state: STATE })
  })

  // I3 reconnect: GitHub's authorize redirect.
  const reconnecting = () => saveReconnectStart({ state: STATE, organizationId: 'org-1', installationId: INSTALLATION, codeVerifier: 'v'.repeat(43) })

  it('reconnect: code + state (no installation id) are taken out of the URL and history and parked, in a tab that started a reconnect', async () => {
    reconnecting()
    visit(callbackUrl({ code: CODE, state: STATE }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/integrations/github'))
    await new Promise((r) => setTimeout(r, 5))
    expectNothingLeftBehind()
    expect(takeParkedCallback()).toEqual({ code: CODE, state: STATE, savedAt: expect.any(Number) })
  })

  it('reconnect: an error is parked as its fixed value only; error_description and error_uri leave the URL and are never stored or shown', async () => {
    reconnecting()
    const description = 'The user has denied your application access <planted-free-text>'
    visit(callbackUrl({ error: 'access_denied', error_description: description, error_uri: 'https://docs.github.com/planted', state: STATE }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/integrations/github'))
    await new Promise((r) => setTimeout(r, 5))
    expect(window.location.search).toBe('')
    for (const where of [window.location.href, JSON.stringify(window.history.state ?? null), document.body.innerHTML, JSON.stringify({ ...sessionStorage })]) {
      expect(where).not.toContain('planted')
    }
    expect(takeParkedCallback()).toEqual({ error: 'access_denied', state: STATE, savedAt: expect.any(Number) })
  })

  it('without a reconnect start, an authorize-shaped callback is cleaned from the URL but not parked (first-install flow unchanged)', async () => {
    visit(callbackUrl({ code: CODE, state: STATE }))
    render(<GitHubCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
  })
})
