/**
 * PR B1 (frontend exception): the Dashboard cost trend's money figures read
 * the backend's netTotal -- the day's real net, the unclamped Σ byService --
 * never `total` (floored categories) or the floored byServiceDisplay segments:
 *   - the finished-day tooltip Total;
 *   - the "Still updating · $X so far" and "Today · $X so far" tooltips;
 *   - the spike warning's average (threshold logic unchanged).
 * The bars stay the floored segments. A point without netTotal (an older
 * backend) shows "—", never the clamped figure, and gives no spike warning.
 * Recharts runs for real: ResponsiveContainer gets a size, the Tooltip opens
 * on a chosen point (`active` + `defaultIndex`), bars are not animated.
 */
import { cloneElement, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: -1 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children, onResize }: { children: React.ReactElement<{ width?: number; height?: number }>; onResize?: (w: number, h: number) => void }) => {
      useEffect(() => { onResize?.(600, 300) }, [onResize])
      return cloneElement(children, { width: 600, height: 300 })
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      open.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={open.index} /> : <actual.Tooltip {...props} />,
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
  }
})

import { CostTrendChart } from '../cost-trend-chart'

const NOW = new Date('2026-11-18T15:00:00.000Z') // today = Nov 18 (UTC)
const DAYS = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']

type Day = { ec2: number; s3: number; reportState?: 'final' | 'updating'; net?: number | null }

/** A backend point: total and byServiceDisplay floored at $0 per segment, netTotal the real net. */
function point(date: string, { ec2, s3, reportState = 'final', net }: Day) {
  const total = Math.max(0, ec2) + Math.max(0, s3)
  return {
    date, compute: Math.max(0, ec2), storage: Math.max(0, s3), database: 0, network: 0, other: 0, total,
    ...(net === undefined ? { netTotal: ec2 + s3 } : net === null ? {} : { netTotal: net }),
    byServiceDisplay: [
      { service: 'EC2', amount: Math.max(0, ec2), color: '#2a78d6' },
      { service: 'S3', amount: Math.max(0, s3), color: '#1f9e89' },
    ],
    lineItems: 2, reportState, provisional: reportState !== 'final',
  }
}

const show = (data: unknown[], index = -1, dateRange: '7d' | '30d' | '90d' = '7d') => {
  open.index = index
  return render(<CostTrendChart data={data as never} dateRange={dateRange} onDateRangeChange={() => {}} now={NOW} />)
}
const text = () => document.body.textContent ?? ''

beforeEach(() => { open.index = -1 })

describe('finished-day tooltip Total is the real net', () => {
  // Nov 12: +$10 EC2 and a -$5 S3 credit. The bars draw $10 + $0; the day's net is $5.
  const mixed = DAYS.map((d) => point(d, d === '2026-11-12' ? { ec2: 10, s3: -5 } : { ec2: 2, s3: 1 }))

  it.each(['7d', '30d', '90d'] as const)('%s: a mixed day shows "Total: $5.00", not the summed segments ($10.00)', async (range) => {
    show(mixed, 0, range)
    await waitFor(() => expect(text()).toMatch(/Total:\$5\.00/))
    expect(text()).not.toMatch(/Total:\$10\.00/)
    // The segments are still the floored ones.
    expect(text()).toMatch(/EC2:\$10\.00/)
    expect(text()).toMatch(/S3:\$0\.00/)
  })

  it('a net-negative day shows its real negative net ("Total: -$1.20"), never $0', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-12' ? { ec2: 1, s3: -2.2 } : { ec2: 2, s3: 1 })), 0)
    await waitFor(() => expect(text()).toMatch(/Total:-\$1\.20/))
    expect(text()).not.toMatch(/Total:\$0\.00/)
    expect(text()).not.toMatch(/Total:\$1\.00/)
  })

  it('positive-only data shows the same Total as before ($3.00)', async () => {
    show(DAYS.map((d) => point(d, { ec2: 2, s3: 1 })), 1)
    await waitFor(() => expect(text()).toMatch(/Total:\$3\.00/))
  })

  it('no netTotal (an older backend): "Total: —", never the clamped figure', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-12' ? { ec2: 10, s3: -5, net: null } : { ec2: 2, s3: 1 })), 0)
    await waitFor(() => expect(text()).toMatch(/Total:—/))
    expect(text()).not.toMatch(/Total:\$10\.00/)
  })
})

