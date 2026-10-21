/**
 * awsServicesService sends the Services Phase 1 (S1-A) list parameters only
 * when set, and reads GET /api/services/coverage (S1-B). "All teams" is no
 * team: an empty ?team= is a 400 from the API, so it is never sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import awsServicesService from '../aws-services.service'
import api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } }
})

const mockedGet = vi.mocked(api.get)
type GetResult = Awaited<ReturnType<typeof api.get>>

const PAGE = { success: true, services: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_more: false }, counts: { needs_attention: 0, no_flagged_issues: 0 } }

function requestedParams(): URLSearchParams {
  const url = mockedGet.mock.calls.at(-1)![0] as string
  return new URLSearchParams(url.split('?')[1] ?? '')
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedGet.mockResolvedValue({ data: PAGE } as GetResult)
})

describe('getServices Phase 1 params', () => {
  it('sends no team param for "All teams" (team undefined or empty)', async () => {
    await awsServicesService.getServices({ team: undefined })
    expect(requestedParams().has('team')).toBe(false)
    await awsServicesService.getServices({ team: '' })
    expect(requestedParams().has('team')).toBe(false)
    await awsServicesService.getServices({ team: '   ' })
    expect(requestedParams().has('team')).toBe(false)
    expect(mockedGet.mock.calls.every(([url]) => !String(url).includes('team='))).toBe(true)
  })

  it('sends a set team, trimmed', async () => {
    await awsServicesService.getServices({ team: ' Platform ' })
    expect(requestedParams().get('team')).toBe('Platform')
  })

  it('sends the other opt-in params only when set', async () => {
    await awsServicesService.getServices({})
    expect(mockedGet).toHaveBeenLastCalledWith('/api/services')

    await awsServicesService.getServices({ region: 'eu-west-1', ownership: 'unowned', tags_known: true, search: 'x', search_tags: true, sort: 'attention', env: 'untagged' })
    const p = requestedParams()
    expect(p.get('region')).toBe('eu-west-1')
    expect(p.get('ownership')).toBe('unowned')
    expect(p.get('tags_known')).toBe('true')
    expect(p.get('search_tags')).toBe('true')
    expect(p.get('sort')).toBe('attention')
    expect(p.get('env')).toBe('untagged')

    await awsServicesService.getServices({ tags_known: false, search_tags: false })
    expect(requestedParams().get('tags_known')).toBe('false')
    expect(requestedParams().has('search_tags')).toBe(false)
  })
})

describe('getCoverage', () => {
  it('returns the coverage object', async () => {
    const coverage = { account: { connected: false, status: null, home_region: null } }
    mockedGet.mockResolvedValue({ data: { success: true, coverage } } as GetResult)
    await expect(awsServicesService.getCoverage()).resolves.toBe(coverage)
    expect(mockedGet).toHaveBeenLastCalledWith('/api/services/coverage')
  })

  it('throws on an unsuccessful or coverage-less response', async () => {
    mockedGet.mockResolvedValue({ data: { success: false, error: 'boom' } } as GetResult)
    await expect(awsServicesService.getCoverage()).rejects.toThrow('boom')
    mockedGet.mockResolvedValue({ data: { success: true } } as GetResult)
    await expect(awsServicesService.getCoverage()).rejects.toThrow('Failed to load scan coverage')
  })
})
