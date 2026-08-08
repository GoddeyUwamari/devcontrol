'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import { format } from 'date-fns'

interface DataPoint {
  timestamp: number
  value: number
}

interface ResponseTimeChartProps {
  data: DataPoint[]
  currentValue: number
  trendPercent?: number
}

export function ResponseTimeChart({ data, currentValue, trendPercent = 0 }: ResponseTimeChartProps) {
  const hasAnomaly = trendPercent > 50 // If spike is >50%

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Response Time (p95)
          </h3>
          <p className="text-xs text-gray-500">
            95th percentile latency
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold">
              {currentValue > 0 ? `${currentValue}ms` : '--'}
            </div>
            {trendPercent !== 0 && (
              <div className={`flex items-center gap-1 text-xs ${trendPercent > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {trendPercent > 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>{Math.abs(trendPercent).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-[200px] flex flex-col items-center justify-center text-center border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm font-medium text-gray-500">No response-time data to chart</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">
            This account has no Application Load Balancer — response-time metrics only exist for ALB-fronted traffic.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
              tickFormatter={(val) => `${val}ms`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '12px',
              }}
              formatter={(value) => `${value}ms`}
              labelFormatter={(ts) => format(new Date(ts), 'MMM dd, HH:mm')}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {hasAnomaly && (
        <div className="mt-3 p-2 bg-yellow-50 rounded flex items-center gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <span className="text-yellow-900">
            Latency spike detected (+{trendPercent.toFixed(1)}%)
          </span>
        </div>
      )}
    </div>
  )
}
