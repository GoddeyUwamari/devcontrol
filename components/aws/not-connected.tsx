import Link from 'next/link'
import { CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The not-connected (no AWS account) state's shared parts (PR2 empty states; PR3 reuses them).
 * Shown only when the server says no account is connected: never while that is loading or unknown.
 */

export const CONNECT_AWS_HREF = '/connect-aws'
export const NOT_CONNECTED_HEADING = 'No AWS account connected'
export const CONNECT_AWS_ACCOUNT = 'Connect AWS account'
/** An unmeasured metric. A real zero is never shown this way. */
export const UNMEASURED = '—'

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-ui font-semibold no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600'

/** Full content width: icon, the heading and one filled button. No other sentence. */
export function NotConnectedCard({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="not-connected-heading"
      data-testid="not-connected-card"
      className={cn('flex w-full flex-col items-center gap-3 rounded-xl border border-border bg-card px-5 py-10 text-center', className)}
    >
      <CloudOff size={20} className="text-ink-muted" aria-hidden="true" />
      <h2 id="not-connected-heading" className="m-0 text-section text-ink">{NOT_CONNECTED_HEADING}</h2>
      <Link href={CONNECT_AWS_HREF} data-testid="not-connected-card-button" className={cn(BUTTON, 'bg-violet-700 text-white hover:bg-violet-800')}>
        {CONNECT_AWS_ACCOUNT}
      </Link>
    </section>
  )
}

/** In a page header, in place of Scan now / Optimize Now / Run cost analysis. Outlined. */
export function ConnectAwsHeaderButton({ className }: { className?: string }) {
  return (
    <Link
      href={CONNECT_AWS_HREF}
      data-testid="connect-aws-header-button"
      className={cn(BUTTON, 'w-full border border-violet-700 bg-card text-ink-accent hover:bg-violet-50 sm:w-auto', className)}
    >
      {CONNECT_AWS_ACCOUNT}
    </Link>
  )
}

/** An unmeasured metric's value: "—" in grey. Nothing goes under it. */
export function UnmeasuredValue({ className }: { className?: string }) {
  return (
    <p data-testid="unmeasured-value" className={cn('m-0 text-kpi tabular-nums leading-none text-ink-muted', className)}>
      <span aria-hidden="true">{UNMEASURED}</span>
      <span className="sr-only">Not measured</span>
    </p>
  )
}

/** Each page's tile row at its own size: Cost Optimization 3, Costs / Infrastructure / Security 4, Services 5. */
const TILE_GRID: Record<3 | 4 | 5, string> = {
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
}

/** Until the page knows connected vs not: neutral grey blocks only (no text, cards, plan locks or claims). */
export function NotConnectedLoading({ tiles, className }: { tiles: 3 | 4 | 5; className?: string }) {
  return (
    <div data-testid="connection-loading" aria-busy="true" className={cn('flex w-full flex-col gap-4', className)}>
      <div data-testid="connection-loading-tiles" className={cn('grid gap-4', TILE_GRID[tiles])}>
        {Array.from({ length: tiles }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

/** The header action's place while loading: a grey block, no button. */
export function HeaderActionLoading() {
  return <Skeleton data-testid="header-action-loading" className="h-11 w-full rounded-lg sm:w-44" />
}
