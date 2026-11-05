/**
 * The dashboard's "is AWS connected" (AWS connect PR B): only the server's
 * connection state decides it (GET /api/aws/accounts `connection`), never
 * the legacy stats (cost, deployments, services) or how many rows exist.
 */
import { describe, it, expect } from 'vitest'
import { computeAwsConnectionState } from '../dashboardAwsConnection'

const base = { isDemoActive: false, connection: undefined, connectionFailed: false } as const

describe('computeAwsConnectionState', () => {
  it('connected: the server reports one active connection', () => {
    expect(computeAwsConnectionState({ ...base, connection: 'connected' })).toBe('connected')
    // A failed background refetch keeps the last successful answer.
    expect(computeAwsConnectionState({ ...base, connection: 'connected', connectionFailed: true })).toBe('connected')
  })

  it('unconnected: the server reports none (no row, or only rows that are not active)', () => {
    expect(computeAwsConnectionState({ ...base, connection: 'not_connected' })).toBe('unconnected')
  })

  it('unknown: the request failed, or more than one active connection -- never read as unconnected', () => {
    expect(computeAwsConnectionState({ ...base, connectionFailed: true })).toBe('unknown')
    expect(computeAwsConnectionState({ ...base, connection: 'ambiguous' })).toBe('unknown')
  })

  it('loading: until the accounts request has settled', () => {
    expect(computeAwsConnectionState({ ...base })).toBe('loading')
  })

  it('demo mode is always connected', () => {
    expect(computeAwsConnectionState({ ...base, isDemoActive: true, connectionFailed: true })).toBe('connected')
  })

  it('takes no stats and no row list: historical AWS-derived data cannot make it connected', () => {
    // The function's whole input is the connection state; the old stats fallback is gone.
    const source = computeAwsConnectionState.toString()
    expect(source).not.toMatch(/monthlyAwsCost|activeDeployments|totalServices|length/)
  })
})
