'use client'

import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Users, FileText, CreditCard, DollarSign, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// Mock data for development
const mockRevenueData = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  revenue: Math.floor(Math.random() * 10000) + 5000,
}))

// Types
interface BillingStats {
  totalRevenue: number
  revenueChange: number
  activeSubscriptions: number
  subscriptionsChange: number
  pendingInvoices: number
  invoicesChange: number
  activeTenants: number
  tenantsChange: number
}

interface Invoice {
  id: string
  tenant: string
  amount: number
  status: 'paid' | 'pending' | 'overdue'
  date: string
}

// API functions
const fetchBillingStats = async (): Promise<BillingStats> => {
  const response = await fetch('/api/billing/stats')
  if (!response.ok) throw new Error('Failed to fetch billing stats')
  return response.json()
}

const fetchRecentInvoices = async (): Promise<Invoice[]> => {
  const response = await fetch('/api/billing/invoices?limit=5')
  if (!response.ok) throw new Error('Failed to fetch invoices')
  return response.json()
}

// Metric Card Component
function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  loading,
}: {
  title: string
  value: string | number
  change: number
  icon: React.ElementType
  loading?: boolean
}) {
  const isPositive = change >= 0

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="h-8 w-8 rounded-md bg-[#635BFF]/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-[#635BFF]" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-bold">{value}</p>
          <div className="flex items-center text-xs">
            {isPositive ? (
              <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
            )}
            <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
              {isPositive ? '+' : ''}{change}%
            </span>
            <span className="text-muted-foreground ml-1">vs last month</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Chart Loading Skeleton
function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-80 w-full" />
      </CardContent>
    </Card>
  )
}

// Table Loading Skeleton
function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Error State Component
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">Failed to load data</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline" className="border-[#635BFF] text-[#635BFF] hover:bg-[#635BFF] hover:text-white">
        Try Again
      </Button>
    </div>
  )
}

// Empty State Component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">No data available</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  // Fetch billing stats
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery<BillingStats>({
    queryKey: ['billing-stats'],
    queryFn: fetchBillingStats,
    retry: 1,
  })

  // Fetch recent invoices
  const {
    data: invoices,
    isLoading: invoicesLoading,
    error: invoicesError,
    refetch: refetchInvoices,
  } = useQuery<Invoice[]>({
    queryKey: ['recent-invoices'],
    queryFn: fetchRecentInvoices,
    retry: 1,
  })

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const getStatusBadge = (status: Invoice['status']) => {
    const variants = {
      paid: 'bg-green-100 text-green-700 hover:bg-green-100',
      pending: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
      overdue: 'bg-red-100 text-red-700 hover:bg-red-100',
    }
    return (
      <Badge className={variants[status]} variant="secondary">
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Welcome back! Here's an overview of your billing analytics.
        </p>
      </div>

      {/* Metrics Grid */}
      {statsError ? (
        <Card>
          <CardContent className="pt-6">
            <ErrorState
              message={(statsError as Error).message}
              onRetry={() => refetchStats()}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Revenue"
            value={stats ? formatCurrency(stats.totalRevenue) : '$0.00'}
            change={stats?.revenueChange ?? 0}
            icon={DollarSign}
            loading={statsLoading}
          />
          <MetricCard
            title="Active Subscriptions"
            value={stats?.activeSubscriptions ?? 0}
            change={stats?.subscriptionsChange ?? 0}
            icon={CreditCard}
            loading={statsLoading}
          />
          <MetricCard
            title="Pending Invoices"
            value={stats?.pendingInvoices ?? 0}
            change={stats?.invoicesChange ?? 0}
            icon={FileText}
            loading={statsLoading}
          />
          <MetricCard
            title="Active Tenants"
            value={stats?.activeTenants ?? 0}
            change={stats?.tenantsChange ?? 0}
            icon={Users}
            loading={statsLoading}
          />
        </div>
      )}

      {/* Revenue Chart */}
      {statsLoading ? (
        <ChartSkeleton />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
            <p className="text-sm text-muted-foreground">
              Daily revenue for the last 30 days
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={mockRevenueData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#635BFF"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#635BFF' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Invoices Table */}
      {invoicesLoading ? (
        <TableSkeleton />
      ) : invoicesError ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorState
              message={(invoicesError as Error).message}
              onRetry={() => refetchInvoices()}
            />
          </CardContent>
        </Card>
      ) : !invoices || invoices.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState message="No invoices have been created yet." />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest 5 invoices from your tenants
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice ID</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      {invoice.id}
                    </TableCell>
                    <TableCell className="font-medium">{invoice.tenant}</TableCell>
                    <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                    <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(invoice.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
