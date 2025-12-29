'use client'

import { useState } from 'react'
import { Trash2, Edit, AlertTriangle, Filter, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import type { ServiceDependency, CircularDependency, DependencyType } from '@/lib/types'

interface DependencyListProps {
  dependencies: ServiceDependency[]
  cycles: CircularDependency[]
  isLoading: boolean
  onRefresh: () => void
}

export function DependencyList({
  dependencies,
  cycles,
  isLoading,
  onRefresh,
}: DependencyListProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | DependencyType>('all')
  const [criticalFilter, setCriticalFilter] = useState<'all' | 'critical' | 'standard'>('all')

  // Apply filters
  const filteredDeps = dependencies.filter((dep) => {
    if (typeFilter !== 'all' && dep.dependencyType !== typeFilter) return false
    if (criticalFilter === 'critical' && !dep.isCritical) return false
    if (criticalFilter === 'standard' && dep.isCritical) return false
    return true
  })

  if (isLoading) {
    return <TableSkeleton />
  }

  if (dependencies.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No Dependencies"
        description="Start by adding your first service dependency relationship."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Circular Dependency Warnings */}
      {cycles.length > 0 && (
        <div className="space-y-2">
          {cycles.map((cycle, idx) => (
            <Alert key={idx} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Circular Dependency:</strong> {cycle.path}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="runtime">Runtime</SelectItem>
              <SelectItem value="data">Data</SelectItem>
              <SelectItem value="deployment">Deployment</SelectItem>
              <SelectItem value="shared-lib">Shared Library</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Select value={criticalFilter} onValueChange={(v: any) => setCriticalFilter(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="critical">Critical Only</SelectItem>
            <SelectItem value="standard">Standard Only</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground ml-auto">
          Showing {filteredDeps.length} of {dependencies.length} dependencies
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source Service</TableHead>
              <TableHead>Target Service</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDeps.map((dep) => (
              <TableRow key={dep.id}>
                <TableCell className="font-medium">
                  {dep.sourceServiceName || dep.sourceServiceId}
                </TableCell>
                <TableCell>{dep.targetServiceName || dep.targetServiceId}</TableCell>
                <TableCell>
                  <DependencyTypeBadge type={dep.dependencyType} />
                </TableCell>
                <TableCell>
                  {dep.isCritical ? (
                    <Badge variant="destructive">Critical</Badge>
                  ) : (
                    <Badge variant="secondary">Standard</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                  {dep.description || '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function DependencyTypeBadge({ type }: { type: DependencyType }) {
  const styles = {
    runtime: 'Runtime',
    data: 'Data',
    deployment: 'Deployment',
    'shared-lib': 'Shared Lib',
  }

  return <Badge variant="outline">{styles[type] || type}</Badge>
}

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source Service</TableHead>
            <TableHead>Target Service</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
