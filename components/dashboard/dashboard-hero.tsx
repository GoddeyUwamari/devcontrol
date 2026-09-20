import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import { CloudProviderStatus } from './cloud-provider-status'

interface DashboardHeroProps {
  isAwsConnected: boolean
  orgName: string
  /** Only ever a genuinely authoritative sync timestamp (e.g. the fixed demo timestamp) — never a page-load Date. */
  lastSynced: Date | null
}

/**
 * Page hero: title, truthful supporting copy, AWS connection pill, and
 * cloud-provider status tiles. "Real-time" describes live operational
 * signals only — see the dashboard page's own data-provenance comments for
 * what is/isn't asynchronous.
 */
export function DashboardHero({ isAwsConnected, orgName, lastSynced }: DashboardHeroProps) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between mb-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground tracking-tight leading-tight mb-2 max-w-xl">
          AI-Powered Cloud Operations &amp; Infrastructure Intelligence
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-xl">
          Real-time operational visibility across cloud costs, security, observability, and infrastructure efficiency — so you can reduce waste, mitigate risk, and scale with confidence.
        </p>
        <p className="text-xs text-[var(--text-secondary)] font-medium mt-2">
          {isAwsConnected
            ? `${orgName}${lastSynced ? ` · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}` : ''}`
            : 'Connect your AWS account to get started · Setup takes 2 minutes'}
        </p>
      </div>
      <div className="flex flex-col items-start lg:items-end gap-3 shrink-0">
        <div
          className="flex items-center gap-2 rounded-full border px-3.5 py-1.5"
          style={{
            borderColor: isAwsConnected ? 'var(--border-success)' : 'var(--border)',
            background: isAwsConnected ? 'var(--bg-success)' : 'var(--surface-2)',
          }}
        >
          {isAwsConnected ? (
            <CheckCircle2 size={14} style={{ color: 'var(--text-success)' }} />
          ) : (
            <XCircle size={14} className="text-[var(--text-secondary)]" />
          )}
          <span className="text-xs font-semibold" style={{ color: isAwsConnected ? 'var(--text-success)' : 'var(--text-secondary)' }}>
            {isAwsConnected ? 'AWS Account Connected' : 'AWS Account Not Connected'}
          </span>
          <ChevronRight size={13} style={{ color: isAwsConnected ? 'var(--text-success)' : 'var(--text-secondary)' }} />
        </div>
        <CloudProviderStatus awsConnected={isAwsConnected} />
      </div>
    </div>
  )
}
