export interface TrendData {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
  direction: 'up' | 'down' | 'neutral';
  label: string; // "vs last week", "vs last month", "this week"
  value?: string; // Formatted string for display (e.g. "+12%")
  sparklineData?: number[]; // Last 7 data points for mini chart
}

export interface StatWithTrend {
  label: string;
  value: number;
  icon?: React.ComponentType<{ className?: string }>;
  trend: TrendData;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

// Helper to calculate trend
export function calculateTrend(
  current: number,
  previous: number,
  label: string = 'vs last week'
): TrendData {
  const change = current - previous;
  const changePercent = previous === 0 ? 0 : (change / previous) * 100;

  let direction: 'up' | 'down' | 'neutral' = 'neutral';
  if (change > 0) direction = 'up';
  if (change < 0) direction = 'down';

  return {
    current,
    previous,
    change,
    changePercent,
    direction,
    label,
  };
}
