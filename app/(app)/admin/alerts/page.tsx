'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { alertHistoryService } from '@/lib/services/alert-history.service';
import { AlertFilters as AlertFiltersType, DateRangeOption } from '@/lib/types';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTrendChart } from '@/components/alerts/alert-trend-chart';
import { AlertDetailSlideOver } from '@/components/alerts/alert-detail-slide-over';
import { BulkActionBar } from '@/components/alerts/bulk-action-bar';
import { AlertFilters } from '@/components/alerts/alert-filters';

// Helper function to generate mock trend data
function generateTrendData(days: number) {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);
    data.push({
      date: format(date, 'yyyy-MM-dd'),
      critical: Math.floor(Math.random() * 10),
      warning: Math.floor(Math.random() * 15),
      info: Math.floor(Math.random() * 20),
    });
  }
  return data;
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [isSlideOverOpen, setIsSlideOverOpen] = useState(false);

  // Build filters
  const filters: AlertFiltersType & { page: number; limit: number } = {
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
    refetchInterval: 30000,
  });

  // Fetch previous period stats for trends
  const { data: prevStatsData } = useQuery({
    queryKey: ['alert-stats-prev', dateRange],
    queryFn: () => {
      // Calculate previous period
      let prevRange: DateRangeOption = '30d';
      if (dateRange === '24h') prevRange = '24h';
      if (dateRange === '7d') prevRange = '7d';
      if (dateRange === '30d') prevRange = '30d';
      if (dateRange === '90d') prevRange = '90d';
      return alertHistoryService.getAlertStats({ dateRange: prevRange });
    },
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
    refetchInterval: 30000,
  });

  // Generate trend data
  const trendData = useMemo(() => {
    const days = dateRange === '24h' ? 1 : dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return generateTrendData(days);
  }, [dateRange]);

  // Update last updated timestamp
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdated(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Mutations
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.acknowledgeAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success('Alert acknowledged');
      setIsSlideOverOpen(false);
    },
    onError: () => {
      toast.error('Failed to acknowledge alert');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.resolveAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success('Alert resolved');
      setIsSlideOverOpen(false);
    },
    onError: () => {
      toast.error('Failed to resolve alert');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => alertHistoryService.deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success('Alert deleted');
      setIsSlideOverOpen(false);
    },
    onError: () => {
      toast.error('Failed to delete alert');
    },
  });

  // Bulk mutations
  const bulkAcknowledgeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => alertHistoryService.acknowledgeAlert(id)));
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success(`${ids.length} alerts acknowledged`);
      setSelectedAlerts(new Set());
    },
    onError: () => {
      toast.error('Failed to acknowledge alerts');
    },
  });

  const bulkResolveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => alertHistoryService.resolveAlert(id)));
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success(`${ids.length} alerts resolved`);
      setSelectedAlerts(new Set());
    },
    onError: () => {
      toast.error('Failed to resolve alerts');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => alertHistoryService.deleteAlert(id)));
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['alert-history'] });
      queryClient.invalidateQueries({ queryKey: ['alert-stats'] });
      toast.success(`${ids.length} alerts deleted`);
      setSelectedAlerts(new Set());
    },
    onError: () => {
      toast.error('Failed to delete alerts');
    },
  });

  const stats = statsData?.data;
  const prevStats = prevStatsData?.data;
  const alerts = historyData?.data || [];
  const pagination = historyData?.pagination;

  // Filter alerts by search query
  const filteredAlerts = useMemo(() => {
    if (!searchQuery.trim()) return alerts;
    const query = searchQuery.toLowerCase();
    return alerts.filter(
      (alert) =>
        alert.alertName.toLowerCase().includes(query) ||
        alert.description?.toLowerCase().includes(query)
    );
  }, [alerts, searchQuery]);

  // Clear filters
  const clearFilters = () => {
    setSelectedSeverity('all');
    setSelectedStatus('all');
    setSearchQuery('');
    setPage(1);
  };

  // Format duration
  const formatDuration = (minutes?: number) => {
    if (!minutes) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // Calculate trend
  const calculateTrend = (current?: number, previous?: number) => {
    if (!current || !previous) return { value: 0, direction: 'neutral' as const };
    const diff = current - previous;
    const percentage = Math.round((diff / previous) * 100);
    if (diff > 0) return { value: percentage, direction: 'up' as const };
    if (diff < 0) return { value: Math.abs(percentage), direction: 'down' as const };
    return { value: 0, direction: 'neutral' as const };
  };

  // Get status display
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

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedAlerts.size === filteredAlerts.length) {
      setSelectedAlerts(new Set());
    } else {
      setSelectedAlerts(new Set(filteredAlerts.map((a) => a.id)));
    }
  };

  const toggleSelectAlert = (id: string) => {
    const newSelected = new Set(selectedAlerts);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAlerts(newSelected);
  };

  const handleBulkAcknowledge = () => {
    const ids = Array.from(selectedAlerts);
    bulkAcknowledgeMutation.mutate(ids);
  };

  const handleBulkResolve = () => {
    const ids = Array.from(selectedAlerts);
    bulkResolveMutation.mutate(ids);
  };

  const handleBulkDelete = () => {
    if (confirm(`Are you sure you want to delete ${selectedAlerts.size} alerts?`)) {
      const ids = Array.from(selectedAlerts);
      bulkDeleteMutation.mutate(ids);
    }
  };

  const handleViewDetails = (alert: any) => {
    setSelectedAlert(alert);
    setIsSlideOverOpen(true);
  };

  // Metric card component with trends
  const MetricCard = ({ title, value, icon, trend, isLoading, isCritical = false }: any) => {
    const Icon = icon;
    const trendIcon =
      trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;
    const TrendIcon = trendIcon;

    // For alerts, up is bad (red), down is good (green)
    const trendColor =
      trend?.direction === 'up'
        ? 'text-red-600'
        : trend?.direction === 'down'
          ? 'text-green-600'
          : 'text-gray-500';

    return (
      <Card className="transition-all hover:shadow-lg hover:-translate-y-0.5">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className={`h-4 w-4 ${isCritical ? 'text-red-500' : 'text-muted-foreground'}`} />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <>
              <div className={`text-2xl font-bold ${isCritical ? 'text-red-600' : ''}`}>
                {value}
              </div>
              {trend && trend.value !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${trendColor}`}>
                  <TrendIcon className="h-3 w-3" />
                  <span className="font-medium">
                    {trend.direction === 'up' ? '+' : '-'}
                    {trend.value}% from last period
                  </span>
                </div>
              )}
              {trend && trend.value === 0 && (
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                  <Minus className="h-3 w-3" />
                  <span>No change</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Alert History</h1>
        <p className="text-muted-foreground">
          Track and manage Prometheus alerts with acknowledgment workflow
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Alerts"
          value={stats?.total || 0}
          icon={AlertTriangle}
          trend={calculateTrend(stats?.total, prevStats?.total)}
          isLoading={statsLoading}
        />
        <MetricCard
          title="Active Alerts"
          value={stats?.active || 0}
          icon={AlertCircle}
          trend={calculateTrend(stats?.active, prevStats?.active)}
          isLoading={statsLoading}
          isCritical
        />
        <MetricCard
          title="Avg Resolution Time"
          value={formatDuration(stats?.avgResolutionTime)}
          icon={Clock}
          trend={calculateTrend(stats?.avgResolutionTime, prevStats?.avgResolutionTime)}
          isLoading={statsLoading}
        />
        <MetricCard
          title="Critical Alerts"
          value={stats?.criticalCount || 0}
          icon={AlertTriangle}
          trend={calculateTrend(stats?.criticalCount, prevStats?.criticalCount)}
          isLoading={statsLoading}
          isCritical
        />
      </div>

      {/* Alert Trend Chart */}
      <AlertTrendChart data={trendData} isLoading={statsLoading} />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter alerts by date range, severity, and status</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertFilters
            dateRange={dateRange}
            onDateRangeChange={(range) => {
              setDateRange(range);
              setPage(1);
            }}
            severity={selectedSeverity}
            onSeverityChange={(severity) => {
              setSelectedSeverity(severity);
              setPage(1);
            }}
            status={selectedStatus}
            onStatusChange={(status) => {
              setSelectedStatus(status);
              setPage(1);
            }}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearFilters={clearFilters}
          />
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
                    Showing {filteredAlerts.length} of {pagination.total} alerts
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
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
              <h3 className="text-lg font-semibold mb-2">Failed to load alerts</h3>
              <p className="text-sm text-muted-foreground mb-4">
                There was an error loading the alerts. Please try again.
              </p>
              <Button onClick={() => refetch()} variant="outline">
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

          {!historyLoading && !historyError && filteredAlerts.length === 0 && searchQuery && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">No alerts match your filters</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Try adjusting your search or filter criteria to see more results.
              </p>
              <Button variant="outline" onClick={clearFilters}>
                Clear Filters
              </Button>
            </div>
          )}

          {!historyLoading &&
            !historyError &&
            filteredAlerts.length === 0 &&
            !searchQuery &&
            stats?.total === 0 && (
              <div className="text-center py-12">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                <h3 className="text-xl font-semibold mb-2">Great job! 🎉</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  All alerts have been resolved.
                </p>
                {stats?.avgResolutionTime && (
                  <p className="text-sm text-muted-foreground">
                    Average resolution time: <span className="font-semibold">{formatDuration(stats.avgResolutionTime)}</span>
                  </p>
                )}
              </div>
            )}

          {!historyLoading && !historyError && filteredAlerts.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={
                          selectedAlerts.size === filteredAlerts.length &&
                          filteredAlerts.length > 0
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead>Alert Name</TableHead>
                    <TableHead className="w-[120px]">Severity</TableHead>
                    <TableHead className="w-[150px]">Started</TableHead>
                    <TableHead className="w-[100px]">Duration</TableHead>
                    <TableHead className="text-right w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((alert, index) => {
                    const statusDisplay = getStatusDisplay(alert.status);
                    const isSelected = selectedAlerts.has(alert.id);

                    return (
                      <TableRow
                        key={alert.id}
                        className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                        } ${isSelected ? 'bg-blue-50' : ''}`}
                        onClick={() => handleViewDetails(alert)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectAlert(alert.id)}
                            aria-label={`Select ${alert.alertName}`}
                          />
                        </TableCell>
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
                            <div className="font-medium text-gray-900">{alert.alertName}</div>
                            {alert.description && (
                              <div className="text-sm text-muted-foreground line-clamp-1">
                                {alert.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-xs font-bold px-3 py-1.5 ${
                              alert.severity === 'critical'
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : alert.severity === 'warning'
                                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                                  : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                          >
                            {alert.severity.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-gray-600">
                            {formatDistanceToNow(new Date(alert.startedAt), { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-gray-900">
                            {formatDuration(alert.durationMinutes)}
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleViewDetails(alert)}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {alert.status === 'firing' && (
                                <DropdownMenuItem
                                  onClick={() => acknowledgeMutation.mutate(alert.id)}
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Acknowledge
                                </DropdownMenuItem>
                              )}
                              {(alert.status === 'firing' || alert.status === 'acknowledged') && (
                                <DropdownMenuItem
                                  onClick={() => resolveMutation.mutate(alert.id)}
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Resolve
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => {
                                  if (
                                    confirm(
                                      'Are you sure you want to delete this alert from history?'
                                    )
                                  ) {
                                    deleteMutation.mutate(alert.id);
                                  }
                                }}
                              >
                                <AlertTriangle className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
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

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedAlerts.size}
        onAcknowledge={handleBulkAcknowledge}
        onResolve={handleBulkResolve}
        onDelete={handleBulkDelete}
        onClear={() => setSelectedAlerts(new Set())}
        isLoading={
          bulkAcknowledgeMutation.isPending ||
          bulkResolveMutation.isPending ||
          bulkDeleteMutation.isPending
        }
      />

      {/* Alert Detail Slide-Over */}
      <AlertDetailSlideOver
        alert={selectedAlert}
        isOpen={isSlideOverOpen}
        onClose={() => {
          setIsSlideOverOpen(false);
          setSelectedAlert(null);
        }}
        onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
        onResolve={(id) => resolveMutation.mutate(id)}
        onDelete={(id) => deleteMutation.mutate(id)}
        isActionLoading={
          acknowledgeMutation.isPending ||
          resolveMutation.isPending ||
          deleteMutation.isPending
        }
      />
    </div>
  );
}
