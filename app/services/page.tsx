'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, AlertCircle, Layers, Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { servicesService } from '@/lib/services/services.service'
import type { Service, ServiceStatus } from '@/lib/types'

type StatusFilter = 'all' | ServiceStatus

// Loading Skeleton Component
function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>GitHub</TableHead>
            <TableHead>Created Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Error State Component
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-red-50">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-900">Error Loading Services</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  )
}

import { EmptyState as EmptyStateComponent } from '@/components/ui/empty-state'

// Empty State Component
function EmptyState() {
  return (
    <EmptyStateComponent
      icon={Layers}
      title="No services yet"
      description="Deploy your first service to start tracking deployments and infrastructure. Services are the building blocks of your platform."
      action={{
        label: 'Create Service',
        onClick: () => {
          // Will be connected to create service flow
        },
      }}
      secondaryAction={{
        label: 'Learn More',
        onClick: () => window.open('https://docs.example.com', '_blank'),
      }}
    />
  )
}

export default function ServicesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { data: services = [], isLoading, error, refetch } = useQuery({
    queryKey: ['services', statusFilter],
    queryFn: async () => {
      const allServices = await servicesService.getAll()
      return statusFilter === 'all'
        ? allServices
        : allServices.filter(s => s.status === statusFilter)
    },
  })

  const getStatusBadge = (status: ServiceStatus) => {
    const variants = {
      active: 'bg-green-100 text-green-700 border-green-200',
      inactive: 'bg-gray-100 text-gray-700 border-gray-200',
      deploying: 'bg-blue-100 text-blue-700 border-blue-200',
      failed: 'bg-red-100 text-red-700 border-red-200',
    }
    return (
      <Badge className={`${variants[status]} border`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getTemplateBadge = (template: string) => {
    return (
      <Badge variant="outline" className="font-mono text-xs">
        {template}
      </Badge>
    )
  }

  const formatDate = (dateString: string | Date) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A'; // Check if valid date
  
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Services', current: true },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground leading-relaxed">
            Manage and monitor all platform services created via CLI
          </p>
        </div>
        <Button className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Create Service
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="deploying">Deploying</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {services.length} {services.length === 1 ? 'service' : 'services'}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : services.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[150px]">Name</TableHead>
                <TableHead className="min-w-[100px]">Template</TableHead>
                <TableHead className="min-w-[150px]">Owner</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[120px]">GitHub</TableHead>
                <TableHead className="min-w-[120px]">Created Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell>{getTemplateBadge(service.template)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{service.owner}</TableCell>
                  <TableCell>{getStatusBadge(service.status)}</TableCell>
                  <TableCell>
                    {service.githubUrl ? (
                      <a
                        href={service.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Github className="h-4 w-4 mr-1" />
                        View Repo
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(service.createdAt)}
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
