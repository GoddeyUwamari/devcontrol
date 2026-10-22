'use client'

import Link from 'next/link'
import { RefreshCw, Check, Scan, Rocket } from 'lucide-react'
import { AddServiceButton } from './AddServiceButton'

// The page heading; the navigation label stays "Services".
export const SERVICES_HEADING = 'Services & Ownership'
export const SERVICES_SUBTITLE = "What we found, what needs attention, who owns it, and what we haven't verified yet."

/**
 * Title, subtitle (Q1) and the page actions: a plain Deployments link (Q2, the
 * old Deployments card), Auto Discover with today's states, + Add Service (Q10).
 */
export const SCAN_RUNNING_HINT = 'A scan is already running for this AWS account.'

export function ServicesHeader({ isDiscovering, discoveryComplete, discoveryMsg, onAutoDiscover, scanRunning = false }: {
  isDiscovering: boolean
  discoveryComplete: boolean
  discoveryMsg: string | null
  onAutoDiscover: () => void
  /** A discovery scan holds the account's lease (coverage scan_in_progress, M6 only). */
  scanRunning?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">{SERVICES_HEADING}</h1>
        <p className="text-sm text-slate-600 font-medium leading-relaxed m-0">{SERVICES_SUBTITLE}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/deployments"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 no-underline hover:border-slate-300"
        >
          <Rocket size={13} aria-hidden="true" /> Deployments
        </Link>
        <button
          type="button"
          onClick={onAutoDiscover}
          disabled={isDiscovering || scanRunning}
          aria-describedby={scanRunning && !isDiscovering ? 'scan-running-hint' : undefined}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
            discoveryComplete
              ? 'bg-green-700 text-white border-green-700'
              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
          } ${isDiscovering || scanRunning ? 'cursor-not-allowed opacity-70' : ''}`}
        >
          {isDiscovering
            ? <><RefreshCw size={13} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</>
            : scanRunning
              ? <><RefreshCw size={13} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} /> Scan running…</>
            : discoveryComplete
              ? <><Check size={13} aria-hidden="true" /> {discoveryMsg ?? 'Complete'}</>
              : <><Scan size={13} aria-hidden="true" /> Auto Discover</>
          }
        </button>
        {scanRunning && !isDiscovering && <span id="scan-running-hint" className="sr-only">{SCAN_RUNNING_HINT}</span>}
        <AddServiceButton />
      </div>
    </div>
  )
}
