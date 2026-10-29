import type { Tone } from './operationalHealthModel'

/** Tone classes shared by the banner, pills and bars (as SEC/overview/StatusBanner.tsx). Colour never carries meaning alone. */
export const BANNER_TONE: Record<Tone, string> = {
  danger: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  success: 'border-green-200 bg-green-50',
  neutral: 'border-slate-200 bg-white',
}

export const HEADLINE_INK: Record<Tone, string> = {
  danger: 'text-ink-danger-strong',
  warning: 'text-ink-warning-strong',
  success: 'text-ink-success-strong',
  neutral: 'text-ink',
}

export const DOT: Record<Tone, string> = {
  danger: 'bg-red-600',
  warning: 'bg-amber-500',
  success: 'bg-emerald-600',
  neutral: 'bg-slate-400',
}

export const PILL: Record<Tone, string> = {
  danger: 'border-red-200 bg-red-50 text-ink-danger-strong',
  warning: 'border-amber-200 bg-amber-50 text-ink-warning-strong',
  success: 'border-green-200 bg-green-50 text-ink-success-strong',
  neutral: 'border-slate-200 bg-slate-50 text-ink-muted',
}

export const BAR: Record<Tone, string> = {
  danger: 'bg-red-600',
  warning: 'bg-amber-500',
  success: 'bg-emerald-600',
  neutral: 'bg-slate-400',
}

export const BUTTON =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-ui font-semibold text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600'
export const LINK = 'inline-flex min-h-11 w-fit items-center text-ui font-semibold text-ink-accent hover:underline'
