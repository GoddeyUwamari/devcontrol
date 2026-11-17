'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { REDESIGN_COPY } from './redesignModel'

/**
 * "Unknown · tags unreadable" with its explanation (V2-50): a button described
 * by a role="tooltip" element, so the text is read on focus. It opens on
 * hover, keyboard focus and tap; Escape closes it.
 */
export function UnknownOwnerTip({ label }: { label: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-label text-ink dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
      >
        {label}
        <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current leading-none">?</span>
      </button>
      <span
        role="tooltip"
        id={id}
        data-open={open ? 'true' : 'false'}
        className={cn(
          'absolute left-0 top-full z-20 mt-1 w-64 max-w-[80vw] whitespace-normal rounded-lg border border-border bg-popover px-3 py-2 text-meta text-popover-foreground shadow-md',
          open ? 'block' : 'hidden',
        )}
      >
        {REDESIGN_COPY.unknownTooltip}
      </span>
    </span>
  )
}
