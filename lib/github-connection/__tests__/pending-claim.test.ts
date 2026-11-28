/**
 * The GitHub hand-off state (D8b-1): this tab only, shape-checked, single use,
 * time-boxed, and gone on logout.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  GITHUB_INSTALL_START_KEY,
  GITHUB_PARKED_CALLBACK_KEY,
  INSTALL_START_MAX_AGE_MS,
  PARKED_CALLBACK_MAX_AGE_MS,
  clearGitHubConnectionState,
  hasParkedCallback,
  parkCallback,
  readInstallStart,
  saveInstallStart,
  saveReconnectStart,
  takeParkedCallback,
} from '../pending-claim'

const STATE = 'S'.repeat(43)
const NOW = 1_800_000_000_000

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('install start', () => {
  it('is kept in sessionStorage only, for 15 minutes', () => {
    saveInstallStart(STATE, 'org-1', NOW)
    expect(localStorage.length).toBe(0)
    expect(readInstallStart(NOW + INSTALL_START_MAX_AGE_MS - 1)).toEqual({ state: STATE, organizationId: 'org-1', startedAt: NOW })
    expect(readInstallStart(NOW + INSTALL_START_MAX_AGE_MS)).toBeNull()
    expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
  })

  it('a malformed state is never stored; a malformed entry is removed when read', () => {
    saveInstallStart('short', 'org-1', NOW)
    expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
    sessionStorage.setItem(GITHUB_INSTALL_START_KEY, '{not json')
    expect(readInstallStart(NOW)).toBeNull()
    expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
  })
})

describe('parked callback', () => {
  it('keeps only values of the shapes the server accepts', () => {
    expect(parkCallback({ code: 'abc_123', installation_id: '42', setup_action: 'install', state: STATE }, NOW)).toBe(true)
    expect(takeParkedCallback(NOW)).toEqual({ code: 'abc_123', installationId: '42', setupAction: 'install', state: STATE, savedAt: NOW })
    expect(parkCallback({ code: 'abc', installation_id: '42', setup_action: 'hack', state: 'x' }, NOW)).toBe(true)
    expect(takeParkedCallback(NOW)).toEqual({ code: 'abc', installationId: '42', savedAt: NOW })
  })

  it('nothing usable (no code + installation, no request) is not parked', () => {
    for (const values of [{}, { code: 'abc' }, { installation_id: '42' }, { code: 'a b', installation_id: '42' }, { code: 'abc', installation_id: '0042' }, { setup_action: 'update' }]) {
      expect(parkCallback(values, NOW)).toBe(false)
      expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
    }
    expect(parkCallback({ setup_action: 'request', state: STATE }, NOW)).toBe(true)
  })

  it('is single use and lives at most 10 minutes', () => {
    parkCallback({ code: 'abc', installation_id: '42' }, NOW)
    expect(hasParkedCallback(NOW)).toBe(true)
    expect(takeParkedCallback(NOW)).not.toBeNull()
    expect(takeParkedCallback(NOW)).toBeNull()
    parkCallback({ code: 'abc', installation_id: '42' }, NOW)
    expect(takeParkedCallback(NOW + PARKED_CALLBACK_MAX_AGE_MS)).toBeNull()
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
  })

  it('logout clears both', () => {
    saveInstallStart(STATE, 'org-1', NOW)
    parkCallback({ code: 'abc', installation_id: '42' }, NOW)
    clearGitHubConnectionState()
    expect(sessionStorage.length).toBe(0)
  })
})

/**
 * I3 reconnect (D1, D3): the reconnect start keeps the installation id and the
 * PKCE verifier for this tab only; GitHub's authorize redirect (code + state,
 * or error) is parked only while this tab has a reconnect start, so the
 * first-install flow parks exactly what it did before.
 */
