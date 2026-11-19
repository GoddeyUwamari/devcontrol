/**
 * Where the top toasts sit (founder rule, Cost Optimization tidy round 3): just
 * below the app's sticky top nav, never over it, and never over a page banner
 * marked TOAST_CLEAR_ATTR that is showing right under the nav (the Cost
 * Optimization result banner). Once that banner has scrolled under the nav the
 * toasts sit just below the nav again.
 *
 * The app layout (app/(app)/layout.tsx, useToastClearance) writes the result
 * to TOAST_TOP_VAR on <html>; the Toaster (app/layout.tsx) reads it with a
 * fallback, so pages outside the app shell keep sonner's own offset.
 *
 * No imports on purpose: the screenshot harness runs this exact function in a
 * real browser.
 */

/** Marks an element a toast must not cover while it sits right under the nav. */
export const TOAST_CLEAR_ATTR = 'data-toast-clear'

/** The CSS variable the Toaster's top offset reads. */
export const TOAST_TOP_VAR = '--app-toast-top'

/** Space between the nav (or a marked banner) and the toast. */
export const TOAST_GAP = 12

/** A toast's height plus its gap: a marked element starting within this band below the line would be covered. */
export const TOAST_BAND = 72

type Rect = { top: number; bottom: number; height: number }

/**
 * The toast's top, in viewport pixels: the bottom of the nav, pushed down past
 * any marked element the toast would otherwise sit on, plus TOAST_GAP.
 */
export function toastTop(header: { getBoundingClientRect(): Rect } | null, marked: readonly { getBoundingClientRect(): Rect }[]): number {
  let line = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0
  const rects = marked.map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).sort((a, b) => a.top - b.top)
  for (const r of rects) {
    if (r.bottom > line && r.top < line + TOAST_BAND) line = r.bottom
  }
  return Math.round(line + TOAST_GAP)
}

/** Writes toastTop() for this document to TOAST_TOP_VAR on <html>. */
export function applyToastTop(header: Element | null, doc: Document = document): number {
  const top = toastTop(header, Array.from(doc.querySelectorAll(`[${TOAST_CLEAR_ATTR}]`)))
  doc.documentElement.style.setProperty(TOAST_TOP_VAR, `${top}px`)
  return top
}
