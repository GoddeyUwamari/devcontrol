import { formatDistanceToNow } from 'date-fns'
import { Clock, CheckCircle2, TrendingUp, ShieldAlert, Gauge, Activity as ActivityIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityEventType, ActivityEvent } from '@/lib/services/activity-feed.service'

interface RecentActivityCardProps {
  isDemoActive: boolean
  data: ActivityEvent[] | undefined
  isLoading: boolean
  isError: boolean
}

const EVENT_CONFIG: Record<ActivityEventType, { icon: typeof CheckCircle2; color: string; background: string }> = {
  sync: { icon: CheckCircle2, color: 'var(--text-success)', background: 'var(--bg-success)' },
  optimization: { icon: TrendingUp, color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  security: { icon: ShieldAlert, color: 'var(--text-danger)', background: 'var(--bg-danger)' },
  anomaly: { icon: ShieldAlert, color: 'var(--text-danger)', background: 'var(--bg-danger)' },
  score: { icon: Gauge, color: '#1D4ED8', background: '#EFF6FF' },
}

/**
 * Reconstructed from real signals (sync, cost optimization, security
 * findings, score changes, anomalies) — never shown in demo mode, matching
 * every other real-data-only feature on this dashboard.
 */
export function RecentActivityCard({ isDemoActive, data, isLoading, isError }: RecentActivityCardProps) {
  if (isDemoActive) return null

  return (
    <div className="bg-[var(--surface-2)] border border-border rounded-2xl p-5 h-full">
      <div className="flex items-center gap-2.5 mb-4">
        <Clock size={17} style={{ color: 'var(--text-accent)' }} />
        <h3 className="text-base font-bold text-foreground">Recent Activity</h3>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : isError || !data || data.length === 0 ? (
        <div className="text-center py-10 flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--surface-1)] flex items-center justify-center mb-1">
            <ActivityIcon size={18} className="text-[var(--text-secondary)]" />
          </div>
          <p className="text-sm font-semibold text-foreground">No activity yet</p>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">Activity will appear here once resources sync, findings are detected, or scores update</p>
        </div>
      ) : (
        <div>
          {data.slice(0, 6).map((event, i) => {
            const conf = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.score
            const Icon = conf.icon
            return (
              <div key={`${event.type}-${event.timestamp}-${i}`} className="flex items-start gap-3 py-3 border-b border-border last:border-b-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: conf.background }}>
                  <Icon size={14} style={{ color: conf.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground leading-snug line-clamp-1" title={event.message}>{event.message}</p>
                  <p className="text-xs text-[var(--text-secondary)] capitalize">{event.type}{event.severity ? ` · ${event.severity}` : ''}</p>
                </div>
                <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
