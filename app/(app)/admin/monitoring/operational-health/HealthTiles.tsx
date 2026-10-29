'use client'

import { Num } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { CountTile, Segment, TilesView } from './operationalHealthModel'
import { PAGE_COPY, alarmsHref } from './operationalHealthCopy'
import { BAR, BUTTON, LINK } from './tones'

function Tile({ testId, title, busy, children }: { testId: string; title: string; busy: boolean; children: React.ReactNode }) {
  return (
    <div data-testid={testId} aria-busy={busy || undefined} className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="m-0 text-label uppercase tracking-[0.04em] text-ink-muted">{title}</h2>
      {children}
    </div>
  )
}

/** A value that didn't load is "—", never 0. */
const Dash = () => (
  <p data-testid="tile-dash" className="m-0 text-kpi text-ink"><span aria-hidden="true">{PAGE_COPY.unavailable}</span><span className="sr-only">{PAGE_COPY.notAvailable}</span></p>
)

const Retry = ({ onRetry }: { onRetry: () => void }) => <button type="button" onClick={onRetry} className={cn(BUTTON, 'w-fit')}>{PAGE_COPY.retry}</button>

/** Decorative: the legend line beside it carries the numbers. */
function Bar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-slate-200">
      {total > 0 && segments.filter((s) => s.value > 0).map((s) => <span key={s.key} className={BAR[s.tone]} style={{ width: `${(s.value / total) * 100}%` }} />)}
    </div>
  )
}

function CountBody({ tile, suffix, caption, onRetry }: { tile: CountTile; suffix: string; caption: string | null; onRetry: () => void }) {
  switch (tile.state) {
    case 'loading':
      return <Dash />
    case 'unavailable':
      return (
        <>
          <Dash />
          <p className="m-0 text-body text-ink-body">{tile.reason}</p>
          {tile.retry && <Retry onRetry={onRetry} />}
        </>
      )
    case 'none':
      return (
        <>
          <p className="m-0 text-section text-ink">{PAGE_COPY.noneMeasured}</p>
          {tile.note && <p className="m-0 text-meta text-ink-muted">{tile.note}</p>}
        </>
      )
    case 'ok':
      return (
        <>
          <p className="m-0 text-kpi text-ink"><Num>{tile.value.toLocaleString()}</Num> <span className="text-body text-ink-muted">of <Num>{tile.of.toLocaleString()}</Num> {suffix}</span></p>
          <Bar segments={tile.segments} />
          <p className="m-0 text-meta text-ink-body">{tile.legend}</p>
          {(tile.note ?? caption) && <p className="m-0 text-meta text-ink-muted">{tile.note ?? caption}</p>}
        </>
      )
  }
}

/** Resource checks · Telemetry coverage · CloudWatch alarms · Region. */
export function HealthTiles({ tiles, onRetry }: { tiles: TilesView; onRetry: () => void }) {
  const { checks, telemetry, alarms, region } = tiles
  return (
    <section aria-label="Key numbers" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <Tile testId="tile-checks" title={PAGE_COPY.tileChecks} busy={checks.state === 'loading'}>
        <CountBody tile={checks} suffix="measured passing" caption={PAGE_COPY.checksCaption} onRetry={onRetry} />
      </Tile>
      <Tile testId="tile-telemetry" title={PAGE_COPY.tileTelemetry} busy={telemetry.state === 'loading'}>
        <CountBody tile={telemetry} suffix="reporting" caption={null} onRetry={onRetry} />
      </Tile>
      <Tile testId="tile-alarms" title={PAGE_COPY.tileAlarms} busy={alarms.state === 'loading'}>
        {alarms.state === 'ok' ? (
          <>
            <div className="flex gap-6">
              <div data-testid="alarms-in-alarm"><p className="m-0 text-kpi text-ink"><Num>{alarms.inAlarm}</Num></p><p className="m-0 text-meta text-ink-body">{PAGE_COPY.inAlarm}</p></div>
              <div data-testid="alarms-configured"><p className="m-0 text-kpi text-ink"><Num>{alarms.configured}</Num></p><p className="m-0 text-meta text-ink-body">{PAGE_COPY.configured}</p></div>
            </div>
            <a href={alarmsHref(alarms.region)} target="_blank" rel="noopener noreferrer" className={LINK}>{PAGE_COPY.viewAlarms}</a>
          </>
        ) : alarms.state === 'loading' ? (
          <Dash />
        ) : (
          <>
            <Dash />
            <p className="m-0 text-body text-ink-body">{alarms.reason}</p>
            {alarms.detail && <p className="m-0 text-meta text-ink-muted">{alarms.detail}</p>}
            {alarms.retry && <Retry onRetry={onRetry} />}
          </>
        )}
      </Tile>
      <Tile testId="tile-region" title={PAGE_COPY.tileRegion} busy={false}>
        {region ? <p className="m-0 font-mono text-section text-ink">{region}</p> : <Dash />}
        <p className="m-0 text-meta text-ink-body">{PAGE_COPY.regionCaption}</p>
      </Tile>
    </section>
  )
}
