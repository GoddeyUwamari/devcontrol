'use client'

import Link from 'next/link'
import type { AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { CostSummary } from '@/lib/types'
import { formatUsd } from '../costs/cost-display'
import { PhaseTwoTag } from './PhaseTwoTag'
import { inventoryGap, resourcesScopeCaption } from './coverage'

export interface StatsState { loading: boolean; unavailable: boolean; stats: AWSServicesStats | undefined }
export interface RegisteredState { loading: boolean; error: boolean; count: number | undefined }
export interface SpendState { loading: boolean; error: boolean; summary: CostSummary | undefined }

export const SPEND_UNAVAILABLE_TEXT = 'Cost data not available yet'

/** "…" while loading, "—" when the request failed or the field is missing: never 0. */
function kpi(n: number | undefined, { loading, unavailable }: { loading: boolean; unavailable: boolean }): string {
  if (loading) return '…'
  if (unavailable || typeof n !== 'number') return '—'
  return n.toLocaleString('en-US')
}

function finishedThroughLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The spend tile (Q17): only billed AWS Cost Explorer month-to-date spend.
 * Anything else (an inventory estimate, unavailable, an error) is "Cost data
 * not available yet": the estimate is never shown here. "billed through" comes
 * from the data and is left out when the data does not say.
 */
export function describeServicesSpend({ loading, error, summary }: SpendState):
  | { kind: 'loading' }
  | { kind: 'billed'; value: string; notes: string[] }
  | { kind: 'unavailable' } {
  if (loading) return { kind: 'loading' }
  const section = summary?.spend
  if (error || !section?.data || (section.state !== 'available' && section.state !== 'partial')) return { kind: 'unavailable' }
  if (section.provenance !== 'actual' || section.data.basis !== 'billed_month_to_date') return { kind: 'unavailable' }
  const notes = ['whole account', 'billed, from Cost Explorer']
  if (section.data.finishedThrough) notes.push(`billed through ${finishedThroughLabel(section.data.finishedThrough)}`)
  if (section.state === 'partial') notes.push('partial data')
  return { kind: 'billed', value: formatUsd(section.data.amount), notes }
}

export const CONNECT_ACCOUNT_TEXT = 'Connect an AWS account'
export const NOT_SCANNED_TEXT = 'Not scanned yet'

/** Why there is no count: a link to connect an account, or "Not scanned yet". */
function GapCaption({ gap }: { gap: 'no-account' | 'not-scanned' }) {
  return gap === 'no-account'
    ? <p className="m-0 text-xs"><Link href="/connect-aws" className="text-violet-700 hover:underline">{CONNECT_ACCOUNT_TEXT}</Link></p>
    : <p className="m-0 text-xs text-slate-600">{NOT_SCANNED_TEXT}</p>
}

function Tile({ label, value, tone, children }: { label: string; value: string; tone?: 'danger'; children?: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-xl p-4 border flex flex-col gap-1.5 ${tone === 'danger' ? 'border-red-200' : 'border-slate-200'}`}>
      <h2 className="m-0 text-xs font-bold uppercase tracking-wider text-slate-700">{label}</h2>
      <p className={`m-0 text-3xl font-semibold leading-none ${tone === 'danger' ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {children}
    </div>
  )
}

const SEVERITY_CHIPS = [
  { key: 'critical', label: 'Critical', className: 'bg-red-50 text-red-800' },
  { key: 'high',     label: 'High',     className: 'bg-orange-50 text-orange-800' },
  { key: 'medium',   label: 'Medium',   className: 'bg-yellow-50 text-yellow-900' },
  { key: 'low',      label: 'Low',      className: 'bg-slate-100 text-slate-700' },
] as const

/** The five tiles (Q11): Needs attention, Unowned, Resources, Services, AWS spend. */
export function SummaryTiles({ stats: statsState, coverage, registered, spend }: {
  stats: StatsState
  coverage: ServicesCoverage | undefined
  registered: RegisteredState
  spend: SpendState
}) {
  const { stats } = statsState
  const ownership = stats?.ownership
  const readable = ownership ? ownership.owned + ownership.unowned : 0
  const unownedPercent = ownership && readable > 0 ? Math.round((ownership.unowned / readable) * 100) : null
  const bySeverity = stats?.attention_by_severity
  const scope = resourcesScopeCaption(coverage)
  const spendView = describeServicesSpend(spend)
  // With no account, or no scan yet, a 0 would read as "scanned, nothing
  // found": the inventory tiles show "—" and say why instead.
  const gap = statsState.loading ? null : inventoryGap(coverage, stats?.total)
  const count = (n: number | undefined) => (gap ? '—' : kpi(n, statsState))
  // Red only when something is flagged.
  const flagged = !gap && !statsState.loading && !statsState.unavailable && (stats?.needs_attention ?? 0) > 0

  return (
    <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      <Tile label="Needs attention" value={count(stats?.needs_attention)} tone={flagged ? 'danger' : undefined}>
        {bySeverity && flagged && (
          <ul aria-label="Needs attention by severity" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {SEVERITY_CHIPS.filter((s) => bySeverity[s.key] > 0).map((s) => (
              <li key={s.key} className={`rounded px-2 py-0.5 text-xs font-semibold ${s.className}`}>{bySeverity[s.key]} {s.label}</li>
            ))}
          </ul>
        )}
        <p className="m-0 text-xs text-slate-600">No flagged issues: {count(stats?.healthy)}</p>
        {gap && <GapCaption gap={gap} />}
      </Tile>

      <Tile label="Unowned" value={count(ownership?.unowned)}>
        {gap && <GapCaption gap={gap} />}
        {!gap && unownedPercent !== null && !statsState.loading && (
          <p className="m-0 text-xs text-slate-600">
            {unownedPercent}% of resources whose tags we could read have neither an Owner nor a Team tag
          </p>
        )}
      </Tile>

      <Tile label="Resources" value={count(stats?.total)}>
        {gap && <GapCaption gap={gap} />}
        {!gap && scope && <p className="m-0 text-xs text-slate-600">{scope}</p>}
      </Tile>

      <Tile label="Services" value={kpi(registered.count, { loading: registered.loading, unavailable: registered.error })}>
        <p className="m-0 text-xs text-slate-600">
          registered{stats?.mapped_to_service === 0 && stats.total > 0 && <> · resources not mapped to services yet <PhaseTwoTag /></>}
        </p>
      </Tile>

      <Tile label="AWS spend, month to date" value={spendView.kind === 'loading' ? '…' : spendView.kind === 'billed' ? spendView.value : '—'}>
        {spendView.kind === 'billed' && (
          <p className="m-0 text-xs text-slate-600">{spendView.notes.join(' · ')} · per service <PhaseTwoTag /></p>
        )}
        {spendView.kind === 'unavailable' && (
          <p className="m-0 text-xs text-slate-600">
            {SPEND_UNAVAILABLE_TEXT} · <Link href="/costs" className="text-violet-700 hover:underline">Costs</Link>
          </p>
        )}
      </Tile>
    </section>
  )
}
