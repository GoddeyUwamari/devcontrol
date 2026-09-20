import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, CheckCircle2, AlertTriangle, DollarSign, Activity } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

// Same precise-currency convention as page.tsx's currencyFormatter (and
// app/(app)/invoices/page.tsx's formatCurrency) -- always 2 decimals, never
// rounded to a whole dollar, so this doesn't silently disagree with the
// Monthly Spend KPI over the exact same underlying value.
const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

interface InfrastructureIntelligenceProps {
  overallHealth: { score: number | null; context: string | null }
  topRisk: string | null
  /** Same source (aiSummaryData) covers both overallHealth.context and topRisk -- one flag for both. */
  aiSummaryLoading: boolean
  cloudSpend: { amount: number | null; periodLabel: string }
  systemStatus: { label: string; color: string; background: string; dotColor: string }
  isLive: boolean
}

const scoreTone = (score: number | null) =>
  score === null ? 'var(--foreground)' : score >= 80 ? 'var(--text-success)' : score >= 60 ? 'var(--text-warning)' : 'var(--text-danger)'

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

function IntelCard({ icon: Icon, iconColor, iconBackground, label, valueNode, description }: {
  icon: LucideIcon
  iconColor: string
  iconBackground: string
  label: string
  valueNode: ReactNode
  description: ReactNode
}) {
  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: iconBackground }}>
          <Icon size={14} style={{ color: iconColor }} />
        </div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
      </div>
      <div className="mb-1.5">{valueNode}</div>
      <div className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">{description}</div>
    </div>
  )
}

/**
 * Central organizing section: one coherent "what's the state of my
 * infrastructure" card row, replacing the prior duplicated System
 * Intelligence / Highest Priority Action / Executive Insights / System
 * Status Bar blocks.
 *
 * Top Risk's fallback ("No urgent risks identified") is a specific,
 * falsifiable claim, so it's only ever shown once aiSummaryData has actually
 * settled -- while aiSummaryLoading is true, both it and Overall Health's
 * context render a skeleton instead. Overall Health's *score* is unaffected
 * (it's computed independently, synchronously, from cost/security/
 * observability sub-scores, not from aiSummaryData).
 */
export function InfrastructureIntelligence({ overallHealth, topRisk, aiSummaryLoading, cloudSpend, systemStatus, isLive }: InfrastructureIntelligenceProps) {
  return (
    <div className="mb-6">
      {/* No single existing route represents cost + security + observability +
          infrastructure health together, so this section has no "View details"
          CTA -- each card below links out to its own real, narrower page where
          one is meaningful (see Security Health KPI's href, Security & Compliance's
          detailsHref) rather than pointing everything at one misleadingly-broad
          destination. */}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <IntelCard
          icon={CheckCircle2}
          iconColor="var(--text-success)"
          iconBackground="var(--bg-success)"
          label="Overall Health"
          valueNode={
            <div className="text-2xl font-bold leading-none" style={{ color: scoreTone(overallHealth.score) }}>
              {overallHealth.score ?? '—'}
              {overallHealth.score !== null && <span className="text-sm text-[var(--text-secondary)] font-normal">/100</span>}
            </div>
          }
          description={
            aiSummaryLoading ? (
              <span className="flex flex-col gap-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </span>
            ) : (
              overallHealth.context ?? (overallHealth.score === null ? 'Calculating…' : 'Blended cost, security, and observability score.')
            )
          }
        />

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
          icon={DollarSign}
          iconColor="var(--text-accent)"
          iconBackground="var(--bg-accent)"
          label="Cloud Spend"
          valueNode={<div className="text-2xl font-bold leading-none text-foreground">{cloudSpend.amount !== null ? currencyFormatter.format(cloudSpend.amount) : '—'}</div>}
          description={cloudSpend.periodLabel}
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
        />
      </div>
    </div>
  )
}
