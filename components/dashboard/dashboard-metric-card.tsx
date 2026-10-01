import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { Progress } from '@/components/ui/progress'
import { EvidenceBadge, type EvidenceBadgeProps } from './evidence-badge'
import { EvidenceInfo } from './evidence-info'

interface SparklinePoint {
  value: number
}

interface DashboardMetricCardProps {
  icon: LucideIcon
  iconColor: string
  iconBackground: string
  label: string
  /** Large metric value. Pass a string like "Calculating…"/"—" for an unavailable state. */
  value: string
  valueSuffix?: string
  /** Evidence state stays on the face as badges (status, comparison, Partial). */
  badges?: EvidenceBadgeProps[]
  /** Score bar; omitted whenever there is no real score. */
  progress?: { value: number; fillClassName: string; ariaValueText: string }
  /** Real historical series only — omit rather than fabricate a trend shape. */
  sparkline?: SparklinePoint[]
  sparklineColor?: string
  /** Detailed evidence, behind the info button -- never as paragraphs on the face. */
  info?: { title: string; content: ReactNode; align?: 'start' | 'end' }
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
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-7 mt-3" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * Shared KPI card for the Dashboard's top row: icon chip, title (linking to
 * the metric's page), info button, primary value, status badges, and a small
 * visualization. Detailed evidence lives in the info panel, not on the face.
 * The card itself is not a link: it contains a button, and interactive
 * content can't nest inside an <a>.
 */
export function DashboardMetricCard({ icon: Icon, iconColor, iconBackground, label, value, valueSuffix, badges, progress, sparkline, sparklineColor, info, href }: DashboardMetricCardProps) {
  return (
    <div className="relative bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full flex flex-col" data-testid="kpi-card">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: iconBackground }}>
            <Icon size={16} style={{ color: iconColor }} aria-hidden="true" />
          </div>
          {href ? (
            <Link href={href} className="text-sm font-semibold text-foreground no-underline hover:underline truncate">{label}</Link>
          ) : (
            <p className="text-sm font-semibold text-foreground truncate m-0">{label}</p>
          )}
        </div>
        {info && (
          <EvidenceInfo label={`${label} details`} title={info.title} align={info.align}>
            {info.content}
          </EvidenceInfo>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="text-[30px] font-bold leading-none tracking-tight text-foreground">
          {value}
          {valueSuffix && <span className="text-base text-[var(--text-secondary)] font-normal"> {valueSuffix}</span>}
        </div>
        {badges && badges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {badges.map((b) => <EvidenceBadge key={b.label} {...b} />)}
          </div>
        )}
      </div>
      <div className="mt-auto">
        {progress && (
          <Progress
            value={progress.value}
            className="h-2 mt-4 bg-[color:var(--border)]"
            indicatorClassName={progress.fillClassName}
            aria-label={`${label} score`}
            aria-valuenow={progress.value}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={progress.ariaValueText}
          />
        )}
        {sparkline && sparkline.length >= 2 && <Sparkline points={sparkline} color={sparklineColor ?? 'var(--text-accent)'} />}
      </div>
    </div>
  )
}
