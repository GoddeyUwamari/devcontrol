'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatExact, formatWhen, type Rich } from './regionCoverage'

/**
 * A scan time in local time ("today, 4:12 PM", "yesterday, …", or a full
 * date), with the exact time in a tooltip on hover and on keyboard focus, and
 * as visually hidden text inside the <time> for screen readers (aria-label
 * isn't reliably read on <time>). `exactLine` also prints the exact time
 * below it (the phone layout, where a tooltip can't be tapped open).
 */
export function ScanTime({ iso, now, exactLine = false }: { iso: string; now: number; exactLine?: boolean }) {
  const text = formatWhen(iso, now)
  const exact = formatExact(iso)
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <time dateTime={iso} tabIndex={0} className="underline decoration-dotted underline-offset-2 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              {text}<span className="sr-only"> ({exact})</span>
            </time>
          </TooltipTrigger>
          <TooltipContent>{exact}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {exactLine && <span aria-hidden="true" className="block text-xs text-slate-500">{exact}</span>}
    </>
  )
}

/** Text with scan times in it. */
export function RichText({ parts, now }: { parts: Rich; now: number }) {
  return (
    <>
      {parts.map((part, i) => (typeof part === 'string' ? part : <ScanTime key={i} iso={part.iso} now={now} />))}
    </>
  )
}
