'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BarList } from '@tremor/react'
import { TrendingUp, TrendingDown, Download, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface CostCategory {
  name: string
  value: number
  change: number // percentage change vs last period
  color: 'blue' | 'teal' | 'purple' | 'amber' | 'gray'
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
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-6 bg-gray-200 rounded animate-pulse w-48" />
              <div className="h-4 bg-gray-200 rounded animate-pulse w-64" />
            </div>
            <div className="h-9 bg-gray-200 rounded animate-pulse w-32" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
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

  return (
    <Card className="transition-shadow hover:shadow-md">
      {/* Header */}
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>AWS Cost Breakdown</CardTitle>
            <CardDescription>Current spending distribution by service category</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Date Range Selector */}
            {onDateRangeChange && (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {dateRangeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={dateRange === option.value ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => onDateRangeChange(option.value as any)}
                    className={`h-7 px-3 text-xs ${
                      dateRange === option.value
                        ? 'bg-white shadow-sm'
                        : 'hover:bg-white/50'
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
            {/* Export Button */}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Total Cost Highlight */}
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/20">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Total Monthly Cost
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {valueFormatter(totalCost)}
          </div>
        </div>

        {/* BarList - Custom styling for thinner bars */}
        <div className="mt-4 [&_.tremor-BarList-bar]:h-8 [&_.tremor-BarList-bar]:transition-all [&_.tremor-BarList-bar]:duration-200">
          <BarList
            data={dataWithPercentage.map(item => ({
              name: item.name,
              value: item.value,
              color: item.color,
            }))}
            valueFormatter={valueFormatter}
          />
        </div>

        {/* Detailed Breakdown with Changes - Clickable with enhanced hover */}
        <div className="mt-6 space-y-2">
          {dataWithPercentage.map((item) => (
            <button
              key={item.name}
              onClick={() => handleCategoryClick(item.name)}
              className="w-full flex items-center justify-between text-sm py-3 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:shadow-md transition-all duration-200 cursor-pointer group border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full group-hover:scale-110 transition-transform duration-200"
                  style={{
                    backgroundColor:
                      item.color === 'blue' ? '#3b82f6' :
                      item.color === 'teal' ? '#14b8a6' :
                      item.color === 'purple' ? '#a855f7' :
                      item.color === 'amber' ? '#f59e0b' :
                      '#6b7280'
                  }}
                  aria-hidden="true"
                />
                <span className="text-gray-700 dark:text-gray-300 font-medium group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                  {item.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {valueFormatter(item.value)}
                </span>
                <span className="text-gray-500 dark:text-gray-400 min-w-[45px] text-right">
                  {item.percentage}%
                </span>
                <div className={`flex items-center gap-1 min-w-[60px] ${
                  item.change > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-green-600 dark:text-green-400'
                }`}>
                  {item.change > 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span className="text-xs font-medium">
                    {Math.abs(item.change)}%
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              </div>
            </button>
          ))}
        </div>

        {/* Footer Note */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            💡 Click any category to view detailed resource breakdown. Trends show change vs previous period.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
