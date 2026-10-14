import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Code2, TrendingUp, TrendingDown } from 'lucide-react'
import { useAuth } from '@/lib/contexts/auth-context'
import { deploymentsService } from '@/lib/services/deployments.service'
import { doraMetricsService } from '@/lib/services/dora-metrics.service'
import { deploymentStatusDisplay, formatChangeFailureRate } from '@/lib/deployments/status'

interface DoraRow {
  label: string
  value: string
  /** Demo-only decorative delta — never populated in real mode. */
  delta?: { direction: 'up' | 'down'; label: string; good: boolean }
}

interface EngineeringHealthCardProps {
  isDemoActive: boolean
  doraRows: DoraRow[]
}

const WINDOW = '30d'
const WINDOW_LABEL = 'Last 30 days'

/**
 * Real mode reads the organization's own deployment records through the same
 * two endpoints the Deployments and DORA pages use, over the last 30 days:
 * deploys per day and change failure rate from GET /api/metrics/dora, the
 * last finished deployment from GET /api/deployments/stats. Lead time and
 * time to restore are not tracked and are never estimated. A value that has
 * not loaded, or could not be, is a dash -- never a zero.
 * Demo mode keeps the existing demonstration metrics, laid out as a compact
 * 4-up stat grid.
 */
export function EngineeringHealthCard({ isDemoActive, doraRows }: EngineeringHealthCardProps) {
  const { organization } = useAuth()
  const enabled = !isDemoActive && !!organization?.id

  // Keyed by organization, like every tenant-data query on the dashboard, so
  // one organization's cached values can never be shown to another.
  const dora = useQuery({
    queryKey: ['engineering-health-dora', organization?.id, WINDOW],
    queryFn: () => doraMetricsService.getDORAMetrics({ dateRange: WINDOW }),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const stats = useQuery({
    queryKey: ['engineering-health-deployment-stats', organization?.id, WINDOW],
    queryFn: () => deploymentsService.getStats({ dateRange: WINDOW }),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const doraData = dora.data?.success ? dora.data.data : undefined
  const statsData = stats.data
  const failed = (dora.isError && !doraData) || (stats.isError && !statsData)
  // Known to have no deployment at all -- only ever from a loaded answer.
  const noneRecorded = statsData?.organization_has_deployments === false

  const frequency = doraData?.deploymentFrequency.value
  const lastDeployment = statsData?.last_deployment ?? null
  const realRows = [
    {
      key: 'deploys-per-day',
      label: 'Deploys / day',
      value: typeof frequency === 'number' ? String(frequency) : '—',
      sub: doraData ? `${doraData.deployments.successful} successful · ${WINDOW_LABEL.toLowerCase()}` : WINDOW_LABEL,
    },
    {
      key: 'change-failure-rate',
      label: 'Change failure rate',
      value: doraData ? formatChangeFailureRate(doraData.changeFailureRate.value) : '—',
      sub: !doraData
        ? WINDOW_LABEL
        : doraData.deployments.finished > 0
          ? `${doraData.deployments.failed} of ${doraData.deployments.finished} finished failed`
          : 'No finished deployments in this window',
    },
    {
      key: 'last-deploy',
      label: 'Last deploy',
      value: lastDeployment ? formatDistanceToNow(new Date(lastDeployment.deployed_at), { addSuffix: true }) : '—',
      sub: lastDeployment
        ? deploymentStatusDisplay(lastDeployment.status, null).label
        : statsData ? 'No finished deployment recorded' : '',
    },
  ]

  return (
    // Real mode is a short card, so it keeps its own compact height instead
    // of stretching to Recent Activity's; demo mode fills the row.
    <div className={`bg-[var(--surface-2)] rounded-2xl border border-border p-5 ${isDemoActive ? 'h-full' : 'self-start'}`} data-testid="engineering-health-card">
      <div className={`flex items-center flex-wrap justify-between gap-x-3 gap-y-1 ${isDemoActive ? 'mb-4' : 'mb-3'}`}>
        <div className="flex items-center gap-2.5">
          <Code2 size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Engineering Health</h3>
        </div>
        <a href="/app/dora-metrics" className="text-xs font-semibold no-underline flex items-center gap-1 whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View details →
        </a>
      </div>

      {isDemoActive ? (
        <div className="grid grid-cols-2 gap-4">
          {doraRows.map(({ label, value, delta }) => {
            const DeltaIcon = delta?.direction === 'up' ? TrendingUp : TrendingDown
            return (
              <div key={label}>
                <div className="text-2xl font-bold text-foreground leading-none mb-1.5">{value}</div>
                <p className="text-xs text-[var(--text-secondary)] leading-snug mb-1.5">{label}</p>
                {delta && (
                  <div className="flex items-center gap-1" style={{ color: delta.good ? 'var(--text-success)' : 'var(--text-danger)' }}>
                    <DeltaIcon size={12} />
                    <span className="text-xs font-semibold">{delta.label}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : noneRecorded ? (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed m-0" data-testid="engineering-health-empty">
          No deployments recorded · Connect your CI
        </p>
      ) : (
        <div data-testid="engineering-health-metrics" data-state={failed ? 'error' : doraData && statsData ? 'loaded' : 'loading'}>
          <div className="grid grid-cols-3 gap-4">
            {realRows.map(({ key, label, value, sub }) => (
              <div key={key} data-testid={`engineering-health-${key}`}>
                <div className="text-xl font-bold text-foreground leading-none mb-1.5">{value}</div>
                <p className="text-xs text-[var(--text-secondary)] leading-snug m-0">{label}</p>
                {sub && <p className="text-[11px] text-[var(--text-secondary)] leading-snug m-0 mt-0.5">{sub}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed m-0 mt-3" data-testid="engineering-health-note">
            {failed ? 'Deployment metrics could not be loaded. ' : ''}Lead time and time to restore: not tracked
          </p>
        </div>
      )}
    </div>
  )
}
