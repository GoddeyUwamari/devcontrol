/**
 * AWS connect PR D1: `connection.health` on GET /api/aws/accounts and GET /api/aws/accounts/checks,
 * as the frontend reads them. A server from before D1 gives null (nothing new shown), a 409
 * NOT_CONNECTED gives "no checks yet", and only recognized fields are kept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn() },
  handleApiResponse: <T,>(response: { data: { success: boolean; data: T; message?: string } }): T => {
    if (!response.data.success) throw new Error(response.data.message || 'API request failed')
    return response.data.data
  },
}))

import awsAccountsService, { NO_CONNECTION_CHECKS, parseConnectionChecks, parseConnectionHealth } from '../aws-accounts.service'

const AT = '2026-11-11T10:00:00.000Z'
const httpError = (status: number, data: Record<string, unknown>) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } })

describe('parseConnectionHealth', () => {
  it.each(['ok', 'failing', 'lost', 'not_checked_recently', 'not_checked_yet'])('passes %s through', (state) => {
    expect(parseConnectionHealth({ state: 'connected', health: { state, since: AT } })).toEqual({ state, since: AT })
  })

  it('null when absent (a server from before D1) or not recognized', () => {
    expect(parseConnectionHealth({ state: 'connected' })).toBeNull()
    expect(parseConnectionHealth(undefined)).toBeNull()
    expect(parseConnectionHealth({ state: 'connected', health: { state: 'great' } })).toBeNull()
    expect(parseConnectionHealth({ state: 'connected', health: { state: 'ok', since: 'yesterday' } })).toBeNull()
  })
})

describe('parseConnectionChecks', () => {
  const body = {
    health: { state: 'failing', lastResult: 'failing', checkedAt: AT, failingSince: AT, lostAt: null },
    roleReplacedAt: null,
    permissionCheck: { checks: [{ action: 'ce:GetCostAndUsage', status: 'denied', extra: 'x' }, { action: 'bad', status: 'maybe' }], checkedAt: AT, trigger: 'connect' },
    policyCheck: { unreadable: false, securityAudit: 'attached', viewOnlyAccess: 'missing', readExtras: 'differs', readOnlyAccess: false, otherAwsManaged: ['AWSSupportAccess', 7], otherCount: 2, contractVersion: 1, checkedAt: AT, trigger: 'connect', policyDocument: '{}' },
    refusedSources: { scannedAt: AT, sources: [{ source: 'ec2', action: 'ec2:DescribeInstances' }] },
    roleUniqueId: 'AROAEXAMPLEROLEID0001',
  }

  it('keeps only the recognized fields', () => {
    expect(parseConnectionChecks(body)).toEqual({
      health: { state: 'failing', lastResult: 'failing', checkedAt: AT, failingSince: AT },
      roleReplacedAt: null,
      permissionCheck: { checks: [{ action: 'ce:GetCostAndUsage', status: 'denied' }], checkedAt: AT },
      policyCheck: { unreadable: false, securityAudit: 'attached', viewOnlyAccess: 'missing', readExtras: 'differs', readOnlyAccess: false, otherAwsManaged: ['AWSSupportAccess'], otherCount: 2, checkedAt: AT },
      refusedSources: { scannedAt: AT, sources: [{ source: 'ec2', action: 'ec2:DescribeInstances' }] },
    })
  })

  it('checkAgain only when the server sent it (owner)', () => {
    expect(parseConnectionChecks(body)!.checkAgain).toBeUndefined()
    expect(parseConnectionChecks({ ...body, checkAgain: { availableAt: null } })!.checkAgain).toEqual({ availableAt: null })
    expect(parseConnectionChecks({ ...body, checkAgain: { availableAt: AT } })!.checkAgain).toEqual({ availableAt: AT })
  })

  it('null when the health is not recognized, or a state lacks its date', () => {
    expect(parseConnectionChecks({ ...body, health: { state: 'great' } })).toBeNull()
    expect(parseConnectionChecks({ ...body, health: { state: 'ok', lastResult: 'ok', checkedAt: null, failingSince: null } })).toBeNull()
    expect(parseConnectionChecks({ ...body, health: { state: 'lost', lastResult: 'lost', checkedAt: AT, failingSince: null } })).toBeNull()
    expect(parseConnectionChecks({ ...body, health: { state: 'not_checked_recently', lastResult: null, checkedAt: AT, failingSince: null } })).toBeNull()
    expect(parseConnectionChecks(null)).toBeNull()
  })
})

describe('getConnectionChecks', () => {
  // Braces: a function returned from beforeEach is run as a teardown.
  beforeEach(() => { mockGet.mockReset() })

  it('409 NOT_CONNECTED: no checks yet', async () => {
    mockGet.mockRejectedValue(httpError(409, { code: 'NOT_CONNECTED' }))
    await expect(awsAccountsService.getConnectionChecks()).resolves.toEqual(NO_CONNECTION_CHECKS)
    expect(NO_CONNECTION_CHECKS.health.state).toBe('not_checked_yet')
    expect(NO_CONNECTION_CHECKS.checkAgain).toBeUndefined()
  })

  it('404 (a server without the endpoint): null', async () => {
    mockGet.mockRejectedValue(httpError(404, {}))
    await expect(awsAccountsService.getConnectionChecks()).resolves.toBeNull()
  })

  it.each([
    [httpError(409, { code: 'AWS_ACCOUNT_AMBIGUOUS' })],
    [httpError(500, {})],
    [new Error('Network Error')],
  ])('anything else throws (%#)', async (err) => {
    mockGet.mockRejectedValue(err)
    await expect(awsAccountsService.getConnectionChecks()).rejects.toBe(err)
  })

  it('GET /accounts carries connection.health', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [], connection: { state: 'connected', health: { state: 'lost', since: AT } } } })
    await expect(awsAccountsService.getAccountsAndConnection()).resolves.toEqual({ accounts: [], connection: 'connected', health: { state: 'lost', since: AT } })
  })
})
