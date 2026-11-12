import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Clock, TrendingUp, Gauge, Activity as ActivityIcon } from 'lucide-react'
import { DASHBOARD_ICON_STROKE } from './icon-stroke'
import { StatusIcon, type StatusKind } from '@/components/ui/status-icon'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityEventType, ActivityEvent } from '@/lib/services/activity-feed.service'

interface RecentActivityCardProps {
  isDemoActive: boolean
  data: ActivityEvent[] | undefined
  isLoading: boolean
  isError: boolean
}

// Status events use the filled status icons (dashboard-step1 §D); the others keep their outline icons.
// Every row's text (message, then the event type) says what the icon shows, so the icon is aria-hidden.
type EventIcon = { status: Exclude<StatusKind, 'error'>; background: string } | { icon: typeof Gauge; color: string; background: string }
const EVENT_CONFIG: Record<ActivityEventType, EventIcon> = {
  sync: { status: 'success', background: 'var(--bg-success)' },
  optimization: { icon: TrendingUp, color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  security: { status: 'security', background: 'var(--bg-accent)' },
  anomaly: { status: 'security', background: 'var(--bg-accent)' },
  score: { icon: Gauge, color: '#1D4ED8', background: '#EFF6FF' },
}

const DEFAULT_VISIBLE_COUNT = 6

/**
 * Reconstructed from real signals (sync, cost optimization, security
 * findings, score changes, anomalies) — never shown in demo mode, matching
 * every other real-data-only feature on this dashboard.
 *
 * Shows the newest 6 events; "Show all N" reveals the rest of the events the
 * feed already returned (the backend caps it at 15). It's an in-card toggle,
 * not a link -- there is no dedicated activity page -- and never fetches.
 */
export function RecentActivityCard({ isDemoActive, data, isLoading, isError }: RecentActivityCardProps) {
  // Expansion belongs to the specific feed it was requested for: when a refetch
  // replaces the data with a different array, the card falls back to 6 rows.
  const [expandedFor, setExpandedFor] = useState<ActivityEvent[] | null>(null)

  if (isDemoActive) return null

  const totalActivityCount = data?.length ?? 0
  const hasMoreActivities = totalActivityCount > DEFAULT_VISIBLE_COUNT
  const expanded = hasMoreActivities && expandedFor === data
  const visibleActivities = expanded ? data ?? [] : (data ?? []).slice(0, DEFAULT_VISIBLE_COUNT)

  return (
    <div className="bg-[var(--surface-2)] border border-border rounded-2xl p-5 h-full">
      <div className="flex items-center gap-2.5 mb-4">
        <Clock size={17} strokeWidth={DASHBOARD_ICON_STROKE} style={{ color: 'var(--text-accent)' }} />
        <h3 className="text-section text-ink">Recent Activity</h3>
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
            <ActivityIcon size={18} className="text-ink-muted" />
          </div>
          <p className="text-ui font-semibold text-ink">No activity yet</p>
          <p className="text-meta text-ink-muted leading-relaxed">Activity will appear here once resources sync, findings are detected, or scores update</p>
        </div>
      ) : (
        <div>
          {visibleActivities.map((event, i) => {
            const conf = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.score
            return (
              <div key={`${event.type}-${event.timestamp}-${i}`} className="flex items-start gap-3 py-3 border-b border-border last:border-b-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: conf.background }}>
                  {'status' in conf
                    ? <StatusIcon kind={conf.status} size={14} data-testid="activity-status-icon" />
                    : <conf.icon size={14} strokeWidth={DASHBOARD_ICON_STROKE} aria-hidden="true" style={{ color: conf.color }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-meta font-semibold text-ink leading-snug line-clamp-1" title={event.message}>{event.message}</p>
                  {/* 'score' events are periodic historical snapshots (risk_score_history),
                      not the live current score shown in the Security Posture KPI -- the two
                      can legitimately differ. Label this explicitly rather than the generic
                      type name, so the timestamp reads as "this was the score then", not an
                      implicit claim that it's still current. Message/timestamp are untouched
                      real values from the API. */}
                  <p className="text-meta text-ink-muted">
                    {event.type === 'score' ? 'Historical snapshot' : <span className="capitalize">{event.type}</span>}
                    {event.severity ? ` · ${event.severity}` : ''}
                  </p>
                </div>
                <span className="text-meta text-ink-muted whitespace-nowrap shrink-0">
                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                </span>
              </div>
            )
          })}
          {hasMoreActivities && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedFor(expanded ? null : data)}
              className="mt-3 text-label font-semibold bg-transparent border-0 p-0 cursor-pointer hover:underline"
              style={{ color: 'var(--text-accent)' }}
            >
              {expanded ? 'Show less' : `Show all ${totalActivityCount}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