describe('I3 reconnect start and authorize callback', () => {
  const VERIFIER = 'v'.repeat(43)
  const start = (over: Partial<{ state: string; organizationId: string; installationId: string; codeVerifier: string }> = {}) =>
    saveReconnectStart({ state: STATE, organizationId: 'org-1', installationId: '42', codeVerifier: VERIFIER, ...over }, NOW)

  it('is kept in sessionStorage only, for 15 minutes, with its installation id and verifier', () => {
    expect(start()).toBe(true)
    expect(localStorage.length).toBe(0)
    expect(readInstallStart(NOW + INSTALL_START_MAX_AGE_MS - 1)).toEqual({ state: STATE, organizationId: 'org-1', startedAt: NOW, mode: 'reconnect', installationId: '42', codeVerifier: VERIFIER })
    expect(readInstallStart(NOW + INSTALL_START_MAX_AGE_MS)).toBeNull()
  })

  it('malformed values are never stored; a reconnect entry missing its verifier or installation id is removed when read', () => {
    for (const bad of [{ state: 'short' }, { installationId: '0042' }, { codeVerifier: 'short' }, { codeVerifier: `${'v'.repeat(42)}/` }, { organizationId: '' }]) {
      expect(start(bad)).toBe(false)
      expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
    }
    for (const entry of [
      { state: STATE, organizationId: 'org-1', startedAt: NOW, mode: 'reconnect', installationId: '42' },
      { state: STATE, organizationId: 'org-1', startedAt: NOW, mode: 'reconnect', codeVerifier: VERIFIER },
      { state: STATE, organizationId: 'org-1', startedAt: NOW, mode: 'other', installationId: '42', codeVerifier: VERIFIER },
    ]) {
      sessionStorage.setItem(GITHUB_INSTALL_START_KEY, JSON.stringify(entry))
      expect(readInstallStart(NOW)).toBeNull()
      expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
    }
  })

  it('a reconnect start replaces an install start (one hand-off per tab), and an install start replaces it back', () => {
    saveInstallStart('U'.repeat(43), 'org-1', NOW)
    start()
    expect(readInstallStart(NOW)).toMatchObject({ mode: 'reconnect', state: STATE })
    saveInstallStart('U'.repeat(43), 'org-1', NOW)
    expect(readInstallStart(NOW)).toEqual({ state: 'U'.repeat(43), organizationId: 'org-1', startedAt: NOW })
  })

  it('without a reconnect start, the authorize shapes are not parked (the first-install flow is unchanged)', () => {
    for (const values of [{ code: 'abc', state: STATE }, { error: 'access_denied', state: STATE }, { error: 'access_denied' }]) {
      expect(parkCallback(values, NOW)).toBe(false)
      expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
    }
    saveInstallStart(STATE, 'org-1', NOW)
    expect(parkCallback({ code: 'abc', state: STATE }, NOW)).toBe(false)
  })

  it('with a reconnect start: a code with the state is parked (no installation id); a code alone too (the page then reads "expired")', () => {
    start()
    expect(parkCallback({ code: 'abc_123', state: STATE }, NOW)).toBe(true)
    expect(takeParkedCallback(NOW)).toEqual({ code: 'abc_123', state: STATE, savedAt: NOW })
    expect(parkCallback({ code: 'abc_123' }, NOW)).toBe(true)
    expect(takeParkedCallback(NOW)).toEqual({ code: 'abc_123', savedAt: NOW })
    expect(parkCallback({ state: STATE }, NOW)).toBe(false)
  })

  it('with a reconnect start: an error is parked as one of four values, never with a code, never its description', () => {
    start()
    for (const [given, kept] of [['access_denied', 'access_denied'], ['redirect_uri_mismatch', 'redirect_uri_mismatch'], ['application_suspended', 'application_suspended'],
      ['temporarily_unavailable', 'other'], ['<script>alert(1)</script>', 'other']] as const) {
      expect(parkCallback({ error: given, code: 'abc', state: STATE }, NOW)).toBe(true)
      expect(takeParkedCallback(NOW)).toEqual({ error: kept, state: STATE, savedAt: NOW })
    }
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
    // An error value planted in storage is dropped when read.
    sessionStorage.setItem(GITHUB_PARKED_CALLBACK_KEY, JSON.stringify({ error: 'free text', state: STATE, savedAt: NOW }))
    expect(takeParkedCallback(NOW)).toEqual({ state: STATE, savedAt: NOW })
  })

  it('logout clears the reconnect start and its verifier', () => {
    start()
    parkCallback({ code: 'abc', state: STATE }, NOW)
    clearGitHubConnectionState()
    expect(sessionStorage.length).toBe(0)
  })
})
