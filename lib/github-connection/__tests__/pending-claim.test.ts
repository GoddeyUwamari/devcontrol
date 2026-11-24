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
