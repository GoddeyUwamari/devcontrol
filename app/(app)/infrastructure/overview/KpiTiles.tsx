'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { RichText } from '../../services/ScanTime'
import { UnmeasuredValue } from '@/components/aws/not-connected'
import { SeverityBadge } from '@/components/ui/severity-badge'
import { cn } from '@/lib/utils'
import { InfoTip } from './InfoTip'
import { TILE_LABELS, type FindingsTile, type OverviewView, type Tile } from './overviewModel'

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6'

/** Label → one big number → one line → link pinned to the bottom (redesign item 3). Links are hidden on a phone (board 2). */
function Card({ testId, label, info, value, line, link, className }: {
  testId: string; label: string; info?: ReactNode; value: ReactNode; line: ReactNode; link: { text: string; href: string }; className?: string
}) {
  return (
    <div data-testid={testId} className={cn(CARD, className)}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-label uppercase tracking-[0.04em] text-slate-700">{label}</h3>
        {info}
      </div>
      {value}
      {line}
      <Link href={link.href} className="mt-auto hidden text-ui font-semibold text-violet-700 hover:underline sm:block">{link.text}</Link>
    </div>
  )
}

function TileCard({ tile, now, className }: { tile: Tile; now: number; className?: string }) {
  return (
    <Card
      testId={`infra-tile-${tile.key}`}
      className={className}
      label={tile.label}
      info={<InfoTip label={tile.label} lines={tile.info} testId={`infra-tile-${tile.key}-info`} />}
      value={<p className={`m-0 break-words text-kpi tabular-nums ${tile.tone === 'success' ? 'text-ink-success' : 'text-slate-900'}`}>{tile.value}</p>}
      line={tile.line && <p data-testid={`infra-tile-${tile.key}-line`} className="m-0 text-meta text-slate-600"><RichText parts={tile.line} now={now} /></p>}
      link={tile.link}
    />
  )
}

/** Findings on resources, with their High (and Critical) count; account-level findings on their own line, never added (ruling 2). */
function FindingsCard({ tile }: { tile: FindingsTile }) {
  return (
    <Card
      testId="infra-tile-findings"
      label={tile.label}
      info={<InfoTip label={tile.label} lines={tile.info} testId="infra-tile-findings-info" />}
      value={(
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p data-testid="infra-findings-resources" className="m-0 text-kpi tabular-nums text-slate-900">{tile.value}</p>
          {tile.chips.map((c) => <SeverityBadge key={c.severity} severity={c.severity} label={c.label} />)}
        </div>
      )}
      line={(
        <div className="flex flex-col gap-1">
          {tile.resourceNote && <p className="m-0 text-meta text-slate-600">{tile.resourceNote}</p>}
          {tile.accountLine && <p data-testid="infra-findings-account" className="m-0 text-meta text-slate-600">{tile.accountLine}</p>}
        </div>
      )}
      link={tile.link}
    />
  )
}

/** AWS spend, this month · Open findings · Possible savings: three equal cards; on a phone spend is full width, the other two side by side. */
export function KpiTiles({ tiles, now }: { tiles: NonNullable<OverviewView['tiles']>; now: number }) {
  return (
    <section aria-labelledby="infra-kpi-heading">
      <h2 id="infra-kpi-heading" className="sr-only">Summary</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-5">
        <TileCard tile={tiles.spend} now={now} className="col-span-2 lg:col-span-1" />
        <FindingsCard tile={tiles.findings} />
        <TileCard tile={tiles.savings} now={now} />
      </div>
    </section>
  )
}

/** No AWS account (PR2): the same four tiles' labels with "—" only; no caption or link under them. Unchanged (redesign R9). */
export function UnmeasuredKpiTiles() {
  return (
    <section aria-labelledby="infra-kpi-heading">
      <h2 id="infra-kpi-heading" className="sr-only">Summary</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(['spend', 'findings', 'savings', 'ownership'] as const).map((key) => (
          <div key={key} data-testid={`infra-tile-${key}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <h3 className="m-0 text-label uppercase tracking-[0.04em] text-slate-700">{TILE_LABELS[key]}</h3>
            <UnmeasuredValue />
          </div>
        ))}
      </div>
    </section>
  )
}
