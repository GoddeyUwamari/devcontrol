import { describe, it, expect } from 'vitest'
import { computeAwsConnectionState } from '../dashboardAwsConnection'

const ZERO = { monthlyAwsCost: 0, activeDeployments: 0, totalServices: 0 }
const base = { isDemoActive: false, awsAccounts: undefined as unknown[] | undefined, awsAccountsFailed: false, statsLoading: false, stats: ZERO }

describe('computeAwsConnectionState', () => {
  it('connected: the accounts request returned at least one account', () => {
    expect(computeAwsConnectionState({ ...base, awsAccounts: [{ id: 'a' }] })).toBe('connected')
    // Even while the stats are still loading, or failed.
    expect(computeAwsConnectionState({ ...base, awsAccounts: [{ id: 'a' }], statsLoading: true, stats: undefined })).toBe('connected')
  })

  it('unconnected: the accounts request succeeded with none, and the stats show nothing', () => {
    expect(computeAwsConnectionState({ ...base, awsAccounts: [] })).toBe('unconnected')
    // The stats request failing does not change what the accounts request established.
    expect(computeAwsConnectionState({ ...base, awsAccounts: [], stats: undefined })).toBe('unconnected')
  })

  it('unknown: the accounts request failed -- never read as unconnected', () => {
    expect(computeAwsConnectionState({ ...base, awsAccountsFailed: true })).toBe('unknown')
    expect(computeAwsConnectionState({ ...base, awsAccountsFailed: true, stats: undefined })).toBe('unknown')
  })

  it('loading: until both the accounts and the stats have settled', () => {
    expect(computeAwsConnectionState({ ...base })).toBe('loading')
    expect(computeAwsConnectionState({ ...base, awsAccounts: [], statsLoading: true, stats: undefined })).toBe('loading')
    expect(computeAwsConnectionState({ ...base, awsAccountsFailed: true, statsLoading: true, stats: undefined })).toBe('loading')
  })

  it.each([
    ['monthlyAwsCost', { ...ZERO, monthlyAwsCost: 1 }],
    ['activeDeployments', { ...ZERO, activeDeployments: 1 }],
    ['totalServices', { ...ZERO, totalServices: 1 }],
  ])('the legacy stats fallback (%s > 0) still means connected, whatever the accounts request said', (_name, stats) => {
    expect(computeAwsConnectionState({ ...base, awsAccounts: [], stats })).toBe('connected')
    expect(computeAwsConnectionState({ ...base, awsAccountsFailed: true, stats })).toBe('connected')
    expect(computeAwsConnectionState({ ...base, stats })).toBe('connected')
  })

  it('demo mode is always connected', () => {
    expect(computeAwsConnectionState({ ...base, isDemoActive: true, awsAccountsFailed: true })).toBe('connected')
  })
})
