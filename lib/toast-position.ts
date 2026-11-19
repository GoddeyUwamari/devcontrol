import type { ToasterProps } from 'sonner'
import { TOAST_TOP_VAR } from './toast-clearance'

/**
 * Where every toast in the app appears (founder rule, Cost Optimization tidy):
 * at the top of the screen, never bottom-right. The one Toaster
 * (app/layout.tsx) reads it. The floating AI assistant button (bottom-right)
 * and the Live updates pill (bottom-left) keep their places.
 */
export const TOAST_POSITION: NonNullable<ToasterProps['position']> = 'top-center'

/**
 * Its top offset (round 3): just below the app's sticky nav and any page banner
 * under it (lib/toast-clearance.ts). Outside the app shell the variable is
 * unset and sonner's own offsets (24px, 16px on phones) apply.
 */
export const TOAST_OFFSET: NonNullable<ToasterProps['offset']> = { top: `var(${TOAST_TOP_VAR}, 24px)` }
export const TOAST_MOBILE_OFFSET: NonNullable<ToasterProps['mobileOffset']> = { top: `var(${TOAST_TOP_VAR}, 16px)` }
