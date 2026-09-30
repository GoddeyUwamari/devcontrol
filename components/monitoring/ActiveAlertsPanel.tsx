'use client'

import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'

interface Alert {
  id: string
  title: string
  message: string
  severity: 'critical' | 'warning'
  service: string
  triggeredAt: Date
}

interface ActiveAlertsPanelProps {
  alerts: Alert[]
  /** Shown when there are no alerts to list -- why, not a health verdict. */
  emptyMessage: string
  /** Whether `alerts` is a confirmed result. When it is not (loading, unavailable,
   * failed), no severity counts are shown -- an empty list is not zero alerts. */
  countsAvailable: boolean
}

export function ActiveAlertsPanel({ alerts, emptyMessage, countsAvailable }: ActiveAlertsPanelProps) {
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length
  const warningCount = alerts.filter((a) => a.severity === 'warning').length

  return (
    <div className="bg-white rounded-lg border">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Active Alerts</h3>
          {countsAvailable && (
            <p className="text-sm text-gray-600">
              {criticalCount} critical • {warningCount} warnings
            </p>
          )}
        </div>
        <Button size="sm" variant="outline">
          View All
        </Button>
      </div>

      {alerts.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-900">No alerts to show</p>
          <p className="text-xs text-gray-500 mt-1">{emptyMessage}</p>
        </div>
      ) : (
        <div className="divide-y max-h-96 overflow-y-auto">
          {alerts.map((alert) => (
            <div key={alert.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start gap-3">
                {/* Severity Icon */}
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center",
                    alert.severity === 'critical' && "bg-red-100",
                    alert.severity === 'warning' && "bg-yellow-100"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "w-4 h-4",
                      alert.severity === 'critical' && "text-red-600",
                      alert.severity === 'warning' && "text-yellow-600"
                    )}
                  />
                </div>

                {/* Alert Details */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm">{alert.title}</h4>
                    <span
                      className={cn(
                        "px-2 py-0.5 text-xs rounded-full font-medium",
                        alert.severity === 'critical' &&
                          "bg-red-100 text-red-700",
                        alert.severity === 'warning' &&
                          "bg-yellow-100 text-yellow-700"
                      )}
                    >
                      {alert.severity.toUpperCase()}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 mb-2">{alert.message}</p>

                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      Triggered {formatDistanceToNow(alert.triggeredAt, { addSuffix: true })}
                    </span>
                    <span>•</span>
                    <span>Service: {alert.service}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost">
                    Acknowledge
                  </Button>
                  <Button size="sm" variant="ghost">
                    Resolve
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
