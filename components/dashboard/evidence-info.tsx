'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Same lg breakpoint the Dashboard's multi-column rows switch at: below it the
// cards stack, and the details open as a centered dialog instead.
const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
const isDesktopNow = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches

function useIsDesktop() {
  return useSyncExternalStore(subscribe, isDesktopNow, () => false)
}

export const INFO_HEADING = 'How this is calculated'
export const INFO_TOOLTIP = 'How this number is calculated'

interface EvidenceInfoProps {
  /** The card or section this explains, e.g. "Month-to-Date Spend": the panel's subtitle. */
  about: string
  /** Accessible name of the info button; unique on the page. Defaults to "About <about>". */
  label?: string
  /** Panel heading. */
  heading?: string
  /** One-line hover/focus tooltip on the button. */
  tooltip?: string
  children: ReactNode
  /** Desktop only: which edge of the anchoring card the panel lines up with. */
  align?: 'start' | 'end'
}

/**
 * Info button plus its evidence panel, on the app's existing Radix Dialog
 * primitive (no separate popover implementation). Radix supplies
 * aria-expanded / aria-controls on the button, Escape to close, and focus
 * returning to the button. Hover or focus shows a one-line tooltip; the
 * panel opens on click/tap only. The button never navigates.
 *
 * Desktop: a non-modal panel anchored under the nearest positioned ancestor
 * (the card, or a section header marked `relative`). Below the lg breakpoint:
 * a modal dialog with an overlay, above the floating assistant button.
 */
export function EvidenceInfo({ about, label = `About ${about}`, heading = INFO_HEADING, tooltip = INFO_TOOLTIP, children, align = 'end' }: EvidenceInfoProps) {
  const [open, setOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const panelRef = useRef<HTMLDivElement>(null)

  // The desktop panel scrolls with the page under its card; bring all of it
  // on screen when it opens. Its scroll margins keep it clear of the sticky
  // nav and of the floating assistant button (fixed, bottom-right), and its
  // max height keeps it short enough to fit between them.
  useEffect(() => {
    if (!open || !isDesktop) return
    const frame = requestAnimationFrame(() => panelRef.current?.scrollIntoView?.({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [open, isDesktop])

  const body = (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <DialogPrimitive.Title className="text-sm font-semibold text-foreground m-0">{heading}</DialogPrimitive.Title>
          <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5" data-testid="evidence-info-subject">{about}</p>
        </div>
        <DialogPrimitive.Close
          aria-label="Close"
          className="inline-flex items-center justify-center w-11 h-11 -my-3 -mr-3 rounded-full text-[var(--text-secondary)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-accent)]"
        >
          <X size={16} aria-hidden="true" />
        </DialogPrimitive.Close>
      </div>
      <div className="px-4 py-3 text-xs text-[var(--text-secondary)] leading-relaxed">{children}</div>
    </>
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={!isDesktop}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogPrimitive.Trigger
              aria-label={label}
              data-testid="evidence-info-button"
              className="group inline-flex items-center justify-center w-11 h-11 -m-3 rounded-full shrink-0 cursor-pointer text-[var(--text-secondary)] focus-visible:outline-none"
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors group-hover:bg-[var(--surface-1)] group-focus-visible:bg-[var(--surface-1)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-accent)]">
                <Info size={15} aria-hidden="true" />
              </span>
            </DialogPrimitive.Trigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="z-[70]" data-testid="evidence-info-tooltip">{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {isDesktop ? (
        <DialogPrimitive.Content
          ref={panelRef}
          aria-describedby={undefined}
          className={cn(
            'absolute top-full mt-2 z-[60] w-[380px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-12rem)] overflow-y-auto scroll-mt-24 scroll-mb-24 rounded-xl border border-border bg-[var(--surface-2)] shadow-xl text-left',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {body}
        </DialogPrimitive.Content>
      ) : (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed left-4 right-4 top-1/2 -translate-y-1/2 z-[60] mx-auto max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-[var(--surface-2)] shadow-xl text-left"
          >
            {body}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  )
}

/** A labeled block inside an evidence panel. */
export function EvidenceSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h4 className="text-xs font-semibold text-foreground mb-1">{heading}</h4>
      {children}
    </section>
  )
}
