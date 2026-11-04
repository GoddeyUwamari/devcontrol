/**
 * AI report detail: a cited savings figure the backend marked
 * estimatedSavingsPriceUnknown (the EC2 default for an instance type whose
 * price is unknown) reads "(price unknown)" after the amount -- the approved
 * S2 suffix. An unmarked figure, including a genuine $50 list price, does not.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReportDetail } from '@/lib/services/ai-reports.service'

const getReportDetail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/ai-reports.service', () => ({ aiReportsService: { getReportDetail } }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'report-placeholder-0001' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

import ReportDetailPage from '../[id]/page'

function report(topRecommendations: ReportDetail['topRecommendations']): ReportDetail {
  return {
    id: 'report-placeholder-0001',
    reportType: 'weekly_summary',
    dateRange: { from: '2026-10-26', to: '2026-11-02' },
    summary: 'Summary.',
    executiveSummary: 'Executive summary.',
    keyHighlights: [],
    topRecommendations,
    metadata: { aiModel: 'model', generationTime: 1, wasFallback: false, createdAt: '2026-11-02T00:00:00.000Z', sentTo: null, sentAt: null, deliveryStatus: null },
  }
}

const rec = (title: string, extra: Partial<ReportDetail['topRecommendations'][number]>) =>
  ({ title, impact: 'medium' as const, description: 'x', effort: 'low' as const, ...extra })

describe('AI report detail: default-price savings figures (PR 4, L1)', () => {
  it('a marked $50 default reads "(price unknown)"; a genuine $50 list price and a total do not', async () => {
    getReportDetail.mockResolvedValue(report([
      rec('Default-price instance', { estimatedSavings: 50, estimatedSavingsPriceUnknown: true }),
      rec('Listed instance', { estimatedSavings: 50 }),
      rec('All idle resources', { estimatedSavings: 80 }),
    ]))
    render(<ReportDetailPage />)

    const marked = (await screen.findByText('Default-price instance')).closest('div.border') as HTMLElement
    expect(marked).toHaveTextContent('Est. savings: $50/mo (price unknown)')
    const listed = screen.getByText('Listed instance').closest('div.border') as HTMLElement
    expect(listed.textContent).toMatch(/Est\. savings: \$50\/mo$/)
    const total = screen.getByText('All idle resources').closest('div.border') as HTMLElement
    expect(total.textContent).toMatch(/Est\. savings: \$80\/mo$/)
    expect(screen.getAllByText(/\(price unknown\)/)).toHaveLength(1)
  })

  it('only an explicit true marks the figure', async () => {
    getReportDetail.mockResolvedValue(report([
      rec('Explicit false', { estimatedSavings: 50, estimatedSavingsPriceUnknown: false }),
    ]))
    render(<ReportDetailPage />)
    const row = (await screen.findByText('Explicit false')).closest('div.border') as HTMLElement
    expect(row.textContent).toMatch(/Est\. savings: \$50\/mo$/)
    expect(screen.queryByText(/\(price unknown\)/)).not.toBeInTheDocument()
  })
})
