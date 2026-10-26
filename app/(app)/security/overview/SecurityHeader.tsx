'use client'

import { RefreshCw } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { ScanLine, ScanLineState } from './securityModel'
import { PAGE_COPY } from './securityCopy'

/** The dot is decorative (aria-hidden); the line's text carries the meaning (founder answer 12). */
const DOT: Record<ScanLineState, string> = {
  finished: 'bg-emerald-600',
  running: 'bg-blue-600',
  failed: 'bg-red-600',
  none: 'bg-slate-400',
}

/** Title and subtitle left; the scan line and Sync now right (founder answer 1). */
export function SecurityHeader({ scan, syncing, canSync, blockedReason, onSync }: {
  scan: ScanLine | null
  syncing: boolean
  canSync: boolean
  blockedReason: string | null
  onSync: () => void
}) {
  const running = scan?.state === 'running'
  const disabled = syncing || running || !canSync
  const describedBy = [running ? 'security-scan-line' : null, blockedReason ? 'security-sync-reason' : null].filter(Boolean).join(' ') || undefined
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>{PAGE_COPY.title}</h1>
        <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0')}>{PAGE_COPY.subtitle}</p>
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        {scan && (
          <p id="security-scan-line" data-testid="security-scan-line" data-state={scan.state} className="m-0 flex items-center gap-2 text-meta text-ink-muted">
            <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', DOT[scan.state])} />
            {scan.text}
          </p>
        )}
        <button
          type="button"
          onClick={onSync}
          disabled={disabled}
          aria-describedby={describedBy}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-violet-700 bg-violet-700 px-4 text-ui font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-ink-muted sm:w-auto"
        >
          <RefreshCw size={14} aria-hidden="true" className={syncing ? 'animate-spin' : undefined} />
          {syncing ? PAGE_COPY.syncing : PAGE_COPY.syncNow}
        </button>
        {blockedReason && <p id="security-sync-reason" className="m-0 text-meta text-ink-muted">{blockedReason}</p>}
      </div>
    </header>
  )
}
