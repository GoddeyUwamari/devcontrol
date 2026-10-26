'use client'

import { AlertTriangle, Filter, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { FilterSummary } from '@/components/dependencies/FilterSummary'
import type { ServiceDependency, CircularDependency, DependencyType } from '@/lib/types'

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  runtime: 'Runtime',
  data: 'Data',
  deployment: 'Deployment',
  'shared-lib': 'Shared Lib',
}

/** The list view's search and filters, held by the page so Export can use them. */
export interface DependencyListFilters {
  query: string
  type: 'all' | DependencyType
  priority: 'all' | 'critical' | 'standard'
}

export const NO_DEPENDENCY_FILTERS: DependencyListFilters = { query: '', type: 'all', priority: 'all' }

interface DependencyListProps {
  dependencies: ServiceDependency[]
  cycles: CircularDependency[]
  filters: DependencyListFilters
  onFiltersChange: (filters: DependencyListFilters) => void
}

/**
 * Case-insensitive literal match on what the row shows: both service names
 * (or ids when a name is missing), the type and the description.
 */
export function matchesDependencySearch(dep: ServiceDependency, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    dep.sourceServiceName ?? dep.sourceServiceId,
    dep.targetServiceName ?? dep.targetServiceId,
    dep.dependencyType,
    DEPENDENCY_TYPE_LABELS[dep.dependencyType],
    dep.description,
  ].some((field) => typeof field === 'string' && field.toLowerCase().includes(needle))
}

/** The rows the list view shows for these filters (and Export exports). */
export function filterDependencies(dependencies: ServiceDependency[], filters: DependencyListFilters): ServiceDependency[] {
  return dependencies.filter((dep) => {
    if (filters.type !== 'all' && dep.dependencyType !== filters.type) return false
    if (filters.priority === 'critical' && !dep.isCritical) return false
    if (filters.priority === 'standard' && dep.isCritical) return false
    return matchesDependencySearch(dep, filters.query)
  })
}

export function DependencyList({ dependencies, cycles, filters, onFiltersChange }: DependencyListProps) {
  const { query, type: typeFilter, priority: criticalFilter } = filters
  const setQuery = (value: string) => onFiltersChange({ ...filters, query: value })
  const setTypeFilter = (value: DependencyListFilters['type']) => onFiltersChange({ ...filters, type: value })
  const setCriticalFilter = (value: DependencyListFilters['priority']) => onFiltersChange({ ...filters, priority: value })

  const filteredDeps = filterDependencies(dependencies, filters)

  const hasActiveFilters = query.trim() !== '' || typeFilter !== 'all' || criticalFilter !== 'all'
  const clearAll = () => onFiltersChange(NO_DEPENDENCY_FILTERS)

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

      {/* Search and filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services, type, description"
            aria-label="Search dependencies"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | DependencyType)}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by type">
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
          <Select value={criticalFilter} onValueChange={(v) => setCriticalFilter(v as 'all' | 'critical' | 'standard')}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by priority">
              <SelectValue placeholder="Filter by priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="critical">Critical Only</SelectItem>
              <SelectItem value="standard">Standard Only</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>
        <div className="text-ui text-muted-foreground md:ml-auto" aria-live="polite">
          Showing {filteredDeps.length} of {dependencies.length} dependencies
        </div>
      </div>

      <FilterSummary
        filters={{ type: typeFilter, priority: criticalFilter }}
        onRemoveFilter={(key) => (key === 'type' ? setTypeFilter('all') : setCriticalFilter('all'))}
      />

      {filteredDeps.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center">
          <p className="text-ui font-medium">No dependencies match your search or filters</p>
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear search and filters
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
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
                    <Badge variant="outline">{DEPENDENCY_TYPE_LABELS[dep.dependencyType] || dep.dependencyType}</Badge>
                  </TableCell>
                  <TableCell>
                    {dep.isCritical ? (
                      <Badge variant="destructive">Critical</Badge>
                    ) : (
                      <Badge variant="secondary">Standard</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-ui text-muted-foreground max-w-xs truncate">
                    {dep.description || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
