'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Rocket, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { Deployment, DeploymentEnvironment, DeploymentStatus } from '@/lib/types'

type EnvironmentFilter = 'all' | DeploymentEnvironment

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Cost Estimate</TableHead>
            <TableHead>Deployed By</TableHead>
            <TableHead>Deployed At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-6 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-red-50">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-900">Error Loading Deployments</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
      <Rocket className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h3 className="text-lg font-semibold">No deployments found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Deployments will appear here when services are deployed via CLI
        </p>
      </div>
    </div>
  )
}

export default function DeploymentsPage() {
  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentFilter>('all')

  const { data: deployments = [], isLoading, error, refetch } = useQuery({
    queryKey: ['deployments', environmentFilter],
    queryFn: async () => {
      const allDeployments = await deploymentsService.getAll()
      return environmentFilter === 'all'
        ? allDeployments
        : allDeployments.filter(d => d.environment === environmentFilter)
    },
  })

  const getStatusBadge = (status: DeploymentStatus) => {
    const variants = {
      running: 'bg-green-100 text-green-700 border-green-200',
      stopped: 'bg-gray-100 text-gray-700 border-gray-200',
      deploying: 'bg-blue-100 text-blue-700 border-blue-200',
      failed: 'bg-red-100 text-red-700 border-red-200',
    }
    return (
      <Badge className={`${variants[status]} border`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getEnvironmentBadge = (environment: DeploymentEnvironment) => {
    const variants = {
      production: 'bg-purple-100 text-purple-700 border-purple-200',
      staging: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      development: 'bg-blue-100 text-blue-700 border-blue-200',
    }
    return (
      <Badge className={`${variants[environment]} border font-medium`}>
        {environment.charAt(0).toUpperCase() + environment.slice(1)}
      </Badge>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Deployments', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployment History</h1>
          <p className="text-muted-foreground mt-2">
            Track all service deployments across environments
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={environmentFilter} onValueChange={(value: EnvironmentFilter) => setEnvironmentFilter(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Environments</SelectItem>
            <SelectItem value="production">Production</SelectItem>
            <SelectItem value="staging">Staging</SelectItem>
            <SelectItem value="development">Development</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {deployments.length} {deployments.length === 1 ? 'deployment' : 'deployments'}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : deployments.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost Estimate</TableHead>
                <TableHead>Deployed By</TableHead>
                <TableHead>Deployed At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((deployment) => (
                <TableRow key={deployment.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    {deployment.serviceName || deployment.serviceId.substring(0, 8)}
                  </TableCell>
                  <TableCell>{getEnvironmentBadge(deployment.environment)}</TableCell>
                  <TableCell className="text-sm font-mono">{deployment.awsRegion}</TableCell>
                  <TableCell>{getStatusBadge(deployment.status)}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(deployment.costEstimate)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {deployment.deployedBy}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(deployment.deployedAt)}
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
