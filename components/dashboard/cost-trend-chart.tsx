'use client';

import { useId, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_TICK } from '@/lib/chart-theme';
import { formatUsdCents } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { DASHBOARD_ICON_STROKE } from './icon-stroke';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { isNotReportedYet, isStillUpdating, NOT_REPORTED_LEGEND, NOT_REPORTED_PLACEHOLDER_NOTE, NOT_REPORTED_TOOLTIP, STILL_UPDATING_LEGEND, stillUpdatingTooltip, TREND_TOTALS_NOTE, unreportedTrendNote, type CostReportState } from '@/lib/cost-trend-basis';
import { sevenDayPoints, trendDateLabel, xAxisInterval } from './cost-trend-window';
import { KEEP_CLEAR_OF_FLOATING } from '@/lib/floating-keep-clear';

/** Fill opacity of a period AWS Cost Explorer is still updating: the same colors, lighter. */
export const UPDATING_BAR_OPACITY = 0.45;

/**
 * The hatch of a period AWS Cost Explorer has not reported yet, from the
 * --app-chart-placeholder-* tokens (globals.css, light and dark). The same hatch
 * draws the placeholder column and its legend swatch.
 */
/** The narrowest band (px) one-line "Nov 10" fits with a gap; below it the 7-day dates take two lines. */
const DATE_LABEL_MIN_BAND = 46;

const PLACEHOLDER_SWATCH_BACKGROUND =
  'repeating-linear-gradient(135deg, var(--app-chart-placeholder-hatch) 0 1.5px, var(--app-chart-placeholder-fill) 1.5px 4px)';

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
  /** Cost Explorer line items in the period. */
  lineItems?: number;
  /** The backend's report state: not_reported is a gap (never $0), updating is drawn lighter. */
  reportState?: CostReportState;
  /** Kept for a backend that predates reportState (with lineItems 0: not reported yet). */
  provisional?: boolean;
}

interface CostTrendChartProps {
  data: CostDataPoint[];
  isLoading?: boolean;
  /** When set, shown instead of the chart (e.g. a failed or empty trend), keeping the range controls. */
  unavailableMessage?: string | null;
  dateRange?: '7d' | '30d' | '90d' | '6mo' | '1yr';
  onDateRangeChange?: (range: '7d' | '30d' | '90d' | '6mo' | '1yr') => void;
  onExport?: () => void;
  /** The clock for the 7-day view (the 7 full UTC days ending yesterday). Defaults to now. */
  now?: Date;
}

