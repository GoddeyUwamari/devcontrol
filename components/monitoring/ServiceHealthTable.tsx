'use client'

import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServiceHealth {
  name: string
  description?: string
  status: 'healthy' | 'degraded' | 'down'
  uptime: string
  responseTime: string
  errorRate: number
  critical?: boolean
  recentIncidents?: number
  uptimeHistory?: number[]
}

interface ServiceHealthTableProps {
  services: ServiceHealth[]
  loading?: boolean
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
  return (
    <div className="bg-white rounded-lg border">
      <div className="px-6 py-4 border-b">
        <h3 className="text-lg font-semibold">Service Health</h3>
        <p className="text-sm text-gray-600">Real-time status of platform services</p>
      </div>

      <div className="divide-y">
        {loading ? (
          <div className="px-6 py-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-600">Loading services...</span>
          </div>
        ) : services.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-600">No services found</p>
          </div>
        ) : (
          services.map((service) => (
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
                      service.status === 'healthy' && "bg-green-500",
                      service.status === 'degraded' && "bg-yellow-500",
                      service.status === 'down' && "bg-red-500"
                    )}
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
                    </div>
                    {service.description && (
                      <p className="text-xs text-gray-500">
                        {service.description}
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
                        service.errorRate > 1 ? "text-red-600" : "text-gray-900"
                      )}
                    >
                      {service.errorRate}%
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
