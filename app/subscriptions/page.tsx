'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal, AlertCircle, CreditCard } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

// Types
interface Subscription {
  id: string
  tenantName: string
  plan: string
  status: 'active' | 'cancelled' | 'past_due'
  amount: number
  nextBillingDate: string
}

type StatusFilter = 'all' | 'active' | 'cancelled' | 'past_due'

// API function
const fetchSubscriptions = async (status: StatusFilter): Promise<Subscription[]> => {
  const params = new URLSearchParams()
  if (status !== 'all') params.append('status', status)

  const response = await fetch(`/api/billing/subscriptions?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch subscriptions')
  return response.json()
}

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

  // Fetch subscriptions with status filter
  const {
    data: subscriptions,
    isLoading,
    error,
    refetch,
  } = useQuery<Subscription[]>({
    queryKey: ['subscriptions', statusFilter],
    queryFn: () => fetchSubscriptions(statusFilter),
    retry: 1,
  })

  // Status badge helper
  const getStatusBadge = (status: Subscription['status']) => {
    const variants = {
      active: 'bg-green-100 text-green-700 hover:bg-green-100',
      cancelled: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
      past_due: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
    }
    const labels = {
      active: 'Active',
      cancelled: 'Cancelled',
      past_due: 'Past Due',
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
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Manage and monitor all active subscriptions
        </p>
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
                    {subscription.tenantName}
                  </TableCell>
                  <TableCell>{subscription.plan}</TableCell>
                  <TableCell>{getStatusBadge(subscription.status)}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(subscription.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(subscription.nextBillingDate)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => console.log('View Details', subscription.id)}
                        >
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => console.log('Cancel Subscription', subscription.id)}
                          className="text-red-600"
                        >
                          Cancel Subscription
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