export function CostTrendChart({
  data,
  isLoading,
  unavailableMessage = null,
  dateRange = '90d',
  onDateRangeChange,
  onExport,
  now,
}: CostTrendChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  // The chart's measured width (0 until ResponsiveContainer reports it).
  const [chartWidth, setChartWidth] = useState(0);
  // One hatch pattern per chart instance; useId's colons are not safe in url(#…).
  const hatchId = `cost-trend-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

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
    // Cents below $10, so a sub-dollar axis never reads as all "$0".
    if (value !== 0 && Math.abs(value) < 10) {
      return `$${value.toFixed(2)}`;
    }
    return `$${value.toFixed(0)}`;
  };

  const monthly = dateRange === '6mo' || dateRange === '1yr';
  // Dates on every view ("Nov 10"), months on the monthly ones (round 2).
  const formatDate = (dateStr: string) => (typeof dateStr === 'string' ? trendDateLabel(dateStr, monthly) : String(dateStr));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length && isNotReportedYet(payload[0]?.payload ?? {})) {
      // A period Cost Explorer has not reported yet has no amounts to list (never $0).
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-[15rem]">
          <p className="text-ui font-semibold text-ink mb-1">{formatDate(label)}</p>
          <p className="text-meta text-ink-muted m-0">{NOT_REPORTED_TOOLTIP}</p>
        </div>
      );
    }
    if (active && payload && payload.length && isStillUpdating(payload[0]?.payload ?? {})) {
      // The amount so far, once: Cost Explorer may still add charges to this period.
      const soFar = Number(payload[0]?.payload?.total ?? 0);
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-[15rem]">
          <p className="text-ui font-semibold text-ink mb-1">{formatDate(label)}</p>
          <p className="text-meta text-ink-muted m-0">{stillUpdatingTooltip(formatUsdCents(soFar))}</p>
        </div>
      );
    }
    if (active && payload && payload.length) {
      const isForecast = payload[0]?.payload?.forecast;
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-[15rem]">
          <p className="text-ui font-semibold text-ink mb-2">
            {formatDate(label)}
            {isForecast && <span className="text-meta text-ink-muted ml-2">(Forecast)</span>}
          </p>
          <div className="space-y-1.5">
            {payload
              .filter((entry: any) => !hiddenSeries.has(entry.dataKey))
              .map((entry: any) => (
                <div key={entry.name} className="flex items-center justify-between gap-4 text-ui">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-[2px]"
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
            <div className="flex items-center justify-between text-ui">
              <span className="font-medium text-gray-700">Total:</span>
              <span className="font-semibold text-gray-900">
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
  // before that field existed, or a range with no service breakdown at all. Both are
  // the same stacked bars, so a period Cost Explorer has not reported yet is a gap
  // (zero-height bars), never a line drawn down to $0 (review L-7).
  // The 7-day view: exactly the 7 full UTC days ending yesterday (round 2).
  const shown = dateRange === '7d' ? sevenDayPoints(data, now ?? new Date()) : data;

  const hasServiceBreakdown = shown.some((d) => d.byServiceDisplay && d.byServiceDisplay.length > 0);

  // Stable service order + color, built from first-seen order across all points —
  // the backend already guarantees a consistent top-N+Other set across the whole
  // range, so this just preserves that order rather than re-deriving it.
  const serviceSeries: { key: string; name: string; color: string }[] = [];
  if (hasServiceBreakdown) {
    const seen = new Set<string>();
    for (const point of shown) {
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
  // The category view reads the point's own category fields.
  const chartData = shown.map((point) => {
    const row: Record<string, string | number | boolean | undefined> = {
      date: point.date,
      forecast: point.forecast,
      total: point.total,
      lineItems: point.lineItems,
      reportState: point.reportState,
      provisional: point.provisional,
    };
    if (hasServiceBreakdown) {
      for (const s of serviceSeries) row[s.key] = 0;
      for (const item of point.byServiceDisplay || []) {
        row[item.service] = item.amount;
      }
    } else {
      for (const s of categorySeries) row[s.key] = point[s.key as 'compute' | 'storage' | 'database' | 'network' | 'other'];
    }
    // Topmost visible, non-zero series for this day — the only segment that
    // gets rounded top corners, so the stack reads as one column with a
    // rounded cap rather than every segment having its own pill shape.
    for (let i = series.length - 1; i >= 0; i--) {
      const s = series[i];
      if (!hiddenSeries.has(s.key) && Number(row[s.key]) > 0) {
        row.__topKey = s.key;
        break;
      }
    }
    return row;
  });

  // Custom Bar shape: square on every side except the top-left/top-right corners
  // of the topmost non-zero segment in each stack, and no stroke — so stacked
  // segments touch with no gap/seam between them, matching a single rounded column.
  const StackedBarSegment = (props: any) => {
    const { x, y, width, height, fill, payload, dataKey } = props;
    // A period Cost Explorer is still updating: the same color, lighter.
    const fillOpacity = isStillUpdating(payload ?? {}) ? UPDATING_BAR_OPACITY : undefined;
    if (!(height > 0) || !(width > 0)) {
      // Recharts' shape prop requires a ReactElement, not null, even for a
      // zero-amount day — render nothing visible instead of skipping output.
      return <rect x={x} y={y} width={0} height={0} fill="none" />;
    }

    if (payload.__topKey !== dataKey) {
      return <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={fillOpacity} />;
    }

    const r = Math.min(3, height, width / 2);
    const path = `M ${x},${y + r}
      Q ${x},${y} ${x + r},${y}
      L ${x + width - r},${y}
      Q ${x + width},${y} ${x + width},${y + r}
      L ${x + width},${y + height}
      L ${x},${y + height}
      Z`;
    return <path d={path} fill={fill} fillOpacity={fillOpacity} />;
  };

  // A "spike" must be both proportionally large (1.5x the average day) AND a
  // meaningful dollar amount above average — otherwise cent-level noise on a
  // near-zero-spend account trips the banner.
  const SPIKE_RATIO = 1.5;
  const MIN_SPIKE_DELTA = 20; // dollars above average required to flag
  // Periods Cost Explorer has not reported yet are not $0 days, and a period it
  // is still updating is a partial amount: both are left out of the average.
  const reported = shown.filter((d) => !isNotReportedYet(d) && !isStillUpdating(d));
  const hasUpdating = shown.some((d) => isStillUpdating(d));
  const avgTotal = reported.length > 0 ? reported.reduce((sum, d) => sum + d.total, 0) / reported.length : 0;
  const hasSpike = reported.some(d => d.total > avgTotal * SPIKE_RATIO && d.total - avgTotal > MIN_SPIKE_DELTA);
  // Not-reported periods are drawn as a light hatched placeholder (round 2): never a $0 bar.
  const notReportedDates = shown.filter((d) => isNotReportedYet(d)).map((d) => d.date);
  const notReportedNote = notReportedDates.length === 0 ? null : monthly ? unreportedTrendNote(shown, 'month') : NOT_REPORTED_PLACEHOLDER_NOTE;

  // 7 days on a phone: "Nov 10" (~40 px at 12 px) does not fit a ~35 px band, so
  // each date takes two lines ("Nov" over "10") instead of overlapping or being
  // skipped (round 2). The plot is the chart width less the y-axis (60) and margin (8).
  const twoLineDates = dateRange === '7d' && chartWidth > 0 && (chartWidth - 68) / Math.max(1, shown.length) < DATE_LABEL_MIN_BAND;
  const DateTick = (props: { x?: number; y?: number; payload?: { value: string } }) => {
    const { x = 0, y = 0, payload } = props;
    const label = formatDate(payload?.value ?? '');
    const [month, day] = label.split(' ');
    return (
      <text x={x} y={y} textAnchor="middle" className="recharts-text recharts-cartesian-axis-tick-value" fontSize={CHART_TICK.fontSize} fill={CHART_TICK.fill}>
        {twoLineDates && day ? (
          <>
            <tspan x={x} dy="0.71em">{month}</tspan>
            <tspan x={x} dy="1.2em">{day}</tspan>
          </>
        ) : (
          <tspan x={x} dy="0.71em">{label}</tspan>
        )}
      </text>
    );
  };

  // A full-height column, inset to the bar width (recharts' default 10% category gap each side).
  const NotReportedPlaceholder = (props: { x?: number; y?: number; width?: number; height?: number }) => {
    const { x = 0, y = 0, width = 0, height = 0 } = props;
    if (!(width > 0) || !(height > 0)) return <g />;
    const inset = width * 0.1;
    return (
      <rect
        x={x + inset}
        y={y}
        width={width - 2 * inset}
        height={height}
        rx={3}
        fill={`url(#${hatchId})`}
        style={{ stroke: 'var(--app-chart-placeholder-hatch)' }}
        strokeWidth={1}
        data-testid="cost-trend-not-reported-placeholder"
      />
    );
  };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
          <div>
            <CardTitle className="text-section">AWS Cost Trends</CardTitle>
            <CardDescription>
              {/* 6mo and 1yr are MONTHLY Cost Explorer buckets (AWSCostService trendPeriodUtc). */}
              {dateRange === '6mo' || dateRange === '1yr'
                ? (hasServiceBreakdown
                    ? `Monthly cost breakdown by service · ${TREND_TOTALS_NOTE}`
                    : `Monthly cost breakdown by service category · ${TREND_TOTALS_NOTE}`)
                : (hasServiceBreakdown
                    ? `Daily cost breakdown by service over time · ${TREND_TOTALS_NOTE}`
                    : `Daily cost breakdown by service category over time · ${TREND_TOTALS_NOTE}`)}
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
                    className={`h-7 px-3 text-label shrink-0 ${
                      dateRange === option.value
                        ? 'bg-white text-gray-900 shadow-sm hover:bg-white'
                        : 'text-ink-muted hover:bg-white/50'
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
                <Download className="h-4 w-4 mr-2" strokeWidth={DASHBOARD_ICON_STROKE} />
                Export
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {unavailableMessage ? (
          <div className="h-[300px] flex items-center justify-center text-center px-4">
            <p className="text-ui text-ink-muted">{unavailableMessage}</p>
          </div>
        ) : (
        <>
        {/* Chart */}
        <ResponsiveContainer width="100%" height={300} onResize={(width) => setChartWidth(width)}>
          <BarChart data={chartData} margin={{ top: 10, right: dateRange === '7d' ? 8 : 30, left: 0, bottom: 0 }}>
            <defs>
              <pattern id={hatchId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <rect width={6} height={6} style={{ fill: 'var(--app-chart-placeholder-fill)' }} />
                <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: 'var(--app-chart-placeholder-hatch)' }} strokeWidth={2} />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="#9ca3af"
              tick={DateTick}
              height={twoLineDates ? 44 : 30}
              // 7 days: every date shown, never skipped (round 2); 30/90 days and months may skip.
              interval={xAxisInterval(dateRange)}
            />
            <YAxis
              domain={[0, 'auto']}
              tickFormatter={formatCurrency}
              stroke="#9ca3af"
              tick={CHART_TICK}
            />
            <Tooltip content={<CustomTooltip />} />

            {notReportedDates.map((date) => (
              <ReferenceArea key={date} x1={date} x2={date} ifOverflow="hidden" shape={NotReportedPlaceholder} />
            ))}

            {/* Forecast separator line */}
            {shown.some(d => d.forecast) && (
              <ReferenceLine
                x={shown.find(d => d.forecast)?.date}
                stroke="#9ca3af"
                strokeDasharray="5 5"
                label={{ value: 'Forecast', position: 'top', ...CHART_TICK }}
              />
            )}

            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="services"
                fill={s.color}
                shape={StackedBarSegment}
                hide={hiddenSeries.has(s.key)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* Legend with Toggle — below the chart. Wraps to multiple lines below
            the md breakpoint (narrow/mobile, where 8 entries can't reasonably
            fit on one line); forced to a single line at md and up, with
            tighter gaps/padding than the old sm: tier so it actually fits
            the chart card's real width once the dashboard grid narrows it
            to 3/5 columns at lg — not just wide open-viewport widths. */}
        {/* The legend and its notes: the floating "Live updates" pill never covers them (round 2). */}
        <div {...{ [KEEP_CLEAR_OF_FLOATING]: '' }}>
        <div className="flex items-center justify-center gap-1 md:gap-2 mt-4 flex-wrap md:flex-nowrap">
          {series.map((s) => (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className={`flex items-center gap-1.5 md:gap-1 px-2 py-1 md:px-1.5 md:py-1 rounded-md text-label font-medium whitespace-nowrap shrink-0 transition-all ${
                hiddenSeries.has(s.key)
                  ? 'opacity-40 hover:opacity-60'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div
                className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        {(hasUpdating || notReportedDates.length > 0) && (
          // The report-state entries: their own row, so the series row keeps its one line at md and up.
          <div className="flex items-center justify-center gap-1 md:gap-2 mt-1 flex-wrap">
          {hasUpdating && (
            <span
              className="flex items-center gap-1.5 md:gap-1 px-2 py-1 md:px-1.5 md:py-1 text-label font-medium whitespace-nowrap shrink-0 text-ink-muted"
              data-testid="cost-trend-updating-legend"
            >
              {/* A swatch, not text: gray-400 (#9ca3af) as light as the updating bars. */}
              <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ backgroundColor: `rgba(156, 163, 175, ${UPDATING_BAR_OPACITY})` }} />
              <span>{STILL_UPDATING_LEGEND}</span>
            </span>
          )}
          {notReportedDates.length > 0 && (
            <span
              className="flex items-center gap-1.5 md:gap-1 px-2 py-1 md:px-1.5 md:py-1 text-label font-medium whitespace-nowrap shrink-0 text-ink-muted"
              data-testid="cost-trend-not-reported-legend"
            >
              <span className="w-2.5 h-2.5 rounded-[2px] shrink-0 border border-[var(--app-chart-placeholder-hatch)]" style={{ background: PLACEHOLDER_SWATCH_BACKGROUND }} />
              <span>{NOT_REPORTED_LEGEND}</span>
            </span>
          )}
          </div>
        )}

        {/* Anomaly Indicators */}
        {notReportedNote && (
          <p className="text-meta text-ink-muted mt-2 mb-0" data-testid="cost-trend-not-reported">{notReportedNote}</p>
        )}
        </div>
        {hasSpike && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-ui text-orange-800">
              <span className="font-semibold">⚠️ May cause unexpected AWS bill increase</span> — unusual spending pattern identified. Review details above.
            </p>
          </div>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
}
