'use client'

import { useId, useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * An ⓘ button described by a role="tooltip" element (as Services' UnknownOwnerTip), so the text is
 * read on focus. It opens on hover, keyboard focus and tap; Escape closes it.
 */
export function InfoTip({ label, lines, testId }: { label: string; lines: string[]; testId?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (lines.length === 0) return null
  return (
    <span className="relative inline-flex normal-case tracking-normal" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`More about ${label}`}
        aria-describedby={id}
        data-testid={testId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        className="inline-flex items-center rounded-full text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        id={id}
        data-open={open ? 'true' : 'false'}
        className={cn(
          'absolute right-0 top-full z-20 mt-1 w-72 max-w-[80vw] whitespace-normal rounded-lg border border-border bg-popover px-3 py-2 text-meta font-normal text-popover-foreground shadow-md sm:left-0 sm:right-auto',
          open ? 'block' : 'hidden',
        )}
      >
        {lines.map((line, i) => <span key={i} className="block">{line}</span>)}
      </span>
    </span>
  )
}
