import { MoreHorizontal } from 'lucide-react'
import { CostTrendChart } from './cost-trend-chart'
import { CostBreakdownBarList } from './cost-breakdown-barlist'

type DateRange = '7d' | '30d' | '90d' | '6mo' | '1yr'

interface CostTrendsCardProps {
  isDemoActive: boolean
  hasBillingData: boolean
  costTrend: Array<{ date: string; compute: number; storage: number; database: number; network: number; other: number; total: number }>
  costTrendLoading: boolean
  demoBreakdownData: Array<{ name: string; value: number; change: number; color: string }>
  demoTotalCost: number
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  onExport: () => void
}

/**
 * Thin composition wrapper around the existing CostTrendChart (real data,
 * renders its own header) and CostBreakdownBarList (demo data, headless) —
 * no new chart implementation. Falls back to a truthful "syncing" state
 * when AWS is connected but billing hasn't synced yet.
 */
export function CostTrendsCard({
  isDemoActive,
  hasBillingData,
  costTrend,
  costTrendLoading,
  demoBreakdownData,
  demoTotalCost,
  dateRange,
  onDateRangeChange,
  onExport,
}: CostTrendsCardProps) {
  if (isDemoActive) {
    return (
      <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
        <div className="flex items-start justify-between mb-5">
          <h3 className="text-sm font-semibold text-foreground">AWS Cost Trends</h3>
          <a href="/costs" className="text-[var(--text-secondary)]"><MoreHorizontal size={16} /></a>
        </div>
        <CostBreakdownBarList
          data={demoBreakdownData}
          totalCost={demoTotalCost}
          isLoading={false}
          dateRange={dateRange}
          onDateRangeChange={onDateRangeChange}
          onExport={onExport}
        />
      </div>
    )
  }

  if (hasBillingData) {
    // CostTrendChart renders its own Card + "AWS Cost Trends" title/period
    // control — no outer wrapper here to avoid double-nesting cards.
    return (
      <CostTrendChart
        data={costTrend}
        isLoading={costTrendLoading}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onExport={onExport}
      />
    )
  }

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full flex flex-col items-center justify-center text-center py-12 gap-3">
      <h3 className="sr-only">AWS Cost Trends</h3>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--surface-1)]">
        <span className="text-lg text-[var(--text-secondary)]">$</span>
      </div>
      <p className="text-sm font-semibold text-foreground">Cost data syncing</p>
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-[240px]">
        Billing data is available within 24–48h of connecting your AWS account
      </p>
    </div>
  )
}
