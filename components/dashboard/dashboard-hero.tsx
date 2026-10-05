import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Plug } from 'lucide-react'

/** See app/(app)/dashboard/dashboardAwsConnection.ts. */
type AwsConnection = 'connected' | 'unconnected' | 'unknown' | 'loading'

interface DashboardHeroProps {
  awsConnection: AwsConnection
  /** Only an owner can connect AWS, so only an owner gets the pill as a link. */
  canConnectAws: boolean
  orgName: string
  /** Only ever a genuinely authoritative sync timestamp (e.g. the fixed demo timestamp) — never a page-load Date. */
  lastSynced: Date | null
}

const PILL = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap'

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
 */
export function ProviderPills({ awsConnection, canConnectAws }: { awsConnection: AwsConnection; canConnectAws: boolean }) {
  return (
    <div className="flex flex-nowrap items-center gap-2" data-testid="provider-pills">
      {awsConnection === 'connected' ? (
        <span
          className={`${PILL} border`}
          style={{ background: 'var(--bg-success)', borderColor: 'var(--border-success)', color: 'var(--text-success)' }}
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
          className={`${PILL} border border-border bg-transparent text-[var(--text-secondary)] cursor-default`}
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
          className={`${PILL} border border-dashed border-border bg-transparent text-[var(--text-secondary)] cursor-default`}
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
 * is the organization's name in every state; AWS is the pills' business. No
 * "real-time" claim: the dashboard's sources refresh on their own schedules
 * (see the dashboard page's data-provenance comments).
 */
export function DashboardHero({ awsConnection, canConnectAws, orgName, lastSynced }: DashboardHeroProps) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between mb-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground tracking-tight leading-tight mb-2 max-w-xl">
          AI-Powered Cloud Operations &amp; Infrastructure Intelligence
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-xl">
          Operational visibility across cloud costs, security, observability, and infrastructure efficiency — so you can reduce waste, mitigate risk, and scale with confidence.
        </p>
        <p className="text-xs text-[var(--text-secondary)] font-medium mt-2">
          {`${orgName}${awsConnection === 'connected' && lastSynced ? ` · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}` : ''}`}
        </p>
      </div>
      <div className="shrink-0">
        <ProviderPills awsConnection={awsConnection} canConnectAws={canConnectAws} />
      </div>
    </div>
  )
}
