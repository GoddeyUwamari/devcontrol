import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react'

interface SparklinePoint {
  value: number
}

interface DashboardMetricCardProps {
  icon: LucideIcon
  iconColor: string
  iconBackground: string
  label: string
  /** Large metric value. Pass a string like "Calculating…"/"Scanning…"/"—" for an unavailable state. */
  value: string
  valueSuffix?: string
  valueColor?: string
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; color: string }
  /** Real historical series only — omit rather than fabricate a trend shape. */
  sparkline?: SparklinePoint[]
  href?: string
}

function Sparkline({ points, color }: { points: SparklinePoint[]; color: string }) {
  if (points.length < 2) return null
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 100
  const height = 28
  const step = width / (points.length - 1)
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((p.value - min) / range) * height).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-7 mt-2" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Shared KPI card shell for the Primary KPI row — icon-in-circle, large
 * value, optional trend line and real-data-only sparkline, matching the
 * approved mockup's card shape.
 */
export function DashboardMetricCard({ icon: Icon, iconColor, iconBackground, label, value, valueSuffix, valueColor, trend, sparkline, href }: DashboardMetricCardProps) {
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus
  const content = (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: iconBackground }}>
            <Icon size={16} style={{ color: iconColor }} />
          </div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
        </div>
        {href && <ArrowRight size={14} strokeWidth={1.75} className="text-[var(--text-secondary)] shrink-0" />}
      </div>
      <div className="text-[30px] font-bold leading-none tracking-tight mb-2" style={{ color: valueColor ?? 'var(--foreground)' }}>
        {value}
        {valueSuffix && <span className="text-base text-[var(--text-secondary)] font-normal">{valueSuffix}</span>}
      </div>
      {trend && (
        <div className="flex items-center gap-1.5">
          <TrendIcon size={13} style={{ color: trend.color }} />
          <span className="text-xs font-semibold" style={{ color: trend.color }}>{trend.label}</span>
        </div>
      )}
      {sparkline && sparkline.length >= 2 && <Sparkline points={sparkline} color={trend?.color ?? 'var(--text-success)'} />}
    </div>
  )
  return href ? <a href={href} className="no-underline block h-full">{content}</a> : content
}
