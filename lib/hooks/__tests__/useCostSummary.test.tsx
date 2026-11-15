/**
 * DAY1-D10/D11 (day1-step1.md §E): a page left open across 00:00 UTC on the
 * 1st asks for the new month by itself -- the cost summary's key holds the
 * UTC day, which re-renders at midnight UTC -- so November's cached
 * month-to-date figure is never shown as December's, without a reload. And
 * an answer whose month is older than this browser's UTC month is shown as
 * sent (its own period) and refetched once. Synthetic data only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'

const getCostSummary = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary } }))

import { costSummaryKey, msUntilNextUtcMidnight, useCostSummary, utcDayOf } from '../useCostSummary'

function summaryFor(month: string, start: string, endExclusive: string): CostSummary {
  return {
    spend: {
      state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
      period: { kind: 'range', start, endExclusive },
      data: {
        amount: null, basis: 'billed_month_to_date', lastDayInProgress: true,
        monthState: {
          version: 1, state: 'no_billed_days_yet', period: { month, start, endExclusive, calendar: 'UTC' }, amount: null, amountUsable: false,
          costBasis: 'unblended_net_after_credits', lineItems: 0, finishedThrough: '2026-11-29', billedThrough: null, ceEstimated: null, asOf: null, reason: null, previousMonth: null,
        },
      },
    },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
  }
}

function Probe() {
  // The Dashboard's options: long staleTime and no refetch on mount or focus.
  const q = useCostSummary('org-1', { enabled: true, staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000, refetchOnMount: false, refetchOnWindowFocus: false, retry: false })
  return <p data-testid="month">{q.data?.spend.data?.monthState?.period.month ?? 'none'}</p>
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)
  return client
}

afterEach(() => {
  vi.useRealTimers()
  getCostSummary.mockReset()
})

describe('UTC day helpers', () => {
  it('utcDayOf is the UTC calendar date, whatever the browser zone', () => {
    expect(utcDayOf(Date.parse('2026-11-30T23:59:59Z'))).toBe('2026-11-30')
    expect(utcDayOf(Date.parse('2026-12-01T00:00:00Z'))).toBe('2026-12-01')
  })

  it('msUntilNextUtcMidnight', () => {
    expect(msUntilNextUtcMidnight(Date.parse('2026-11-30T23:59:30Z'))).toBe(30_000)
    expect(msUntilNextUtcMidnight(Date.parse('2026-12-01T00:00:00Z'))).toBe(24 * 3600_000)
  })

  it('the key is organization, then UTC day', () => {
    expect(costSummaryKey('org-1', '2026-12-01')).toEqual(['platform-cost-summary', 'org-1', '2026-12-01'])
  })
})

describe('a tab left open across 00:00 UTC on Dec 1', () => {
  it('asks for December by itself; November is never shown as this month after midnight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-30T23:59:30Z'))
    getCostSummary.mockResolvedValueOnce(summaryFor('2026-11', '2026-11-01', '2026-12-01'))
    getCostSummary.mockResolvedValueOnce(summaryFor('2026-12', '2026-12-01', '2026-12-02'))
    const client = renderProbe()
    expect(await screen.findByText('2026-11')).toBeInTheDocument()
    expect(getCostSummary).toHaveBeenCalledTimes(1)

    // Midnight UTC passes with the page still open (no reload, no remount).
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000 + 1_000) })

    expect(await screen.findByText('2026-12')).toBeInTheDocument()
    expect(getCostSummary).toHaveBeenCalledTimes(2)
    expect(client.getQueryCache().findAll({ queryKey: ['platform-cost-summary'] }).map((q) => q.queryKey)).toEqual([
      ['platform-cost-summary', 'org-1', '2026-11-30'],
      ['platform-cost-summary', 'org-1', '2026-12-01'],
    ])
  })
})

describe('an answer from an earlier month than the browser\'s UTC month (DAY1-D11)', () => {
  it('is shown as sent, then refetched once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-12-01T00:05:00Z'))
    getCostSummary.mockResolvedValueOnce(summaryFor('2026-11', '2026-11-01', '2026-12-01'))
    getCostSummary.mockResolvedValue(summaryFor('2026-12', '2026-12-01', '2026-12-02'))
    renderProbe()
    expect(await screen.findByText('2026-12')).toBeInTheDocument()
    expect(getCostSummary).toHaveBeenCalledTimes(2)
  })

  it('a stale answer that stays stale is not refetched in a loop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-12-01T00:05:00Z'))
    getCostSummary.mockResolvedValue(summaryFor('2026-11', '2026-11-01', '2026-12-01'))
    renderProbe()
    expect(await screen.findByText('2026-11')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getCostSummary).toHaveBeenCalledTimes(2)
  })
})
