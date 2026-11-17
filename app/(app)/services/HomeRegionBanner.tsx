'use client'

import { MapPin, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HomeRegionBannerView } from './homeRegionModel'
import { HOME_REGION_COPY } from './homeRegionModel'
import { TONE } from './redesignTone'

/**
 * The home-region banner (mock v2.1 tabs 9 and 10): the proposal (HR-S1–S5) or
 * the split-spend prompt (V2-1…V2-8), exactly as the server's state says. A
 * neutral surface (rule 15: violet only on the primary button); in the split
 * banner no bar is highlighted. Owner buttons only when the server says the
 * caller may change the home region (G9); everyone else reads the owner-only
 * line. The buttons never change anything by themselves: "Use"/"Choose" open
 * the change dialog, "Keep" asks the server to dismiss.
 */
export function HomeRegionBanner({ view, busy, error, onPrimary, onKeep }: {
  view: HomeRegionBannerView
  /** A Keep request is in flight. */
  busy: boolean
  /** A failed Keep (any code but NO_OPEN_PROPOSAL): the founder's line, role=alert. */
  error: string | null
  onPrimary: () => void
  onKeep: () => void
}) {
  const titleId = `home-region-banner-${view.kind}`
  const hintId = `${titleId}-hint`
  const Icon = view.kind === 'proposal' ? MapPin : BarChart3
  const disabled = !!view.owner?.disabled || busy
  return (
    <section role="region" aria-labelledby={titleId} data-testid="home-region-banner" data-kind={view.kind}
      className={cn(TONE.card, 'mb-4 flex items-start gap-3 px-4 py-3')}>
      <Icon size={20} aria-hidden="true" className={cn('mt-0.5 shrink-0', TONE.muted)} />
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className={cn('m-0 text-body font-semibold', TONE.ink)}>
          {view.region ? <>Your AWS costs point to <span className="whitespace-nowrap font-mono">{view.region}</span> as your home region.</> : view.title}
        </h2>
        <p className={cn('m-0 mt-1 text-ui', TONE.body)}>{view.body}</p>
        <ul aria-label={HOME_REGION_COPY.barsLabel} data-testid="spend-bars" className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-ui">
          {view.bars.map((bar) => {
            const lead = view.kind === 'proposal' && bar.region && bar.label === view.region
            return (
              <li key={bar.key} data-bar={bar.key} data-lead={lead ? 'true' : undefined}
                className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3.5rem_6rem] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_3.5rem_6rem]">
                <span className={cn('min-w-0 break-words', TONE.ink)}>
                  {bar.region ? <span className="font-mono">{bar.label}</span> : bar.label}
                  {bar.homeNow && <span className={TONE.muted}> {HOME_REGION_COPY.homeNow}</span>}
                </span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted max-sm:hidden">
                  <span className={cn('block h-full rounded-full', lead ? 'bg-slate-700 dark:bg-slate-200' : 'bg-slate-400 dark:bg-slate-500')}
                    style={{ width: `${Math.max(0, Math.min(100, bar.share))}%` }} />
                </span>
                <span className={cn('text-right tabular-nums', TONE.body)}>{bar.shareText}</span>
                <span className={cn('text-right tabular-nums', bar.amount ? TONE.body : TONE.muted)}>{bar.amount ?? '—'}</span>
              </li>
            )
          })}
        </ul>
        {view.owner ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
            <button type="button" onClick={onPrimary} disabled={disabled} aria-describedby={view.owner.hint ? hintId : undefined}
              className={cn(TONE.primaryButton, TONE.focus, 'max-sm:justify-center')}>{view.owner.primary}</button>
            <button type="button" onClick={onKeep} disabled={disabled} aria-describedby={view.owner.hint ? hintId : undefined}
              className={cn(TONE.secondaryButton, TONE.focus, 'max-sm:justify-center')}>{view.owner.keep}</button>
            {view.owner.hint && <span id={hintId} className={cn('text-meta', TONE.muted)}>{view.owner.hint}</span>}
          </div>
        ) : (
          view.memberLine && <p data-testid="home-region-member-line" className={cn('m-0 mt-3 text-meta', TONE.muted)}>{view.memberLine}</p>
        )}
        {error && (
          <div role="alert" data-testid="home-region-keep-error" className="mt-3 rounded-lg border border-[var(--border-danger)] bg-[var(--bg-danger)] px-3 py-2 text-ui text-ink-danger dark:text-red-400">
            {error}
          </div>
        )}
        {view.note && <p className={cn('m-0 mt-3 text-meta', TONE.muted)}>{view.note}</p>}
        {view.footnote && <p data-testid="home-region-footnote" className={cn('m-0 mt-1 text-meta', TONE.muted)}>{view.footnote}</p>}
      </div>
    </section>
  )
}
