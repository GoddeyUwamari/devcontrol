'use client'

import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TimeRange {
  label: string
  value: string
}

interface TimeRangeSelectorProps {
  selected: string
  onChange: (value: string) => void
  onRefresh?: () => void
}

export function TimeRangeSelector({ selected, onChange, onRefresh }: TimeRangeSelectorProps) {
  const ranges: TimeRange[] = [
    { label: 'Last 5m', value: '5m' },
    { label: 'Last 15m', value: '15m' },
    { label: 'Last 1h', value: '1h' },
    { label: 'Last 3h', value: '3h' },
    { label: 'Last 24h', value: '24h' },
    { label: 'Last 7d', value: '7d' },
  ]

  return (
    <div className="flex items-center gap-2 bg-white border rounded-lg p-1">
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={cn(
            "px-3 py-1.5 text-sm rounded transition-colors",
            selected === range.value
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          )}
        >
          {range.label}
        </button>
      ))}

      {onRefresh && (
        <button
          onClick={onRefresh}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors ml-2"
          title="Refresh metrics"
          aria-label="Refresh metrics"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
