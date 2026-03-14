'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Download, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface CostCategory {
  name: string
  value: number
  change: number // percentage change vs last period
  color: string
}

interface CostBreakdownBarListProps {
  data: CostCategory[]
  totalCost: number
  isLoading?: boolean
  dateRange?: '7d' | '30d' | '90d' | '6mo' | '1yr'
  onDateRangeChange?: (range: '7d' | '30d' | '90d' | '6mo' | '1yr') => void
  onExport?: () => void
}

export function CostBreakdownBarList({
  data,
  totalCost,
  isLoading = false,
  dateRange = '90d',
  onDateRangeChange,
  onExport,
}: CostBreakdownBarListProps) {
  const router = useRouter()

  // Helper to extract category slug from name
  const getCategorySlug = (name: string): string => {
    const categoryMap: Record<string, string> = {
      'Compute (EC2, Lambda, ECS)': 'compute',
      'Storage (S3, EBS)': 'storage',
      'Database (RDS, DynamoDB)': 'database',
      'Network (Data Transfer)': 'network',
      'Other Services': 'other',
    }
    return categoryMap[name] || 'all'
  }

  // Handle category click for drill-down
  const handleCategoryClick = (categoryName: string) => {
    const slug = getCategorySlug(categoryName)
    toast.info(`Viewing ${categoryName.split(' (')[0]} details...`)
    router.push(`/app/infrastructure?category=${slug}`)
  }

  // Calculate percentages
  const dataWithPercentage = data.map(item => ({
    name: item.name,
    value: item.value,
    percentage: ((item.value / totalCost) * 100).toFixed(1),
    change: item.change,
    color: item.color,
  }))

  // Format currency
  const valueFormatter = (value: number) =>
    `$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)}`

  const dateRangeOptions = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: '6mo', label: '6 Months' },
    { value: '1yr', label: '1 Year' },
  ]

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="space-y-4 pt-6">
            <div className="h-20 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 bg-gray-200 rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // Max value for bar width scaling
  const maxValue = Math.max(...data.map(d => d.value))

  return (
    <div>
      {/* Date Range Selector */}
      {onDateRangeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#F8FAFC', borderRadius: '8px', padding: '3px', marginBottom: '16px' }}>
          {dateRangeOptions.map((option) => {
            const isActive = dateRange === option.value
            return (
              <button
                key={option.value}
                onClick={() => onDateRangeChange(option.value as '7d' | '30d' | '90d' | '6mo' | '1yr')}
                style={{
                  padding: '4px 12px',
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#0F172A' : '#64748B',
                  background: isActive ? '#F1F5F9' : 'transparent',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  letterSpacing: '-0.01em',
                }}
              >
                {option.label}
              </button>
            )
          })}
          {onExport && (
            <button
              onClick={onExport}
              style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '0.75rem', color: '#64748B', background: 'transparent', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Download size={12} /> Export
            </button>
          )}
        </div>
      )}

      {/* Total Cost */}
      <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Total Monthly Cost
        </div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>
          {valueFormatter(totalCost)}
        </div>
      </div>

      {/* Custom Bar Chart — hex colors applied directly, no Tremor color mapping */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '8px' }}>
        {dataWithPercentage.map((item) => {
          const widthPct = (item.value / maxValue) * 100
          return (
            <div key={item.name}>
              {/* Name + value on same line above the bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 500, color: '#1E293B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color, display: 'inline-block', flexShrink: 0 }} />
                  {item.name}
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A' }}>
                  {valueFormatter(item.value)}
                </span>
              </div>
              {/* Bar */}
              <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: '100%',
                    background: item.color,
                    borderRadius: '4px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Detailed Breakdown with Changes — clickable rows */}
      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {dataWithPercentage.map((item) => (
          <button
            key={item.name}
            onClick={() => handleCategoryClick(item.name)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = '#F8FAFC'
              ;(e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'transparent'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Color dot using the actual hex */}
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: item.color,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#1E293B' }}>
                {item.name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                {valueFormatter(item.value)}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748B', minWidth: '42px', textAlign: 'right' }}>
                {item.percentage}%
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', minWidth: '48px', color: item.change > 0 ? '#DC2626' : '#059669' }}>
                {item.change > 0
                  ? <TrendingUp size={12} />
                  : <TrendingDown size={12} />
                }
                <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                  {Math.abs(item.change)}%
                </span>
              </div>
              <ChevronRight size={14} style={{ color: '#CBD5E1' }} />
            </div>
          </button>
        ))}
      </div>

      {/* Footer Note */}
      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #F1F5F9' }}>
        <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0 }}>
          💡 Click any category to view detailed resource breakdown. Trends show change vs previous period.
        </p>
      </div>
    </div>
  )
}