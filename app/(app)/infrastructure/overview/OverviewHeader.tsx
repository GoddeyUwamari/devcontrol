'use client'

import { Check, RefreshCw } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { RichText } from '../../services/ScanTime'
import type { Rich } from '../../services/regionCoverage'
import { OVERVIEW_COPY } from './overviewModel'

export const SCAN_RUNNING_TEXT = 'A scan is already running for this AWS account.'

export type SyncState = 'idle' | 'syncing' | 'complete'

/**
 * h1, subtitle, "Last scan" and Sync. The Sync button keeps the legacy page's
 * 3-second green state (§18.1 X13): "Sync Complete" on desktop, "Done" on a phone.
 */
export function OverviewHeader({ lastScan, now, showSync, scanRunning, sync, onSync }: {
  lastScan: Rich | null
  now: number
  showSync: boolean
  scanRunning: boolean
  sync: SyncState
  onSync: () => void
}) {
  const disabled = sync === 'syncing' || scanRunning
  const green = sync === 'complete'
  const button = (phone: boolean) => (
    <button
      type="button"
      onClick={onSync}
      disabled={disabled}
      aria-describedby={scanRunning ? 'infra-scan-running' : undefined}
      className={`${phone ? 'w-full flex sm:hidden' : 'hidden sm:inline-flex'} items-center justify-center gap-2 rounded-lg px-4 py-2 text-ui font-semibold border disabled:opacity-60 disabled:cursor-not-allowed ${green ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-violet-700 text-white border-violet-700 hover:bg-violet-800'}`}
    >
      {sync === 'syncing' ? <><RefreshCw size={14} className="animate-spin" aria-hidden="true" /> Syncing…</>
        : green ? <><Check size={14} aria-hidden="true" /> {phone ? 'Done' : 'Sync Complete'}</>
        : scanRunning ? <><RefreshCw size={14} aria-hidden="true" /> Scan running…</>
        : <><RefreshCw size={14} aria-hidden="true" /> Sync now</>}
    </button>
  )
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>{OVERVIEW_COPY.title}</h1>
        <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0')}>{OVERVIEW_COPY.subtitle}</p>
        {lastScan && <p className="m-0 text-meta text-slate-600"><RichText parts={lastScan} now={now} /></p>}
      </div>
      {showSync && (
        <div className="flex flex-col gap-2 sm:items-end">
          {button(true)}
          {button(false)}
          {scanRunning && <span id="infra-scan-running" role="status" className="sr-only">{SCAN_RUNNING_TEXT}</span>}
        </div>
      )}
    </header>
  )
}
