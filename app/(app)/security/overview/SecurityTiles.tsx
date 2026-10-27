'use client'

import Link from 'next/link'
import { Num } from '@/components/ui/typography'
import type { SecurityView } from './securityModel'
import { PAGE_COPY, PAGE_HREF } from './securityCopy'
import { RegionText } from './RegionText'

const LINK = 'mt-auto inline-flex min-h-11 w-fit items-center text-ui font-semibold text-ink-accent hover:underline'
const RETRY = 'inline-flex min-h-11 w-fit items-center rounded-lg border border-slate-300 bg-white px-3 text-ui font-semibold text-ink hover:bg-slate-50'

function Tile({ testId, title, busy, children }: { testId: string; title: string; busy: boolean; children: React.ReactNode }) {
  return (
    <div data-testid={testId} aria-busy={busy || undefined} className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="m-0 text-label uppercase tracking-[0.04em] text-ink-muted">{title}</h2>
      {children}
    </div>
  )
}

/** A value that didn't load is "—", never 0, read as "not available" (as the filter counts, founder answer 7). */
const Dash = () => (
  <p className="m-0 text-kpi text-ink"><span aria-hidden="true">{PAGE_COPY.unavailable}</span><span className="sr-only">{PAGE_COPY.notAvailable}</span></p>
)

/** Security score · Open findings · Compliance baseline · Anomalies (founder answer 3). */
export function SecurityTiles({ tiles, anomaliesError, onRetryScore, onRetryAnomalies }: {
  tiles: SecurityView['tiles']
  anomaliesError: boolean
  onRetryScore: () => void
  onRetryAnomalies: () => void
}) {
  const { score, findings, compliance, anomalies } = tiles
  return (
    <section className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <Tile testId="security-tile-score" title={PAGE_COPY.tileScore} busy={score.value === null && score.caption === null}>
        {score.value !== null
          ? <p className="m-0 text-kpi text-ink"><Num>{score.value}</Num><span className="text-body text-ink-muted">{PAGE_COPY.scoreSuffix}</span></p>
          : <Dash />}
        {score.caption && <p className="m-0 text-meta text-ink-muted"><RegionText text={score.caption} /></p>}
        {score.retry && <button type="button" onClick={onRetryScore} className={RETRY}>{PAGE_COPY.retry}</button>}
      </Tile>

      <Tile testId="security-tile-findings" title={PAGE_COPY.tileFindings} busy={findings === null}>
        {findings && findings.total !== null ? <p className="m-0 text-kpi text-ink"><Num>{findings.total}</Num></p> : <Dash />}
        {findings?.breakdown && <p className="m-0 text-meta text-ink-muted">{findings.breakdown}</p>}
        {findings?.note && <p className="m-0 text-meta text-ink-muted">{findings.note}</p>}
      </Tile>

      <Tile testId="security-tile-compliance" title={PAGE_COPY.tileCompliance} busy={compliance === null}>
        {compliance ? <p className="m-0 text-section text-ink">{compliance.label}</p> : <Dash />}
        {compliance?.lastEvaluated && <p className="m-0 text-meta text-ink-muted">{compliance.lastEvaluated}</p>}
        <Link href={PAGE_HREF.frameworks} className={LINK}>{PAGE_COPY.openFrameworks}</Link>
      </Tile>

      <Tile testId="security-tile-anomalies" title={PAGE_COPY.tileAnomalies} busy={anomalies === null && !anomaliesError}>
        {anomalies !== null
          ? <p className="m-0 text-section text-ink">{anomalies}</p>
          : anomaliesError
            ? <>
                <p className="m-0 text-body text-ink-body">{PAGE_COPY.anomaliesError}</p>
                <button type="button" onClick={onRetryAnomalies} className={RETRY}>{PAGE_COPY.retry}</button>
              </>
            : <Dash />}
        <Link href={PAGE_HREF.anomalies} className={LINK}>{PAGE_COPY.history}</Link>
      </Tile>
    </section>
  )
}
