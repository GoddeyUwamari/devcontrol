/*
 * Status glyphs: Tabler Icons (filled), https://tabler.io/icons, version 3.45.0.
 *
 * MIT License
 *
 * Copyright (c) 2020-2026 Paweł Kuna
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Status icons (dashboard-step1 §D, DB-D14): bold, filled, single-colour knockout glyphs.
 * The inner mark is cut out of the shape, so it shows the surface underneath in light and dark.
 *
 * A status icon is never the only signal: use StatusLabel (icon + text), or StatusIcon next to
 * text that says the status (it is then aria-hidden), or give a standalone StatusIcon an
 * aria-label. Outline icons stay for navigation and neutral UI; trend arrows only for real trends.
 */
export type StatusKind = 'success' | 'warning' | 'info' | 'error' | 'security'

/** Each glyph's name is the Tabler filled icon it is copied from: @tabler/icons icons/filled/<name>.svg. */
export type StatusGlyph = 'circle-check' | 'alert-triangle' | 'info-circle' | 'alert-circle' | 'circle-x' | 'shield-check'

export const STATUS_GLYPH_PATHS: Record<StatusGlyph, string> = {
  'circle-check': 'M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z',
  'alert-triangle': 'M12 1.67c.955 0 1.845 .467 2.39 1.247l.105 .16l8.114 13.548a2.914 2.914 0 0 1 -2.307 4.363l-.195 .008h-16.225a2.914 2.914 0 0 1 -2.582 -4.2l.099 -.185l8.11 -13.538a2.914 2.914 0 0 1 2.491 -1.403zm.01 13.33l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -7a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z',
  'info-circle': 'M12 2c5.523 0 10 4.477 10 10a10 10 0 0 1 -19.995 .324l-.005 -.324l.004 -.28c.148 -5.393 4.566 -9.72 9.996 -9.72zm0 9h-1l-.117 .007a1 1 0 0 0 0 1.986l.117 .007v3l.007 .117a1 1 0 0 0 .876 .876l.117 .007h1l.117 -.007a1 1 0 0 0 .876 -.876l.007 -.117l-.007 -.117a1 1 0 0 0 -.764 -.857l-.112 -.02l-.117 -.006v-3l-.007 -.117a1 1 0 0 0 -.876 -.876l-.117 -.007zm.01 -3l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007z',
  'alert-circle': 'M12 2c5.523 0 10 4.477 10 10a10 10 0 0 1 -19.995 .324l-.005 -.324l.004 -.28c.148 -5.393 4.566 -9.72 9.996 -9.72zm.01 13l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -8a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z',
  'circle-x': 'M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-6.489 5.8a1 1 0 0 0 -1.218 1.567l1.292 1.293l-1.292 1.293l-.083 .094a1 1 0 0 0 1.497 1.32l1.293 -1.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -1.497l-1.292 -1.293l1.292 -1.293l.083 -.094a1 1 0 0 0 -1.497 -1.32l-1.293 1.292l-1.293 -1.292l-.094 -.083z',
  'shield-check': 'M11.998 2l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021l.115 -.007zm3.71 7.293a1 1 0 0 0 -1.415 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z',
}

/** The fill colour of each kind: existing tokens from app/globals.css, light and dark. */
export const STATUS_FILL_TOKEN: Record<StatusKind, string> = {
  success: '--fill-success',
  warning: '--fill-warning',
  info: '--text-accent',
  error: '--fill-danger',
  security: '--text-accent',
}

/** The status tint each kind sits on when it is placed on a tinted card or chip (--bg-*). */
export const STATUS_TINT_TOKEN: Record<StatusKind, string> = {
  success: '--bg-success',
  warning: '--bg-warning',
  info: '--bg-accent',
  error: '--bg-danger',
  security: '--bg-accent',
}

/**
 * The fill on that tint, light and dark (PR-ICONS-b, founder ruling 1). Warning's own fill is
 * under 3:1 on --bg-warning in light mode, so it takes the -strong warning ink that text on that
 * tint uses (evidence-badge toneText). That ink has no dark value and is under 3:1 on the dark
 * tint, so in dark mode warning keeps its own fill, which passes there. No new colour token.
 */
export const STATUS_ON_TINT_FILL_TOKEN: Record<StatusKind, { light: string; dark: string }> = {
  success: { light: '--fill-success', dark: '--fill-success' },
  warning: { light: '--app-color-ink-warning-strong', dark: '--fill-warning' },
  info: { light: '--text-accent', dark: '--text-accent' },
  error: { light: '--fill-danger', dark: '--fill-danger' },
  security: { light: '--text-accent', dark: '--text-accent' },
}

/** Literal class strings (so Tailwind generates them) for the kinds whose on-tint fill differs. */
export const ON_TINT_FILL_CLASS: Partial<Record<StatusKind, string>> = {
  warning: 'fill-[var(--app-color-ink-warning-strong)] dark:fill-[var(--fill-warning)]',
}

export function statusGlyph(kind: StatusKind, variant?: 'x'): StatusGlyph {
  switch (kind) {
    case 'success': return 'circle-check'
    case 'warning': return 'alert-triangle'
    case 'info': return 'info-circle'
    case 'error': return variant === 'x' ? 'circle-x' : 'alert-circle'
    case 'security': return 'shield-check'
  }
}

type KindProps =
  | { kind: Exclude<StatusKind, 'error'>; variant?: never }
  | { kind: 'error'; /** Circle-× instead of circle-!. */ variant?: 'x' }

export type StatusIconProps = KindProps & {
  size?: number
  className?: string
  /** Only for a standalone icon with no text next to it. Without it the icon is aria-hidden. */
  'aria-label'?: string
  /** The icon sits on its kind's status tint (STATUS_TINT_TOKEN): use the on-tint fill. */
  onTint?: boolean
  'data-testid'?: string
}

export function StatusIcon({ kind, variant, size = 16, className, 'aria-label': ariaLabel, onTint = false, 'data-testid': testId }: StatusIconProps) {
  const glyph = statusGlyph(kind, variant)
  const a11y = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true as const }
  const tintClass = onTint ? ON_TINT_FILL_CLASS[kind] : undefined
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      focusable="false"
      className={cn('shrink-0', tintClass, className)}
      // A class fill (light and dark) when the on-tint fill differs; else the token inline.
      style={tintClass ? undefined : { fill: `var(${STATUS_FILL_TOKEN[kind]})` }}
      data-status-kind={kind}
      data-on-tint={onTint ? 'true' : undefined}
      data-glyph={glyph}
      data-testid={testId}
      {...a11y}
    >
      <path d={STATUS_GLYPH_PATHS[glyph]} />
    </svg>
  )
}

export type StatusLabelProps = KindProps & {
  children: ReactNode
  size?: number
  className?: string
  /** The label sits on its kind's status tint: the icon uses the on-tint fill. */
  onTint?: boolean
  'data-testid'?: string
}

/** Icon + text: the default way to show a status. The text is the accessible name; the icon is aria-hidden. */
export function StatusLabel({ kind, variant, children, size = 14, className, onTint = false, 'data-testid': testId }: StatusLabelProps) {
  const icon = kind === 'error'
    ? <StatusIcon kind="error" variant={variant} size={size} onTint={onTint} />
    : <StatusIcon kind={kind} size={size} onTint={onTint} />
  return (
    <span className={cn('inline-flex items-center gap-1', className)} data-testid={testId}>
      {icon}
      <span>{children}</span>
    </span>
  )
}
