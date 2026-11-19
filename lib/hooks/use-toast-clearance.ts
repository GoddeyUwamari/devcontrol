import { useEffect, type RefObject } from 'react'
import { TOAST_TOP_VAR, applyToastTop } from '@/lib/toast-clearance'

/**
 * Keeps the top toasts just below the app's sticky header (and below a marked
 * page banner showing under it): recomputes on scroll, resize and any layout
 * change (breadcrumbs appearing, the banner closing). See lib/toast-clearance.ts.
 */
export function useToastClearance(header: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      applyToastTop(header.current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(document.body)
    if (header.current) resize?.observe(header.current)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      resize?.disconnect()
      document.documentElement.style.removeProperty(TOAST_TOP_VAR)
    }
  }, [header])
}
