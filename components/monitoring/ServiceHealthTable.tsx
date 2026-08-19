'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServiceMetric {
  label: string
  value: number
  unit?: string
}

interface ServiceHealth {
  name: string
  description?: string
  status: 'healthy' | 'degraded' | 'critical' | 'down' | 'unknown'
  uptime: string
  responseTime: string
  errorRate: number | null
  critical?: boolean
  recentIncidents?: number
  uptimeHistory?: number[]
  monitored?: boolean
  // Phase B additions — both optional so demo-mode/Prometheus-fallback rows (which have
  // neither) keep working unchanged.
  resourceType?: string
  metrics?: ServiceMetric[]
}

interface ServiceHealthTableProps {
  services: ServiceHealth[]
  loading?: boolean
}

// Fixed, known resource types with display labels — deliberately not derived purely from
// whatever's present in `services`, so the tab row also communicates which types the
// monitoring capability model supports, even when an account currently has zero of a type
// (e.g. "DynamoDB (0)" still shows the capability exists, not just what's populated today).
const RESOURCE_TYPE_TABS: { key: string; label: string }[] = [
  { key: 'ec2', label: 'EC2' },
  { key: 'rds', label: 'RDS' },
  { key: 'load-balancer', label: 'ALB' },
  { key: 'lambda', label: 'Lambda' },
  { key: 'dynamodb', label: 'DynamoDB' },
  { key: 'ecs', label: 'ECS' },
  { key: 'eks', label: 'EKS' },
]

function formatMetricValue(metric: ServiceMetric): string {
  const formatted = metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `${metric.label} ${formatted}${metric.unit ?? ''}`
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  return (
    <svg className="w-24 h-8" viewBox="0 0 96 32">
      <polyline
        points={data
          .map((value, index) => {
            const x = (index / (data.length - 1)) * 96
            const y = 32 - ((value - min) / range) * 28
            return `${x},${y}`
          })
          .join(' ')}
        fill="none"
        stroke="#3B82F6"
        strokeWidth="2"
      />
    </svg>
  )
}

export function ServiceHealthTable({ services, loading = false }: ServiceHealthTableProps) {
  const [activeFilter, setActiveFilter] = useState<string>('all')

  // Only show filter tabs when at least one row actually has a resourceType — demo-mode
  // and the Prometheus self-monitoring fallback don't carry AWS resource types, and
  // showing "EC2 (0) · RDS (0) ..." tabs above made-up service names would be misleading.
  const hasResourceTypeData = useMemo(() => services.some((s) => s.resourceType), [services])

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tab of RESOURCE_TYPE_TABS) {
      counts[tab.key] = services.filter((s) => s.resourceType === tab.key).length
    }
    return counts
  }, [services])

  const filteredServices = useMemo(() => {
    if (activeFilter === 'all') return services
    return services.filter((s) => s.resourceType === activeFilter)
  }, [services, activeFilter])

  return (
    <div className="bg-white rounded-lg border">
      <div className="px-6 py-4 border-b">
        <h3 className="text-lg font-semibold">Service Health</h3>
        <p className="text-sm text-gray-600">Real-time status of platform services</p>
      </div>

      {hasResourceTypeData && (
        <div className="flex flex-wrap gap-2 px-6 py-3 border-b">
          <button
            onClick={() => setActiveFilter('all')}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              activeFilter === 'all'
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            )}
          >
            All ({services.length})
          </button>
          {RESOURCE_TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                activeFilter === tab.key
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              )}
            >
              {tab.label} ({typeCounts[tab.key] ?? 0})
            </button>
          ))}
        </div>
      )}

      <div className="divide-y">
        {loading ? (
          <div className="px-6 py-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-600">Loading services...</span>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-600">No services found</p>
          </div>
        ) : (
          filteredServices.map((service) => (
            <div
              key={service.name}
              className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                {/* Left: Service Info */}
                <div className="flex items-center gap-4">
                  {/* Status Dot */}
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full",
                      service.monitored === false
                        ? "bg-gray-300"
                        : service.status === 'healthy' && "bg-green-500",
                      service.monitored !== false && service.status === 'degraded' && "bg-yellow-500",
                      service.monitored !== false && service.status === 'critical' && "bg-red-600",
                      service.monitored !== false && service.status === 'down' && "bg-red-900",
                      service.monitored !== false && service.status === 'unknown' && "bg-gray-300"
                    )}
                    title={service.monitored === false ? 'No live monitoring data — status from inventory only' : undefined}
                  />

                  {/* Service Name + Tags */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900">
                        {service.name}
                      </h4>
                      {service.critical && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                          Core Service
                        </span>
                      )}
                      {service.monitored === false && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full font-medium">
                          Not monitored
                        </span>
                      )}
                    </div>
                    {service.description && (
                      <p className="text-xs text-gray-500">
                        {service.description}
                      </p>
                    )}
                    {/* Phase B: generic per-resource metrics — renders whatever the
                        capability populated, no per-resourceType branching here. */}
                    {service.metrics && service.metrics.length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {service.metrics.map(formatMetricValue).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Metrics */}
                <div className="flex items-center gap-8">
                  {/* Uptime */}
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      {service.uptime}
                    </div>
                    <div className="text-xs text-gray-500">Uptime (30d)</div>
                  </div>

                  {/* Response Time */}
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      {service.responseTime}
                    </div>
                    <div className="text-xs text-gray-500">p95 Latency</div>
                  </div>

                  {/* Error Rate */}
                  <div className="text-right">
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        service.errorRate === null ? "text-gray-400" : service.errorRate > 1 ? "text-red-600" : "text-gray-900"
                      )}
                    >
                      {service.errorRate === null ? '—' : `${service.errorRate}%`}
                    </div>
                    <div className="text-xs text-gray-500">Error Rate</div>
                  </div>

                  {/* Mini Sparkline */}
                  {service.uptimeHistory && service.uptimeHistory.length > 0 && (
                    <Sparkline data={service.uptimeHistory} />
                  )}

                  {/* Action */}
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>

              {/* Recent Incidents (if any) */}
              {service.recentIncidents !== undefined && (
                <div className={`mt-2 ml-7 text-xs rounded px-2 py-1 inline-block ${
                  service.recentIncidents > 0
                    ? 'text-yellow-700 bg-yellow-50'
                    : 'text-gray-400 bg-gray-50'
                }`}>
                  {service.recentIncidents === 0
                    ? '0 incidents in last 24h'
                    : `${service.recentIncidents} incident${service.recentIncidents > 1 ? 's' : ''} in last 24h`
                  }
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}