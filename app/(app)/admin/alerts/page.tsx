'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { alertHistoryService } from '@/lib/services/alert-history.service';
import { Alert, AlertFilters, DateRangeOption } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Breadcrumb } from '@/components/navigation/breadcrumb';

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Build filters
  const filters: AlertFilters & { page: number; limit: number } = {
    dateRange,
    page,
    limit: 50,
  };

  if (selectedSeverity !== 'all') {
    filters.severity = selectedSeverity as any;
  }

  if (selectedStatus !== 'all') {
    filters.status = selectedStatus as any;
  }

  // Fetch alert stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['alert-stats', dateRange],
    queryFn: () => alertHistoryService.getAlertStats({ dateRange }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch alert history
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyError,
    refetch,
  } = useQuery({
    queryKey: ['alert-history', filters],
    queryFn: () => alertHistoryService.getAlertHistory(filters),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Update last updated timestamp
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdated(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Acknowledge alert mutation
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.acknowledgeAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
    },
  });

  // Resolve alert mutation
  const resolveMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.resolveAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
    },
  });

  // Delete alert mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
    },
  });

  const stats = statsData?.data;
  const alerts = historyData?.data || [];
  const pagination = historyData?.pagination;

  // Clear filters
  const clearFilters = () => {
    setSelectedSeverity('all');
    setSelectedStatus('all');
    setPage(1);
  };

  // Format duration
  const formatDuration = (minutes?: number) => {
    if (!minutes) return 'N/A';

    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Get status icon and color
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'firing':
        return {
          icon: <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />,
          label: 'Firing',
          className: 'text-red-600',
        };
      case 'acknowledged':
        return {
          icon: <div className="h-3 w-3 rounded-full bg-yellow-500" />,
          label: 'Acknowledged',
          className: 'text-yellow-600',
        };
      case 'resolved':
        return {
          icon: <div className="h-3 w-3 rounded-full bg-green-500" />,
          label: 'Resolved',
          className: 'text-green-600',
        };
      default:
        return {
          icon: <div className="h-3 w-3 rounded-full bg-gray-500" />,
          label: status,
          className: 'text-gray-600',
        };
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Alerts' }
        ]}
      />

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Alert History</h1>
        <p className="text-muted-foreground">
          Track and manage Prometheus alerts with acknowledgment workflow
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            )}
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-red-600">{stats?.active || 0}</div>
            )}
          </CardContent>
        </Card>

        {/* Average Resolution Time */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {formatDuration(stats?.avgResolutionTime)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Critical Count */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-red-600">{stats?.criticalCount || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter alerts by date range, severity, and status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Time Range Buttons */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Time Range</label>
              <div className="flex gap-2">
                <Button
                  variant={dateRange === '7d' ? 'default' : 'outline'}
                  onClick={() => {
                    setDateRange('7d');
                    setPage(1);
                  }}
                  size="sm"
                >
                  Last 7 Days
                </Button>
                <Button
                  variant={dateRange === '30d' ? 'default' : 'outline'}
                  onClick={() => {
                    setDateRange('30d');
                    setPage(1);
                  }}
                  size="sm"
                >
                  Last 30 Days
                </Button>
                <Button
                  variant={dateRange === '90d' ? 'default' : 'outline'}
                  onClick={() => {
                    setDateRange('90d');
                    setPage(1);
                  }}
                  size="sm"
                >
                  Last 90 Days
                </Button>
              </div>
            </div>

            {/* Filter Dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Severity Filter */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Severity</label>
                <Select
                  value={selectedSeverity}
                  onValueChange={(value) => {
                    setSelectedSeverity(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Severities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => {
                    setSelectedStatus(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="firing">Firing</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Clear Filters */}
            {(selectedSeverity !== 'all' || selectedStatus !== 'all') && (
              <div>
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Alerts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Alert Timeline</CardTitle>
              <CardDescription>
                {pagination && (
                  <span>
                    Showing {alerts.length} of {pagination.total} alerts
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="text-sm text-muted-foreground">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {historyError && (
            <div className="text-center py-8 text-red-500">
              <AlertCircle className="h-12 w-12 mx-auto mb-4" />
              <p>Failed to load alerts</p>
              <Button onClick={() => refetch()} className="mt-4" variant="outline">
                Retry
              </Button>
            </div>
          )}

          {historyLoading && (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!historyLoading && !historyError && alerts.length === 0 && (
            <div className="text-center py-12">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold mb-2">No alerts found</h3>
              <p className="text-sm text-muted-foreground">
                Adjust filters to see more alerts
              </p>
            </div>
          )}

          {!historyLoading && !historyError && alerts.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead>Alert Name</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => {
                    const statusDisplay = getStatusDisplay(alert.status);

                    return (
                      <TableRow key={alert.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {statusDisplay.icon}
                            <span className={`text-sm font-medium ${statusDisplay.className}`}>
                              {statusDisplay.label}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{alert.alertName}</div>
                            {alert.description && (
                              <div className="text-sm text-muted-foreground">
                                {alert.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={alert.severity === 'critical' ? 'destructive' : 'default'}
                            className={
                              alert.severity === 'warning'
                                ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                                : ''
                            }
                          >
                            {alert.severity.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {formatDistanceToNow(new Date(alert.startedAt), { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{formatDuration(alert.durationMinutes)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {alert.status === 'firing' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => acknowledgeMutation.mutate(alert.id)}
                                disabled={acknowledgeMutation.isPending}
                              >
                                Acknowledge
                              </Button>
                            )}
                            {(alert.status === 'firing' || alert.status === 'acknowledged') && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => resolveMutation.mutate(alert.id)}
                                disabled={resolveMutation.isPending}
                              >
                                Resolve
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (
                                  confirm(
                                    'Are you sure you want to delete this alert from history?'
                                  )
                                ) {
                                  deleteMutation.mutate(alert.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page === pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
