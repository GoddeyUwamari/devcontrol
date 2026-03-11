'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface CostDataPoint {
  date: string;
  compute: number;
  storage: number;
  database: number;
  network: number;
  other: number;
  total: number;
  forecast?: boolean;
}

interface CostTrendChartProps {
  data: CostDataPoint[];
  isLoading?: boolean;
  dateRange?: '7d' | '30d' | '90d' | '6mo' | '1yr';
  onDateRangeChange?: (range: '7d' | '30d' | '90d' | '6mo' | '1yr') => void;
  onExport?: () => void;
}

export function CostTrendChart({
  data,
  isLoading,
  dateRange = '90d',
  onDateRangeChange,
  onExport,
}: CostTrendChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-48 mt-2" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      if (dateRange === '7d') return format(date, 'EEE');
      if (dateRange === '30d' || dateRange === '90d') return format(date, 'MMM d');
      return format(date, 'MMM yyyy');
    } catch {
      return dateStr;
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const isForecast = payload[0]?.payload?.forecast;
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4">
          <p className="text-sm font-semibold text-gray-900 mb-2">
            {formatDate(label)}
            {isForecast && <span className="text-xs text-gray-500 ml-2">(Forecast)</span>}
          </p>
          <div className="space-y-1.5">
            {payload
              .filter((entry: any) => !hiddenSeries.has(entry.dataKey))
              .map((entry: any) => (
                <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="capitalize text-gray-600">{entry.name}:</span>
                  </div>
                  <span className="font-semibold text-gray-900">
                    ${entry.value.toFixed(2)}
                  </span>
                </div>
              ))}
          </div>
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">Total:</span>
              <span className="font-bold text-gray-900">
                ${payload.reduce((sum: number, entry: any) => sum + (hiddenSeries.has(entry.dataKey) ? 0 : entry.value), 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const toggleSeries = (dataKey: string) => {
    const newHidden = new Set(hiddenSeries);
    if (newHidden.has(dataKey)) {
      newHidden.delete(dataKey);
    } else {
      newHidden.add(dataKey);
    }
    setHiddenSeries(newHidden);
  };

  const dateRangeOptions = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: '6mo', label: '6 Months' },
    { value: '1yr', label: '1 Year' },
  ];

  const series = [
    { key: 'compute', name: 'Compute', color: '#3b82f6' },
    { key: 'storage', name: 'Storage', color: '#10b981' },
    { key: 'database', name: 'Database', color: '#8b5cf6' },
    { key: 'network', name: 'Network', color: '#f59e0b' },
    { key: 'other', name: 'Other', color: '#6b7280' },
  ];

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>AWS Cost Trends</CardTitle>
            <CardDescription>Daily cost breakdown by service category over time</CardDescription>
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
        {/* Legend with Toggle */}
        <div className="flex items-center justify-center gap-4 mb-4 flex-wrap">
          {series.map((s) => (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                hiddenSeries.has(s.key)
                  ? 'opacity-40 hover:opacity-60'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.name}</span>
            </button>
          ))}
        </div>

        {/* Chart */}
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              tickFormatter={formatCurrency}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Forecast separator line */}
            {data.some(d => d.forecast) && (
              <ReferenceLine
                x={data.find(d => d.forecast)?.date}
                stroke="#9ca3af"
                strokeDasharray="5 5"
                label={{ value: 'Forecast', position: 'top', fill: '#6b7280', fontSize: 12 }}
              />
            )}

            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="1"
                stroke={s.color}
                fill={`url(#gradient-${s.key})`}
                fillOpacity={1}
                strokeWidth={2}
                hide={hiddenSeries.has(s.key)}
                strokeDasharray={data.some(d => d.forecast) ? "5 5" : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>

        {/* Anomaly Indicators */}
        {data.some(d => d.total > (data.reduce((sum, d) => sum + d.total, 0) / data.length) * 1.5) && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm text-orange-800">
              <span className="font-semibold">⚠️ Cost Spike Detected:</span> Unusual spending pattern identified. Review details above.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
