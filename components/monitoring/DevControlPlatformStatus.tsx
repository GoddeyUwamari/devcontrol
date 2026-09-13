'use client'

export interface DevControlPlatformStatusService {
  name: string
  status: 'healthy' | 'down' | 'unknown'
  responseTimeMs: number | null
}

export interface DevControlPlatformStatusProps {
  // false until the first check has completed -- render nothing until then, rather than a
  // placeholder that could be mistaken for a real (even if "unknown") reading.
  checked: boolean
  available: boolean
  services: DevControlPlatformStatusService[]
}

const STATUS_META: Record<DevControlPlatformStatusService['status'], { label: string; dot: string; text: string }> = {
  healthy: { label: 'Operational', dot: 'bg-green-500', text: 'text-green-700' },
  down: { label: 'Down', dot: 'bg-red-600', text: 'text-red-700' },
  unknown: { label: 'Unavailable', dot: 'bg-gray-300', text: 'text-gray-500' },
}

/**
 * Monitoring Truthfulness Phase 1: reports DevControl's OWN backend infrastructure (its
 * API server, its database, its metrics collector) sourced from DevControl's own
 * Prometheus instance. Deliberately a separate component, separate heading, and separate
 * data source from ServiceHealthTable -- that table is fed exclusively by
 * cloudwatch.service.ts's per-resource CloudWatch data about the CUSTOMER's AWS account.
 * This component's data must never populate, or be mistaken for, that table.
 *
 * Never fabricates: if a real value isn't available, the affected field is simply omitted
 * (no default/placeholder number), matching the same "null means genuinely unknown"
 * convention the CloudWatch health engine already follows.
 */
export function DevControlPlatformStatus({ checked, available, services }: DevControlPlatformStatusProps) {
  if (!checked) return null

  return (
    <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-6 py-3.5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">DevControl Platform Status</p>
        {!available && <span className="text-xs text-slate-400">Status temporarily unavailable</span>}
      </div>
      {available && services.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
          {services.map((service) => {
            const meta = STATUS_META[service.status]
            return (
              <div key={service.name} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                <span className="text-xs font-medium text-slate-700">{service.name}</span>
                <span className={`text-xs ${meta.text}`}>{meta.label}</span>
                {service.responseTimeMs !== null && (
                  <span className="text-[11px] text-slate-400">· {service.responseTimeMs}ms</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