describe('"so far" tooltips are the real net', () => {
  it('still updating: "Still updating · $5.00 so far." from netTotal, not the floored $10.00', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-16' ? { ec2: 10, s3: -5, reportState: 'updating' } : { ec2: 2, s3: 1 })), 4)
    expect(await screen.findByText('Still updating · $5.00 so far. AWS Cost Explorer may still add charges.')).toBeInTheDocument()
  })

  it('today: "Today · $5.00 so far · still updating" from netTotal', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-18' ? { ec2: 10, s3: -5, reportState: 'updating' } : { ec2: 2, s3: 1 })), 6)
    expect((await screen.findByTestId('cost-trend-today-tooltip')).textContent).toBe('Today · $5.00 so far · still updating')
  })

  it('today with a net-negative amount so far: "Today · -$0.40 so far · still updating"', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-18' ? { ec2: 0.6, s3: -1, reportState: 'updating' } : { ec2: 2, s3: 1 })), 6)
    expect((await screen.findByTestId('cost-trend-today-tooltip')).textContent).toBe('Today · -$0.40 so far · still updating')
  })

  it('no netTotal: "— so far", never the clamped total', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-16' ? { ec2: 10, s3: -5, reportState: 'updating', net: null } : { ec2: 2, s3: 1 })), 4)
    expect(await screen.findByText('Still updating · — so far. AWS Cost Explorer may still add charges.')).toBeInTheDocument()
  })
})

describe('the spike warning averages the real nets (threshold unchanged)', () => {
  const SPIKE = /May cause unexpected AWS bill increase/

  it('positive-only: six $10 days then $100 is a spike, as before', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-17' ? { ec2: 100, s3: 0 } : { ec2: 10, s3: 0 })))
    expect(await screen.findByText(SPIKE)).toBeInTheDocument()
  })

  it('credits hide a spike from the floored totals but not from the nets: warned', async () => {
    // Floored totals: five $50 days and $60 (avg $51.67, no spike). Nets: five $10 days and $60
    // (avg $18.33; $60 > 1.5 x avg and $41.67 above it): a spike.
    show(DAYS.map((d) => point(d, d === '2026-11-17' ? { ec2: 60, s3: 0 } : d === '2026-11-18' ? { ec2: 1, s3: 0, reportState: 'updating' } : { ec2: 50, s3: -40 })))
    expect(await screen.findByText(SPIKE)).toBeInTheDocument()
  })

  it('a floored-total spike that a credit cancels is not warned', async () => {
    // Floored: five $10 days and $100. Net: that day is $100 - $88 = $12, no spike.
    show(DAYS.map((d) => point(d, d === '2026-11-17' ? { ec2: 100, s3: -88 } : d === '2026-11-18' ? { ec2: 1, s3: 0, reportState: 'updating' } : { ec2: 10, s3: 0 })))
    await screen.findByText('Today')
    expect(screen.queryByText(SPIKE)).toBeNull()
  })

  it('a reported day without netTotal: no spike warning rather than one from clamped amounts', async () => {
    show(DAYS.map((d) => point(d, d === '2026-11-17' ? { ec2: 100, s3: 0 } : d === '2026-11-13' ? { ec2: 10, s3: 0, net: null } : { ec2: 10, s3: 0 })))
    await screen.findByText('Today')
    expect(screen.queryByText(SPIKE)).toBeNull()
  })
})
