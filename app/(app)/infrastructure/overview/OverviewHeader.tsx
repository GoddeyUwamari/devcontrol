'use client'

import type { ReactNode } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { RichText } from '../../services/ScanTime'
import { OVERVIEW_COPY, type HeaderStatus } from './overviewModel'

export const SCAN_RUNNING_TEXT = 'A scan is already running for this AWS account.'

export type SyncState = 'idle' | 'syncing' | 'complete'

/**
 * "AWS account connected · Home region {r} · {n of m} regions checked · {scan line}" (redesign item 1),
 * then the existing scan notes, muted. With coverage not loaded: its error and Retry, as the strip had.
 */
function StatusRow({ status, now, coverageError, onRetry }: { status: HeaderStatus | null; now: number; coverageError: boolean; onRetry: () => void }) {
  if (coverageError) {
    return (
      <div role="alert" data-testid="infra-header-status" className="flex flex-wrap items-center gap-3 pt-1">
        <p className="m-0 text-ui font-semibold text-slate-900">{OVERVIEW_COPY.coverageLoadError}</p>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-label text-slate-700">
          <RefreshCw size={12} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }
  if (!status) return null
  const { regions } = status
  const at = regions.strong ? regions.text.indexOf(regions.strong) : -1
  return (
    <div className="flex flex-col gap-1 pt-1">
      <p data-testid="infra-header-status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-600" />
          {OVERVIEW_COPY.accountConnected}
        </span>
        <span>Home region <b className="font-semibold text-slate-900">{status.home}</b></span>
        <span>
          {at >= 0 ? <>{regions.text.slice(0, at)}<b className="font-semibold text-slate-900">{regions.strong}</b>{regions.text.slice(at + regions.strong!.length)}</> : regions.text}
        </span>
        <span><RichText parts={status.lastScan} now={now} /></span>
      </p>
      {status.notes.map((parts, i) => (
        <p key={i} className="m-0 text-meta text-slate-600"><RichText parts={parts} now={now} /></p>
      ))}
    </div>
  )
}

/**
 * h1, subtitle, the status line, and Export inventory (secondary) + Scan now (primary) on one row;
 * a 2-column row on a phone. Scan now keeps the legacy page's 3-second green state (§18.1 X13):
 * "Scan finished" on desktop (PR 3d-2 D2), "Done" on a phone. `below` (the export plan notice) sits under the row.
 */
export function OverviewHeader({ status, now, coverageError = false, onRetry = () => {}, showSync, scanRunning, sync, onSync, secondary, below, altAction }: {
  status: HeaderStatus | null
  now: number
  coverageError?: boolean
  onRetry?: () => void
  showSync: boolean
  scanRunning: boolean
  sync: SyncState
  onSync: () => void
  secondary?: ReactNode
  below?: ReactNode
  /** Shown when Scan now is not (PR2): the outlined Connect AWS account, or its grey block while loading. */
  altAction?: ReactNode
}) {
  const disabled = sync === 'syncing' || scanRunning
  const green = sync === 'complete'
  const button = (phone: boolean) => (
    <button
      type="button"
      onClick={onSync}
      disabled={disabled}
      aria-describedby={scanRunning ? 'infra-scan-running' : undefined}
      className={`${phone ? 'w-full flex sm:hidden' : 'hidden sm:inline-flex'} min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-ui font-semibold border disabled:opacity-60 disabled:cursor-not-allowed ${green ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-violet-700 text-white border-violet-700 hover:bg-violet-800'}`}
    >
      {sync === 'syncing' ? <><RefreshCw size={14} className="animate-spin" aria-hidden="true" /> {OVERVIEW_COPY.scanning}</>
        : green ? <><Check size={14} aria-hidden="true" /> {phone ? 'Done' : OVERVIEW_COPY.scanFinished}</>
        : scanRunning ? <><RefreshCw size={14} aria-hidden="true" /> Scan running…</>
        : <><RefreshCw size={14} aria-hidden="true" /> {OVERVIEW_COPY.scanNow}</>}
    </button>
  )
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>{OVERVIEW_COPY.title}</h1>
          <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0')}>{OVERVIEW_COPY.subtitle}</p>
          <StatusRow status={status} now={now} coverageError={coverageError} onRetry={onRetry} />
        </div>
        {showSync && (
          <div data-testid="infra-header-actions" className="grid shrink-0 grid-cols-2 gap-3 sm:flex sm:items-center">
            {secondary}
            {button(true)}
            {button(false)}
            {scanRunning && <span id="infra-scan-running" role="status" className="sr-only">{SCAN_RUNNING_TEXT}</span>}
          </div>
        )}
        {!showSync && altAction}
      </div>
      {showSync && below}
    </header>
  )
}
