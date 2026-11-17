'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import { RefreshCw, Rocket, Scan } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { SCAN_RUNNING_HINT, SERVICES_HEADING, SERVICES_SUBTITLE } from './ServicesHeader'
import { REDESIGN_COPY, type RedesignScanLine, type RedesignScanState } from './redesignModel'
import { TONE } from './redesignTone'

const SCAN_DOT: Record<RedesignScanState, string> = {
  finished: 'bg-[var(--fill-success)]',
  running: 'bg-blue-600 dark:bg-blue-400',
  failed: 'bg-[var(--fill-danger)]',
  none: 'bg-slate-400 dark:bg-slate-500',
}

export const SCAN_HINT_ID = 'services-scan-running-hint'

/**
 * The redesign's header (PR 3b): title and subtitle (CURRENT), the
 * Services-only scan line ("Last scan finished …", the in-progress and
 * "didn't finish" lines), the Deployments link and "Scan now", the page's only
 * primary button. + Add Service lives in Your services only (V2-61). The ref
 * is the Scan now button, which takes focus when the scan banner is dismissed.
 */
export const RedesignHeader = forwardRef<HTMLButtonElement, {
  scan: RedesignScanLine | null
  /** A local Scan now is in flight. */
  isDiscovering: boolean
  /** A scan holds the account's lease (coverage). */
  scanRunning: boolean
  onScanNow: () => void
}>(function RedesignHeader({ scan, isDiscovering, scanRunning, onScanNow }, ref) {
  const busy = isDiscovering || scanRunning
  const hint = scanRunning && !isDiscovering
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className={cn(PAGE_TITLE_CLASS, 'mb-1')}>{SERVICES_HEADING}</h1>
        <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0')}>{SERVICES_SUBTITLE}</p>
        {scan && (
          <p data-testid="services-scan-line" data-state={scan.state} role="status" className={cn('m-0 mt-1 flex items-center gap-2 text-meta', TONE.muted)}>
            <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', SCAN_DOT[scan.state])} />
            {scan.text}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/deployments" className={cn(TONE.secondaryButton, 'px-3.5 py-2 no-underline')}>
          <Rocket size={13} aria-hidden="true" /> Deployments
        </Link>
        <button
          ref={ref}
          type="button"
          onClick={onScanNow}
          disabled={busy}
          aria-describedby={hint ? SCAN_HINT_ID : undefined}
          className={cn(TONE.primaryButton, TONE.focus)}
        >
          {busy
            ? <><RefreshCw size={13} aria-hidden="true" className="animate-spin" /> {REDESIGN_COPY.scanning}</>
            : <><Scan size={13} aria-hidden="true" /> {REDESIGN_COPY.scanNow}</>}
        </button>
        {hint && <p id={SCAN_HINT_ID} className={cn('m-0 basis-full text-meta sm:text-right', TONE.muted)}>{SCAN_RUNNING_HINT}</p>}
      </div>
    </div>
  )
})
