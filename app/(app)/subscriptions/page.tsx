'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, AlertCircle, CreditCard } from 'lucide-react'
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
import api from '@/lib/api'
import { SubscriptionFormDialog } from '@/components/subscriptions/subscription-form-dialog'
import { SubscriptionActions } from '@/components/subscriptions/subscription-actions'
import type { Subscription } from '@/lib/types'

type StatusFilter = 'all' | 'active' | 'cancelled' | 'past_due' | 'expired' | 'suspended'


// Loading Skeleton Component
function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tenant Name</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Next Billing Date</TableHead>
            <TableHead className="w-[70px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-8 w-8" />
              </TableCell>
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
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
      <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">Failed to load subscriptions</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button
        onClick={onRetry}
        variant="outline"
        className="border-[#635BFF] text-[#635BFF] hover:bg-[#635BFF] hover:text-white"
      >
        Try Again
      </Button>
    </div>
  )
}

// Empty State Component
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <CreditCard className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">No subscriptions found</p>
        <p className="text-sm text-muted-foreground">
          No subscriptions match the selected filter
        </p>
      </div>
    </div>
  )
}

export default function SubscriptionsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch subscriptions with status filter
  const { data: subscriptions = [], isLoading, error, refetch } = useQuery({
    queryKey: ['subscriptions', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const response = await api.get(`/api/billing/subscriptions${params}`);
      return response.data.data || [];
    },
  });

  // Status badge helper
  const getStatusBadge = (status: Subscription['status']) => {
    const variants: Record<Subscription['status'], string> = {
      active: 'bg-green-100 text-green-700 hover:bg-green-100',
      cancelled: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
      past_due: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
      expired: 'bg-red-100 text-red-700 hover:bg-red-100',
      suspended: 'bg-orange-100 text-orange-700 hover:bg-orange-100',
    }
    const labels: Record<Subscription['status'], string> = {
      active: 'Active',
      cancelled: 'Cancelled',
      past_due: 'Past Due',
      expired: 'Expired',
      suspended: 'Suspended',
    }
    return (
      <Badge className={variants[status]} variant="secondary">
        {labels[status]}
      </Badge>
    )
  }

  // Format currency helper
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  // Format date helper
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Subscriptions', current: true },
        ]}
      />

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-muted-foreground mt-2">
            Manage and monitor all active subscriptions
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Subscription
        </Button>
      </div>

      {/* Filter Controls */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="past_due">Past Due</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table Content */}
      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : !subscriptions || subscriptions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Next Billing Date</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription.id}>
                  <TableCell className="font-medium">
                    {subscription.tenantName || 'N/A'}
                  </TableCell>
                  <TableCell>{subscription.plan || subscription.planId}</TableCell>
                  <TableCell>{getStatusBadge(subscription.status)}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(subscription.amount || subscription.currentPrice)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(subscription.nextBillingDate || subscription.currentPeriodEnd)}
                  </TableCell>
                  <TableCell>
                    <SubscriptionActions subscription={subscription} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SubscriptionFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode="create"
      />
    </div>
  )
}
