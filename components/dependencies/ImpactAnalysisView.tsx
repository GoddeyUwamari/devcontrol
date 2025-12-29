'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { servicesService } from '@/lib/services/services.service'
import { dependenciesService } from '@/lib/services/dependencies.service'

export function ImpactAnalysisView() {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)

  // Fetch services for dropdown
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesService.getAll(),
  })

  // Fetch impact analysis
  const { data: analysis, isLoading } = useQuery({
    queryKey: ['dependencies', 'impact', selectedServiceId],
    queryFn: () => dependenciesService.getImpactAnalysis(selectedServiceId!),
    enabled: !!selectedServiceId,
  })

  return (
    <div className="space-y-6">
      {/* Service Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-2 block">
            Select a service to analyze its impact
          </label>
          <Select value={selectedServiceId || ''} onValueChange={setSelectedServiceId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a service..." />
            </SelectTrigger>
            <SelectContent>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name} ({service.template})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Analysis Results */}
      {selectedServiceId && analysis && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Upstream (Dependencies) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowUp className="h-5 w-5 text-blue-600" />
                  Upstream Dependencies ({analysis.totalUpstream})
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Services that <strong>{analysis.serviceName}</strong> depends on
                </p>
              </CardHeader>
              <CardContent>
                {analysis.upstreamDependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No upstream dependencies
                  </p>
                ) : (
                  <div className="space-y-2">
                    {analysis.upstreamDependencies.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <span className="font-medium">{dep.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{dep.dependencyType}</Badge>
                          {dep.isCritical && (
                            <Badge variant="destructive">Critical</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Downstream (Dependents) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowDown className="h-5 w-5 text-orange-600" />
                  Downstream Dependents ({analysis.totalDownstream})
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Services that depend on <strong>{analysis.serviceName}</strong>
                </p>
              </CardHeader>
              <CardContent>
                {analysis.downstreamDependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No downstream dependents
                  </p>
                ) : (
                  <div className="space-y-2">
                    {analysis.downstreamDependencies.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <span className="font-medium">{dep.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{dep.dependencyType}</Badge>
                          {dep.isCritical && (
                            <Badge variant="destructive">Critical</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Impact Summary */}
          <Card className={analysis.criticalPath ? 'border-red-300 bg-red-50' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Impact Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                If <strong>{analysis.serviceName}</strong> fails, it will directly affect{' '}
                <strong>{analysis.totalAffectedIfFails} service(s)</strong>.
              </p>
              {analysis.criticalPath && (
                <div className="flex items-center gap-2 text-red-700 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  This service is on a critical path
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
