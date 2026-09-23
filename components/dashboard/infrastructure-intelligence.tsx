import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { BarChart3, AlertTriangle, Activity, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface InfrastructureIntelligenceProps {
  topRisk: string | null
  aiSummaryLoading: boolean
  systemStatus: { label: string; color: string; background: string; dotColor: string }
  isLive: boolean
}

// topRisk is generated server-side as "one short sentence" (see
// ai-summary.service.ts's prompt) -- most real risk text has no natural
// headline/detail split at all. Only split into a bold headline + a
// genuinely distinct supporting clause when the text itself contains a
// clear secondary clause (an em-dash or a mid-sentence ". " break with real
// content after it); otherwise the whole string IS the headline and there
// is nothing further to say, so the description is omitted rather than
// repeating the identical sentence a second time.
function splitRiskText(risk: string): { headline: string; rest: string | null } {
  const dashSplit = risk.split(/\s+—\s+/)
  if (dashSplit.length > 1 && dashSplit[1].trim().length > 0) {
    return { headline: dashSplit[0], rest: dashSplit.slice(1).join(' — ') }
  }
  const sentenceSplit = risk.split(/(?<=\.)\s+(?=[A-Z])/)
  if (sentenceSplit.length > 1 && sentenceSplit[1].trim().length > 0) {
    return { headline: sentenceSplit[0], rest: sentenceSplit.slice(1).join(' ') }
  }
  return { headline: risk, rest: null }
}

function IntelCard({ icon: Icon, iconColor, iconBackground, label, valueNode, description, href }: {
  icon: LucideIcon
  iconColor: string
  iconBackground: string
  label: string
  valueNode: ReactNode
  description: ReactNode
  /** Plain navigation affordance only -- never used to imply the card's own
   *  value/description describes the destination page's data. */
  href?: string
}) {
  const content = (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: iconBackground }}>
            <Icon size={14} style={{ color: iconColor }} />
          </div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
        </div>
        {href && <ChevronRight size={16} className="text-[var(--text-secondary)]" />}
      </div>
      <div className="mb-1.5">{valueNode}</div>
      <div className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">{description}</div>
    </div>
  )
  return href ? <Link href={href} className="no-underline block h-full">{content}</Link> : content
}

/**
 * Central organizing section: one coherent "what's the state of my
 * infrastructure" card row, replacing the prior duplicated System
 * Intelligence / Highest Priority Action / Executive Insights / System
 * Status Bar blocks.
 *
 * Only Top Risk and System Status live here -- Overall Health and Cloud
 * Spend were removed because they duplicated the Infrastructure Health and
 * Monthly Spend primary KPI cards directly above this section (same numbers,
 * shown twice). Those two figures are now shown exactly once, in the primary
 * KPI row.
 *
 * Top Risk's fallback ("No urgent risks identified") is a specific,
 * falsifiable claim, so it's only ever shown once aiSummaryData has actually
 * settled -- while aiSummaryLoading is true it renders a skeleton instead.
 *
 * No "View details" link on the section header: even after trimming to two
 * cards, there's still no single page that represents "Top Risk (AI-derived,
 * cross-cutting) + System Status" together -- System Status links to its own
 * real destination (/admin/monitoring, the same page the top nav's
 * "Monitoring Overview" reaches via /monitoring) below instead of the header pointing
 * everywhere at once.
 */
export function InfrastructureIntelligence({ topRisk, aiSummaryLoading, systemStatus, isLive }: InfrastructureIntelligenceProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-4">
        <BarChart3 size={17} style={{ color: 'var(--text-accent)' }} />
        <h2 className="text-base font-bold text-foreground">Infrastructure Intelligence</h2>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--text-success)', background: 'var(--bg-success)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fill-success)' }} />
            Real-time
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <IntelCard
          icon={AlertTriangle}
          iconColor="var(--text-danger)"
          iconBackground="var(--bg-danger)"
          label="Top Risk"
          valueNode={
            aiSummaryLoading ? (
              <Skeleton className="h-4 w-4/5" />
            ) : (
              <div className="text-sm font-bold text-foreground leading-snug line-clamp-2">{topRisk ? splitRiskText(topRisk).headline : 'No urgent risks identified'}</div>
            )
          }
          description={
            aiSummaryLoading ? (
              <span className="flex flex-col gap-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </span>
            ) : (
              topRisk ? (splitRiskText(topRisk).rest ?? '') : 'Nothing currently requires immediate attention.'
            )
          }
        />

        <IntelCard
          icon={Activity}
          iconColor={systemStatus.color}
          iconBackground={systemStatus.background}
          label="System Status"
          valueNode={
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: systemStatus.dotColor }} />
              <span className="text-xl font-bold" style={{ color: systemStatus.color }}>{systemStatus.label.startsWith('All systems') ? 'Healthy' : systemStatus.label.startsWith('Degraded') ? 'Degraded' : systemStatus.label.startsWith('System outage') ? 'Down' : 'Unknown'}</span>
            </div>
          }
          description={systemStatus.label}
          href="/admin/monitoring"
        />
      </div>
    </div>
  )
}
