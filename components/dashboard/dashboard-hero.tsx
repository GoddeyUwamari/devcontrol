import type { CSSProperties } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Plug } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { ConnectionHealthState } from '@/lib/services/aws-accounts.service'

/** See app/(app)/dashboard/dashboardAwsConnection.ts. */
type AwsConnection = 'connected' | 'unconnected' | 'unknown' | 'loading'

interface DashboardHeroProps {
  awsConnection: AwsConnection
  /** Only an owner can connect AWS, so only an owner gets the pill as a link. */
  canConnectAws: boolean
  /**
   * The connection's health (GET /api/aws/accounts `connection.health`, AWS connect PR D1). null
   * or absent: a server from before D1, or a health that couldn't be read; the pill is then as before.
   */
  awsHealth?: ConnectionHealthState | null
  orgName: string
  /** Only ever a genuinely authoritative sync timestamp (e.g. the fixed demo timestamp) — never a page-load Date. */
  lastSynced: Date | null
  /**
   * "Last scan: <time> · Last login: <time>" (dashboardFreshness.ts headerStatusLine),
   * under the organization name; null or absent renders no line.
   */
  statusLine?: string | null
}

const PILL = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label font-semibold whitespace-nowrap'

/** The connected pill when health isn't ok (D2, D3). */
const AMBER = { background: 'var(--bg-warning)', borderColor: 'var(--border-warning)', color: 'var(--app-color-ink-warning-strong)' }
const HEALTH_PILLS: Record<Exclude<ConnectionHealthState, 'ok'>, { dataState: string; srText: string; style?: CSSProperties; className: string; dot: string }> = {
  failing: { dataState: 'failing', srText: 'connection failing', style: AMBER, className: '', dot: 'var(--fill-warning)' },
  lost: { dataState: 'lost', srText: 'connection lost', style: AMBER, className: '', dot: 'var(--fill-warning)' },
  not_checked_recently: { dataState: 'not-checked', srText: 'connection not checked recently', className: 'border-border bg-transparent text-ink-muted hover:bg-[var(--bg-accent)]', dot: 'currentColor' },
  not_checked_yet: { dataState: 'not-checked', srText: 'connection not checked recently', className: 'border-border bg-transparent text-ink-muted hover:bg-[var(--bg-accent)]', dot: 'currentColor' },
}

/**
 * Cloud providers as one row of pills. AWS is connected or not, from the
 * page's connection state; "not connected" is the way to connect. While that
 * state is loading, or could not be determined, there is no AWS pill at all
 * rather than a guess either way. Only an owner can connect, so for anyone
 * else the pill states the fact instead ("AWS not connected") as plain text:
 * not a link, not focusable.
 * There is no syncing pill: the page loads only the latest discovery jobs,
 * which cannot show that no discovery has ever completed. GCP and Azure are
 * not available yet and are not interactive.
 *
 * Connected, the pill follows the connection's health (D1-D11): green only
 * when health is ok (the server's "ok" is always fresh); amber for failing or
 * lost and neutral for not checked recently or not checked yet, both linking
 * to /connect-aws, where any member can see the connection. Without a health
 * (a server from before D1) it stays green, as before.
 */
export function ProviderPills({ awsConnection, canConnectAws, awsHealth = null }: { awsConnection: AwsConnection; canConnectAws: boolean; awsHealth?: ConnectionHealthState | null }) {
  const unhealthy = awsConnection === 'connected' && awsHealth !== null && awsHealth !== 'ok' ? HEALTH_PILLS[awsHealth] : null
  return (
    <div className="flex flex-nowrap items-center gap-2" data-testid="provider-pills">
      {unhealthy ? (
        <Link
          href="/connect-aws"
          className={`${PILL} border no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-accent)] ${unhealthy.className}`}
          style={unhealthy.style}
          data-testid="provider-pill-aws"
          data-state={unhealthy.dataState}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: unhealthy.dot }} aria-hidden="true" />
          AWS
          <span className="sr-only">{unhealthy.srText}</span>
        </Link>
      ) : awsConnection === 'connected' ? (
        <span
          className={`${PILL} border`}
          style={{ background: 'var(--bg-success)', borderColor: 'var(--border-success)', color: 'var(--app-color-ink-success-strong)' }}
          data-testid="provider-pill-aws"
          data-state="connected"
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--fill-success)' }} aria-hidden="true" />
          AWS
          <span className="sr-only">connected</span>
        </span>
      ) : awsConnection === 'unconnected' && (canConnectAws ? (
        <Link
          href="/connect-aws"
          className={`${PILL} border no-underline transition-colors hover:bg-[var(--bg-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-accent)]`}
          style={{ borderColor: 'var(--border-accent)', color: 'var(--text-accent)' }}
          data-testid="provider-pill-aws"
          data-state="not-connected"
        >
          <Plug size={12} aria-hidden="true" />
          Connect AWS
        </Link>
      ) : (
        <span
          className={`${PILL} border border-border bg-transparent text-ink-muted cursor-default`}
          data-testid="provider-pill-aws"
          data-state="not-connected"
        >
          <Plug size={12} aria-hidden="true" />
          AWS not connected
        </span>
      ))}
      {['GCP', 'Azure'].map((name) => (
        <span
          key={name}
          className={`${PILL} border border-dashed border-border bg-transparent text-ink-muted cursor-default`}
          data-testid={`provider-pill-${name.toLowerCase()}`}
        >
          {name} soon
        </span>
      ))}
    </div>
  )
}

/**
 * Page hero: title, truthful supporting copy, and the provider pills (right
 * of the title on desktop, one row below it on narrow screens). The sub-copy
 * is the organization's name in every state, then the last scan and the
 * previous sign-in when the page has them; AWS is the pills' business. No
 * "real-time" claim: the dashboard's sources refresh on their own schedules
 * (see the dashboard page's data-provenance comments).
 */
export function DashboardHero({ awsConnection, canConnectAws, awsHealth = null, orgName, lastSynced, statusLine = null }: DashboardHeroProps) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between mb-6">
      <div>
        <h1 className={cn(PAGE_TITLE_CLASS, 'mb-2 max-w-xl')}>
          AI-Powered Cloud Operations &amp; Infrastructure Intelligence
        </h1>
        <p className={cn(PAGE_SUBTITLE_CLASS, 'max-w-xl')}>
          Operational visibility across cloud costs, security, observability, and infrastructure efficiency — so you can reduce waste, mitigate risk, and scale with confidence.
        </p>
        <p className="text-meta text-ink-muted font-medium mt-2">
          {`${orgName}${awsConnection === 'connected' && lastSynced ? ` · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}` : ''}`}
        </p>
        {statusLine && (
          <p className="text-meta text-ink-muted mt-1 mb-0" data-testid="dashboard-header-status">{statusLine}</p>
        )}
      </div>
      <div className="shrink-0">
        <ProviderPills awsConnection={awsConnection} canConnectAws={canConnectAws} awsHealth={awsHealth} />
      </div>
    </div>
  )
}
