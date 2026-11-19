import type { ToasterProps } from 'sonner'

/**
 * Where every toast in the app appears (founder rule, Cost Optimization tidy):
 * at the top of the screen, never bottom-right. The one Toaster
 * (app/layout.tsx) reads it. The floating AI assistant button (bottom-right)
 * and the Live updates pill (bottom-left) keep their places.
 */
export const TOAST_POSITION: NonNullable<ToasterProps['position']> = 'top-center'
