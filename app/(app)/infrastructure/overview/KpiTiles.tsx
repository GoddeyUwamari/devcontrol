'use client'

import Link from 'next/link'
import { RichText } from '../../services/ScanTime'
import type { FindingsTile, OverviewView, Tile } from './overviewModel'

function Captions({ captions, now }: { captions: Tile['captions']; now: number }) {
  return (
    <>
      {captions.map((parts, i) => <p key={i} className="m-0 text-meta text-slate-600"><RichText parts={parts} now={now} /></p>)}
    </>
  )
}

function TileCard({ tile, now }: { tile: Tile; now: number }) {
  return (
    <div data-testid={`infra-tile-${tile.key}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="m-0 text-label uppercase tracking-[0.04em] text-slate-700">{tile.label}</h3>
      <p className="m-0 text-kpi tabular-nums text-slate-900">{tile.value}</p>
      <Captions captions={tile.captions} now={now} />
      {tile.link && <Link href={tile.link.href} className="mt-auto text-ui font-semibold text-violet-700 hover:underline">{tile.link.text}</Link>}
    </div>
  )
}

/** Two labelled numbers, never added together (Q-R1). */
function FindingsCard({ tile, now }: { tile: FindingsTile; now: number }) {
  return (
    <div data-testid="infra-tile-findings" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="m-0 text-label uppercase tracking-[0.04em] text-slate-700">{tile.label}</h3>
      <dl className="m-0 flex flex-col gap-3">
        {tile.sources.map((s) => (
          <div key={s.key} data-testid={`infra-findings-${s.key}`}>
            <dt className="text-label text-slate-600">{s.label}</dt>
            <dd className="m-0">
              <span className="text-kpi tabular-nums text-slate-900">{s.value}</span>
              {s.breakdown && <span className="block text-meta text-slate-600">{s.breakdown}</span>}
              {s.note && <span className="block text-meta text-slate-600">{s.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <Captions captions={tile.captions} now={now} />
    </div>
  )
}

/** Spend this month · Open findings · Possible savings · Owned resources. */
export function KpiTiles({ tiles, now }: { tiles: NonNullable<OverviewView['tiles']>; now: number }) {
  return (
    <section aria-labelledby="infra-kpi-heading">
      <h2 id="infra-kpi-heading" className="sr-only">Summary</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TileCard tile={tiles.spend} now={now} />
        <FindingsCard tile={tiles.findings} now={now} />
        <TileCard tile={tiles.savings} now={now} />
        <TileCard tile={tiles.ownership} now={now} />
      </div>
    </section>
  )
}
