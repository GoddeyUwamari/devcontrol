'use client'

import type { AWSServicesStats } from '@/lib/services/aws-services.service'
import { PhaseTwoTag } from './PhaseTwoTag'

/**
 * Unowned resources (Q19): how many resources have neither an Owner nor a
 * Team tag, beside the three largest teams (by Team tag, case-insensitively,
 * from /stats). Resources whose tags could not be read are in neither.
 * Rendered only with /stats loaded.
 */
export function UnownedCard({ stats, onShowUnowned, onOpenTeamFilter }: {
  stats: AWSServicesStats
  /** "Show the N": All resources with Show = Unowned. */
  onShowUnowned?: () => void
  /** "all teams": opens the Owner / team filter. Hidden when there are no teams. */
  onOpenTeamFilter?: () => void
}) {
  const unowned = stats.ownership?.unowned
  if (typeof unowned !== 'number') return null
  const top = stats.teams?.top ?? []
  const bars = [...top.map((t) => ({ key: `team-${t.team}`, label: t.team, count: t.count, unowned: false })), { key: 'unowned', label: 'Unowned', count: unowned, unowned: true }]
  const max = Math.max(1, ...bars.map((b) => b.count))

  return (
    <section aria-labelledby="unowned-heading" className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex-[1_1_320px]">
        <h2 id="unowned-heading" className="m-0 mb-1 text-section text-slate-900">
          {unowned} resource{unowned === 1 ? ' is' : 's are'} unowned
        </h2>
        <p className="m-0 text-ui text-slate-600">
          They have neither an Owner nor a Team tag, so nobody is on the hook for them. A resource with only a Team tag counts as owned by that team.
        </p>
      </div>
      <div className="flex min-w-0 flex-[0_1_320px] flex-col gap-1 text-meta">
        <ul aria-label="Resources per team" className="m-0 flex list-none flex-col gap-1 p-0">
          {bars.map((bar) => (
            <li key={bar.key}>
              <div className="flex justify-between gap-2">
                <span className={bar.unowned ? 'font-semibold text-orange-900' : 'text-slate-900'}>{bar.label}</span>
                <span className="text-slate-600">{bar.count}</span>
              </div>
              <div aria-hidden="true" className={`h-1.5 rounded ${bar.unowned ? 'bg-orange-50' : 'bg-violet-50'}`}>
                <div className={`h-1.5 rounded ${bar.unowned ? 'bg-orange-600' : 'bg-violet-600'}`} style={{ width: `${Math.round((bar.count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="m-0 text-meta text-slate-600">
          Resources per team (Team tag)
          {onOpenTeamFilter && (stats.teams?.total_teams ?? 0) > 0 && <> · <button type="button" onClick={onOpenTeamFilter} className="font-semibold text-violet-700 hover:underline">all teams</button></>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onShowUnowned && unowned > 0 && (
          <button type="button" onClick={onShowUnowned} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-label text-slate-900 hover:border-slate-400">
            Show the {unowned}
          </button>
        )}
        <button type="button" disabled className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-label text-slate-700 opacity-60 cursor-not-allowed">
          Assign owner
        </button>
        <PhaseTwoTag />
      </div>
    </section>
  )
}
