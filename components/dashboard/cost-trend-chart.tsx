'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface CostServiceAmount {
  service: string;
  amount: number;
  color: string;
}

interface CostDataPoint {
  date: string;
  compute: number;
  storage: number;
  database: number;
  network: number;
  other: number;
  total: number;
  forecast?: boolean;
  // Top-N-by-spend services + "Other", with normalized names and stable colors
  // (see backend aws-cost.service.ts attachServiceDisplayBreakdown). Optional so
  // cached/rolling-deploy responses written before this field existed still render
  // via the category fallback below instead of breaking.
  byServiceDisplay?: CostServiceAmount[];
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

  const categorySeries = [
    { key: 'compute', name: 'Compute', color: '#3b82f6' },
    { key: 'storage', name: 'Storage', color: '#10b981' },
    { key: 'database', name: 'Database', color: '#8b5cf6' },
    { key: 'network', name: 'Network', color: '#f59e0b' },
    { key: 'other', name: 'Other', color: '#6b7280' },
  ];

  // Per-service breakdown (byServiceDisplay) takes priority when present; falls back
  // to the fixed 5-category view for cache entries / rolling-deploy responses written
  // before that field existed.
  const hasServiceBreakdown = data.some((d) => d.byServiceDisplay && d.byServiceDisplay.length > 0);

  // Stable service order + color, built from first-seen order across all points —
  // the backend already guarantees a consistent top-N+Other set across the whole
  // range, so this just preserves that order rather than re-deriving it.
  const serviceSeries: { key: string; name: string; color: string }[] = [];
  if (hasServiceBreakdown) {
    const seen = new Set<string>();
    for (const point of data) {
      for (const item of point.byServiceDisplay || []) {
        if (!seen.has(item.service)) {
          seen.add(item.service);
          serviceSeries.push({ key: item.service, name: item.service, color: item.color });
        }
      }
    }
  }

  const series = hasServiceBreakdown ? serviceSeries : categorySeries;

  // Recharts needs flat { date, [seriesKey]: amount } rows; byServiceDisplay arrives
  // as a per-point array, so reshape it into that flat form for the stacked bar chart.
  const chartData = hasServiceBreakdown
    ? data.map((point) => {
        const row: Record<string, string | number | boolean | undefined> = {
          date: point.date,
          forecast: point.forecast,
          total: point.total,
        };
        for (const s of serviceSeries) row[s.key] = 0;
        for (const item of point.byServiceDisplay || []) {
          row[item.service] = item.amount;
        }
        return row;
      })
    : data;

  // A "spike" must be both proportionally large (1.5x the average day) AND a
  // meaningful dollar amount above average — otherwise cent-level noise on a
  // near-zero-spend account trips the banner.
  const SPIKE_RATIO = 1.5;
  const MIN_SPIKE_DELTA = 20; // dollars above average required to flag
  const avgTotal = data.length > 0 ? data.reduce((sum, d) => sum + d.total, 0) / data.length : 0;
  const hasSpike = data.some(d => d.total > avgTotal * SPIKE_RATIO && d.total - avgTotal > MIN_SPIKE_DELTA);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
          <div>
            <CardTitle>AWS Cost Trends</CardTitle>
            <CardDescription>
              {hasServiceBreakdown
                ? 'Daily cost breakdown by service over time'
                : 'Daily cost breakdown by service category over time'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            {/* Date Range Selector */}
            {onDateRangeChange && (
              <div
                className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto min-w-0 flex-1 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {dateRangeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant="ghost"
                    size="sm"
                    onClick={() => onDateRangeChange(option.value as any)}
                    className={`h-7 px-3 text-xs shrink-0 ${
                      dateRange === option.value
                        ? 'bg-white text-gray-900 shadow-sm hover:bg-white'
                        : 'text-gray-500 hover:bg-white/50'
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
            {/* Export Button */}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="shrink-0">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Legend with Toggle */}
        <div className="flex items-center justify-center gap-1 sm:gap-4 mb-4 flex-wrap">
          {series.map((s) => (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className={`flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                hiddenSeries.has(s.key)
                  ? 'opacity-40 hover:opacity-60'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div
                className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.name}</span>
            </button>
          ))}
        </div>

        {/* Chart */}
        <ResponsiveContainer width="100%" height={300}>
          {hasServiceBreakdown ? (
            <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <YAxis
                domain={[0, 'auto']}
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

              {serviceSeries.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stackId="services"
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                  hide={hiddenSeries.has(s.key)}
                />
              ))}
            </BarChart>
          ) : (
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
                domain={[0, 'auto']}
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
          )}
        </ResponsiveContainer>

        {/* Anomaly Indicators */}
        {hasSpike && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm text-orange-800">
              <span className="font-semibold">⚠️ May cause unexpected AWS bill increase</span> — unusual spending pattern identified. Review details above.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
