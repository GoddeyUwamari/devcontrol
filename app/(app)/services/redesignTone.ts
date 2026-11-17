/**
 * The Services redesign's colour classes, in one place (PR 3b). Surfaces and
 * borders are the theme tokens (bg-card, border-border), which have dark
 * values; text is the app's ink tokens with a dark: pair, because the ink
 * tokens have no dark value yet (dark mode isn't switched on anywhere; it is
 * tested by forcing `.dark`). Status tints are the semantic tokens
 * (--bg-success, --border-warning, …), which do. Violet only where rule 15
 * allows it: Scan now, links, the Home badge, the section accent.
 *
 * No new component of the redesign uses a fixed light class (a white
 * background, slate or gray text) outside a dark: variant (services-redesign-static.test.ts).
 */
export const TONE = {
  card: 'rounded-xl border border-border bg-card text-card-foreground',
  divider: 'border-border',
  subtle: 'bg-muted',
  ink: 'text-ink dark:text-slate-100',
  body: 'text-ink-body dark:text-slate-200',
  muted: 'text-ink-muted dark:text-slate-400',
  link: 'text-ink-accent hover:underline dark:text-violet-300',
  success: 'text-ink-success dark:text-green-400',
  warning: 'text-ink-warning-strong dark:text-amber-300',
  danger: 'text-ink-danger dark:text-red-400',
  info: 'text-ink-info dark:text-blue-300',
  accentHeading: 'border-l-2 border-[var(--border-accent)] pl-2',
  primaryButton: 'inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3.5 py-2 text-label text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-400 dark:bg-violet-600 dark:hover:bg-violet-500 dark:disabled:bg-violet-800',
  secondaryButton: 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-label text-ink hover:bg-muted disabled:cursor-not-allowed disabled:text-ink-muted dark:text-slate-100',
  homeBadge: 'ml-1.5 rounded bg-[var(--bg-accent)] px-1.5 py-0.5 text-label text-ink-accent dark:text-violet-300',
  mono: 'font-mono',
  focus: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600',
} as const

/** Banner and note surfaces by tone. */
export const SURFACE = {
  success: 'border-[var(--border-success)] bg-[var(--bg-success)]',
  warning: 'border-[var(--border-warning)] bg-[var(--bg-warning)]',
  danger: 'border-[var(--border-danger)] bg-[var(--bg-danger)]',
  info: 'border-border bg-muted',
  neutral: 'border-border bg-card',
} as const

/** Status dots (aria-hidden; the label carries the meaning). */
export const DOT = {
  complete: 'bg-[var(--fill-success)]',
  partial: 'bg-[var(--fill-warning)]',
  scanning: 'bg-blue-600 dark:bg-blue-400',
  waiting: 'border-[1.5px] border-blue-600 bg-transparent dark:border-blue-400',
  couldnt: 'bg-[var(--fill-danger)]',
  notdone: 'bg-[var(--fill-warning)]',
  not_scanned: 'border-[1.5px] border-slate-500 bg-transparent dark:border-slate-400',
  not_enabled: 'h-0.5 rounded-none bg-slate-500 dark:bg-slate-400',
} as const

/** The status label's ink by status. */
export const STATUS_INK = {
  complete: TONE.ink,
  partial: TONE.warning,
  scanning: TONE.info,
  waiting: TONE.info,
  couldnt: TONE.danger,
  notdone: TONE.warning,
  not_scanned: TONE.muted,
  not_enabled: TONE.muted,
} as const
