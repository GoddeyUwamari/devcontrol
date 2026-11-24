import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared visual parts of the Integrations index and the GitHub page (D8b-1),
 * drawn from the locked mock on the app's type and ink tokens.
 */

export const CARD = 'rounded-xl border border-border bg-card'

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-ui font-semibold no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:cursor-not-allowed'
/** Filled (Connect GitHub, Sign in). */
export const BUTTON_PRIMARY = cn(BUTTON_BASE, 'bg-violet-700 text-white hover:bg-violet-800 disabled:bg-slate-300 disabled:text-ink-body')
/** Outlined accent (Record a deployment, Try again, Connect GitHub on a failure card). */
export const BUTTON_OUTLINE = cn(BUTTON_BASE, 'border border-violet-200 bg-card text-ink-accent hover:bg-violet-50 disabled:border-slate-200 disabled:text-ink-muted')
/** Outlined neutral (Manage on GitHub, Cancel). */
export const BUTTON_NEUTRAL = cn(BUTTON_BASE, 'border border-border bg-card text-ink hover:bg-slate-50 disabled:text-ink-muted')
/** Outlined danger (the Disconnect row). */
export const BUTTON_DANGER_OUTLINE = cn(BUTTON_BASE, 'border border-red-200 bg-card text-ink-danger hover:bg-red-50 disabled:border-slate-200 disabled:text-ink-muted')
/** Filled danger (the dialog's Disconnect). */
export const BUTTON_DANGER = cn(BUTTON_BASE, 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-300 disabled:text-ink-body')
/** A text link with a 44 px target (→ links). */
export const TEXT_LINK = 'inline-flex min-h-11 items-center self-start text-ui font-semibold text-ink-accent no-underline hover:text-violet-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 rounded'

export type ChipTone = 'success' | 'neutral' | 'warning' | 'accent'

const CHIP_TONE: Record<ChipTone, string> = {
  success: 'border-green-200 bg-green-50 text-ink-success-strong',
  neutral: 'border-border bg-slate-100 text-ink-muted',
  warning: 'border-amber-200 bg-amber-50 text-ink-warning-strong',
  accent: 'border-violet-200 bg-violet-50 text-ink-accent',
}

export function Chip({ tone, children, testId }: { tone: ChipTone; children: React.ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-label', CHIP_TONE[tone])}>
      {children}
    </span>
  )
}

/** Title + subtitle, with an optional action on the right (board 5's "Manage on GitHub ↗"). */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-title text-ink">{title}</h1>
        <p className="m-0 text-subtitle text-ink-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

export type BannerTone = 'success' | 'warning' | 'danger'

const BANNER_TONE: Record<BannerTone, { box: string; title: string; body: string }> = {
  success: { box: 'border-green-200 border-l-green-600 bg-green-50', title: 'text-green-900', body: 'text-ink-success-strong' },
  warning: { box: 'border-amber-200 border-l-amber-600 bg-amber-50', title: 'text-amber-900', body: 'text-ink-warning-strong' },
  danger: { box: 'border-red-200 border-l-red-600 bg-red-50', title: 'text-red-900', body: 'text-ink-danger-strong' },
}

/** Board 4's success banner and board 6's problem banners: icon, title, body, then an action. */
export function Banner({
  tone, icon, title, children, action, onDismiss, testId,
}: {
  tone: BannerTone
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  action?: React.ReactNode
  onDismiss?: () => void
  testId?: string
}) {
  const t = BANNER_TONE[tone]
  return (
    <div data-testid={testId} role={tone === 'success' ? 'status' : undefined} className={cn('flex items-start gap-3 rounded-lg border border-l-4 px-4 py-3.5', t.box)}>
      <span className={cn('mt-px flex-none', t.title)} aria-hidden="true">{icon}</span>
      <div className="flex flex-1 flex-col gap-1">
        <p className={cn('m-0 text-ui font-semibold', t.title)}>{title}</p>
        <div className={cn('m-0 text-ui', t.body)}>{children}</div>
        {action}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={cn('flex h-8 w-8 flex-none items-center justify-center rounded text-section focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600', t.title)}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** A banner's underlined link (Review on GitHub ↗, Unsuspend on GitHub ↗). */
export function BannerLink({ href, children, tone }: { href: string; children: React.ReactNode; tone: BannerTone }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex min-h-11 items-center self-start text-ui font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 rounded', BANNER_TONE[tone].body)}
    >
      {children}
    </a>
  )
}

/**
 * One board 4 outcome card. The mock's small capital tag names the case for the
 * reviewer; on the live screen the heading says it, so the tag is not shown.
 */
export function OutcomeCard({
  title, children, action, testId, live,
}: {
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  testId: string
  /** Announced to screen readers when it appears (progress and results). */
  live?: boolean
}) {
  return (
    <section data-testid={testId} aria-live={live ? 'polite' : undefined} className={cn(CARD, 'flex flex-col gap-2.5 p-6')}>
      <h2 className="m-0 text-section text-ink">{title}</h2>
      {children && <div className="m-0 text-ui text-ink-muted">{children}</div>}
      {action}
    </section>
  )
}

/** Grey blocks only while the connection loads: no buttons, so nothing flashes "Connect" before the real state. */
export function LoadingBlocks({ testId = 'github-loading', lines = 3 }: { testId?: string; lines?: number }) {
  const widths = ['w-2/5', 'w-[70%]', 'w-[55%]', 'w-1/2']
  return (
    <div data-testid={testId} aria-busy="true" className={cn(CARD, 'flex flex-col gap-2.5 px-6 py-5')}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn('h-3.5 rounded-md', widths[i % widths.length])} />)}
    </div>
  )
}

export function ArrowLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return <Link href={href} data-testid={testId} className={TEXT_LINK}>{children}</Link>
}
