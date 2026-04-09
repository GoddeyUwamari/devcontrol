'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
import { useRouter, useSearchParams } from 'next/navigation';
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
  Sparkles,
  ArrowRight,
  RefreshCw,
  Bell,
} from 'lucide-react';
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
import { Alert, AlertFilters as AlertFiltersType, DateRangeOption } from '@/lib/types';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTrendChart } from '@/components/alerts/alert-trend-chart';
import { AlertDetailSlideOver } from '@/components/alerts/alert-detail-slide-over';
import { BulkActionBar } from '@/components/alerts/bulk-action-bar';
import { AlertFilters } from '@/components/alerts/alert-filters';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

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

// Demo alert details used for display and cost impact in demo mode
const DEMO_ALERT_DETAILS = [
  { id: 'alert-1', name: 'API Gateway high latency', service: 'API Gateway', region: 'us-east-1', severity: 'critical', status: 'firing', duration: '14m', costImpact: '+$120/mo estimated', description: 'P99 latency exceeding 2000ms threshold' },
  { id: 'alert-2', name: 'EC2 CPU spike (prod)', service: 'EC2', region: 'us-east-1', severity: 'warning', status: 'firing', duration: '8m', costImpact: '+$48/mo if sustained', description: 'CPU utilization at 94% across 3 instances' },
  { id: 'alert-3', name: 'RDS connection pool warning', service: 'RDS', region: 'us-west-2', severity: 'warning', status: 'acknowledged', duration: '2h', costImpact: 'No cost impact', description: 'Connection pool at 87% capacity' },
  { id: 'alert-4', name: 'S3 bucket policy change', service: 'S3', region: 'eu-west-1', severity: 'info', status: 'resolved', duration: '1d', costImpact: 'No cost impact', description: 'Bucket policy modified — review recommended' },
];

const getDemoCostImpact = (a: Alert): string => {
  if (a.status === 'resolved' || a.status === 'acknowledged') return 'No cost impact';
  if (a.severity === 'critical') return '+$120/mo estimated';
  return '+$48/mo if sustained';
};

export default function AlertsPage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>}>
      <AlertsContent />
    </Suspense>
  );
}

function AlertsContent() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Initialize from URL params
  const [dateRange, setDateRange] = useState<DateRangeOption>(
    (searchParams.get('dateRange') as DateRangeOption) || '30d'
  );
  const [selectedSeverity, setSelectedSeverity] = useState<string>(
    searchParams.get('severity') || 'all'
  );
  const [selectedStatus, setSelectedStatus] = useState<string>(
    searchParams.get('status') || 'all'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [isSlideOverOpen, setIsSlideOverOpen] = useState(false);

  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;

  const DEMO_ALERTS: Alert[] = [
    { id: 'a1', alertName: 'High CPU Usage',          serviceName: 'api-gateway',          severity: 'critical', status: 'firing',       description: 'CPU usage above 90% for 15 minutes on api-gateway ECS cluster.',         labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(), durationMinutes: 25,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a2', alertName: 'Lambda Invocation Spike', serviceName: 'payment-processor',    severity: 'critical', status: 'firing',       description: 'Lambda invocation count increased 178% in the last 10 minutes.',          labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(), durationMinutes: 12,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a3', alertName: 'High Error Rate',         serviceName: 'auth-service',         severity: 'warning',  status: 'firing',       description: 'Error rate at 1.23%, above 1% threshold.',                               labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),  durationMinutes: 8,   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a4', alertName: 'RDS Connection Pool',     serviceName: 'payment-processor',    severity: 'warning',  status: 'acknowledged', description: 'RDS connection pool at 85% capacity. Monitor for further increase.',      labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(), durationMinutes: 45,  acknowledgedBy: 'sarah.chen', acknowledgedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a5', alertName: 'Memory Pressure',         serviceName: 'analytics-worker',     severity: 'warning',  status: 'firing',       description: 'Memory usage at 87% on analytics-worker EC2 instance.',                 labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(), durationMinutes: 18,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a6', alertName: 'Disk Space Low',          serviceName: 'notification-service', severity: 'warning',  status: 'firing',       description: 'Disk usage at 78% on notification-service. Trending toward full.',       labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), durationMinutes: 60,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a7', alertName: 'Deployment Failed',       serviceName: 'auth-service',         severity: 'critical', status: 'resolved',     description: 'Deployment to staging failed. Rolled back to previous version.',        labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(), durationMinutes: 22,  resolvedAt: new Date(Date.now() - 1000 * 60 * 68).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'a8', alertName: 'SSL Certificate Expiry',  serviceName: 'api-gateway',          severity: 'warning',  status: 'acknowledged', description: 'SSL certificate expires in 14 days. Renew before expiry.',              labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), durationMinutes: 180, acknowledgedBy: 'mike.johnson', acknowledgedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];

  const DEMO_STATS = { total: 4, active: 2, critical: 1, avgResolutionTime: 47 };

  // Sync URL params to state
  useEffect(() => {
    const urlDateRange = searchParams.get('dateRange') as DateRangeOption;
    const urlSeverity = searchParams.get('severity');
    const urlStatus = searchParams.get('status');

    if (urlDateRange && urlDateRange !== dateRange) setDateRange(urlDateRange);
    if (urlSeverity && urlSeverity !== selectedSeverity) setSelectedSeverity(urlSeverity);
    if (urlStatus && urlStatus !== selectedStatus) setSelectedStatus(urlStatus);
  }, [searchParams]);

  // Update URL when filters change
  const updateURL = (updates: { dateRange?: DateRangeOption; severity?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.dateRange) {
      if (updates.dateRange === '30d') {
        params.delete('dateRange');
      } else {
        params.set('dateRange', updates.dateRange);
      }
    }

    if (updates.severity !== undefined) {
      if (updates.severity === 'all') {
        params.delete('severity');
      } else {
        params.set('severity', updates.severity);
      }
    }

    if (updates.status !== undefined) {
      if (updates.status === 'all') {
        params.delete('status');
      } else {
        params.set('status', updates.status);
      }
    }

    const queryString = params.toString();
    router.push(`/admin/alerts${queryString ? `?${queryString}` : ''}`);
  };

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
      const prevRange: DateRangeOption = dateRange === '7d' ? '7d' : dateRange === '90d' ? '90d' : '30d';
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
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
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
  const pagination = historyData?.pagination;

  const displayAlerts = isDemoActive
    ? DEMO_ALERTS
    : (historyData?.data || []);

  const displayStats = isDemoActive
    ? DEMO_STATS
    : {
        total: statsData?.data?.total || 0,
        active: statsData?.data?.active || 0,
        critical: statsData?.data?.criticalCount || 0,
        avgResolutionTime: statsData?.data?.avgResolutionTime || 0,
      };

  const filteredAlerts = displayAlerts.filter((a: Alert) => {
    if (selectedSeverity !== 'all' && a.severity !== selectedSeverity) return false;
    if (selectedStatus !== 'all' && a.status !== selectedStatus) return false;
    if (searchQuery && !a.alertName.toLowerCase().includes(searchQuery.toLowerCase()) && !a.serviceName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Clear filters
  const clearFilters = () => {
    setSelectedSeverity('all');
    setSelectedStatus('all');
    setSearchQuery('');
    setPage(1);
    updateURL({ severity: 'all', status: 'all' });
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

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Active Alerts
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Live alerts and incidents across all services · Real-time monitoring
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
          <a href="/observability/alert-history" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Clock size={15} /> Alert History
          </a>
        </div>
      </div>

      {/* AI INSIGHT BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? '2 critical alerts firing. API Gateway latency spike detected in us-east-1 — P99 latency at 2,400ms. EC2 CPU spike sustained for 8 minutes. Estimated cost impact if unresolved: $168/month. Immediate attention required.'
              : displayStats.active > 0
                ? `${displayStats.critical} critical and ${displayStats.active - displayStats.critical} warning alerts active. Average resolution time is ${displayStats.avgResolutionTime} minutes.`
                : 'All systems healthy. No active alerts in the last 24 hours. Infrastructure is stable — actively monitoring cost spikes, security risks, traffic thresholds, and latency degradation across all services.'
            }
          </p>
        </div>
        {displayStats.critical > 0 && (
          <a href="/monitoring" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#DC2626', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            View monitoring <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* Total Alerts */}
        <div style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Total Alerts</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{displayStats.total}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>In selected period</p>
          {displayStats.total === 0 && <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '4px 0 0' }}>Stable — last 7 days clean</p>}
          {displayStats.total > 0 && <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '4px 0 0' }}>{displayStats.total} recorded</p>}
        </div>

        {/* Active Now */}
        <div style={{ background: displayStats.active === 0 ? '#EAF3DE' : '#FCEBEB', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: `0.5px solid ${displayStats.active === 0 ? '#639922' : '#F09595'}` }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Active Now</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: displayStats.active === 0 ? '#059669' : '#A32D2D', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{displayStats.active}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{displayStats.active === 0 ? 'All services healthy' : 'Requires immediate attention'}</p>
        </div>

        {/* Critical */}
        <div style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Critical</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: displayStats.critical === 0 ? '#059669' : '#A32D2D', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{displayStats.critical}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{displayStats.critical === 0 ? 'No critical issues' : 'Immediate action required'}</p>
        </div>

        {/* Avg Resolution */}
        <div style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Avg Resolution</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
            {displayStats.avgResolutionTime ? `${displayStats.avgResolutionTime}m` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            {displayStats.avgResolutionTime ? 'Mean time to resolve' : 'No alerts resolved yet'}
          </p>
        </div>

      </div>

      {/* Change 3 — 30-day historical summary strip (demo mode only) */}
      {isDemoActive && (
        <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 16px', display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '8px' }}>Last 30 days:</span>
          {[
            { label: 'alerts triggered', value: '12' },
            { label: 'critical', value: '3' },
            { label: 'avg resolution', value: '18 min' },
            { label: 'Most common: CPU spikes', value: null },
          ].map((item, i, arr) => (
            <span key={i} style={{ fontSize: '12px', color: '#475569' }}>
              {item.value && <span style={{ fontWeight: 500, color: '#0F172A' }}>{item.value} </span>}
              {item.label}
              {i < arr.length - 1 && <span style={{ margin: '0 8px', color: '#CBD5E1' }}>·</span>}
            </span>
          ))}
        </div>
      )}

      {/* Change 6 — Recommended Safeguards (real mode, no alerts only) */}
      {!isDemoActive && displayAlerts.length === 0 && (
        <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#0F172A' }}>Recommended safeguards</span>
            <button
              onClick={() => console.log('Apply all safeguards')}
              style={{ background: '#534AB7', color: 'white', fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
            >
              Apply all
            </button>
          </div>
          {[
            { title: 'Set cost spike alert (>20% increase)', sub: 'Get notified before bills spike unexpectedly', btnLabel: 'Set up →', onClick: () => console.log('set up cost alert') },
            { title: 'Enable anomaly detection', sub: 'AI-powered detection of unusual patterns', btnLabel: 'Enable →', onClick: () => console.log('enable anomaly') },
            { title: 'Configure Slack escalation', sub: 'Route critical alerts to your team instantly', btnLabel: 'Configure →', onClick: () => router.push('/settings') },
          ].map((item, i, arr) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', borderRadius: '8px', padding: '11px 14px', marginBottom: i < arr.length - 1 ? '8px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#1D9E75', fontWeight: 700, fontSize: '14px' }}>→</span>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A', margin: 0 }}>{item.title}</p>
                  <p style={{ fontSize: '11px', color: '#64748B', margin: '2px 0 0' }}>{item.sub}</p>
                </div>
              </div>
              <button onClick={item.onClick} style={{ fontSize: '11px', color: '#534AB7', background: '#EEEDFE', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}>
                {item.btnLabel}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ALERT TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>

        {/* Table header + filters */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search */}
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search alerts..."
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.82rem', color: '#0F172A', outline: 'none', width: '180px' }}
            />
            {/* Severity filter */}
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {['all', 'critical', 'warning'].map(s => (
                <button key={s} onClick={() => setSelectedSeverity(s)}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                    background: selectedSeverity === s ? '#fff' : 'transparent',
                    color: selectedSeverity === s ? '#0F172A' : '#64748B',
                    boxShadow: selectedSeverity === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>{s === 'all' ? 'All' : s}</button>
              ))}
            </div>
            {/* Status filter */}
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {['all', 'firing', 'acknowledged', 'resolved'].map(s => (
                <button key={s} onClick={() => setSelectedStatus(s)}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                    background: selectedStatus === s ? '#fff' : 'transparent',
                    color: selectedStatus === s ? '#0F172A' : '#64748B',
                    boxShadow: selectedStatus === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>{s === 'all' ? 'All' : s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 140px 120px 120px 120px 160px 160px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Alert', 'Service', 'Severity', 'Status', 'Duration', 'Cost Impact', 'Actions'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {filteredAlerts.length === 0 ? (() => {
          const hasActiveFilters = searchQuery || selectedSeverity !== 'all' || selectedStatus !== 'all';
          if (hasActiveFilters) {
            return (
              <div style={{ padding: isMobile ? '16px 14px' : '64px', textAlign: 'center' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <AlertCircle size={22} style={{ color: '#94A3B8' }} />
                </div>
                <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No alerts match your filters</p>
                <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                  Try adjusting your search or filter criteria.
                </p>
              </div>
            );
          }
          return (
            <div style={{ padding: isMobile ? '16px 14px' : '64px', textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <CheckCircle2 size={22} style={{ color: '#059669' }} />
              </div>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>All systems healthy</p>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                No active alerts in the last 24 hours. Here's what DevControl is actively watching:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px', margin: '12px auto 0', textAlign: 'left' }}>
                {[
                  'Cost spike anomalies (>20% increase)',
                  'Security misconfigurations',
                  'Traffic threshold breaches',
                  'Latency degradation patterns',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#534AB7', flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: '#475569' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })() : (
          filteredAlerts.map((alert: Alert, idx: number) => {
            const severityColor = alert.severity === 'critical' ? '#DC2626' : '#D97706';
            const severityBg    = alert.severity === 'critical' ? '#FEF2F2' : '#FFFBEB';
            const statusColor   = alert.status === 'firing' ? '#DC2626' : alert.status === 'acknowledged' ? '#D97706' : '#059669';
            const statusBg      = alert.status === 'firing' ? '#FEF2F2' : alert.status === 'acknowledged' ? '#FFFBEB' : '#F0FDF4';
            const statusLabel   = alert.status === 'firing' ? 'Firing' : alert.status === 'acknowledged' ? 'Acknowledged' : 'Resolved';
            const duration      = alert.durationMinutes ? `${alert.durationMinutes}m` : '—';

            // TODO: wire to cost impact API
            const costImpact = isDemoActive ? getDemoCostImpact(alert) : '—';
            const costIsPositive = costImpact.startsWith('+');
            const costIsNeutral = costImpact === '—' || costImpact === 'No cost impact';

            return (
              <div key={alert.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 140px 120px 120px 120px 160px 160px',
                  padding: '14px 28px',
                  borderBottom: idx < filteredAlerts.length - 1 ? '1px solid #F8FAFC' : 'none',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Alert name + description */}
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{alert.alertName}</p>
                  <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>{alert.description}</p>
                </div>

                {/* Service */}
                <span style={{ fontSize: '0.78rem', color: '#475569', fontFamily: 'monospace' }}>{alert.serviceName || '—'}</span>

                {/* Severity */}
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: severityBg, color: severityColor, width: 'fit-content', textTransform: 'capitalize' }}>
                  {alert.severity}
                </span>

                {/* Status */}
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: statusBg, color: statusColor, width: 'fit-content' }}>
                  {statusLabel}
                </span>

                {/* Duration */}
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>{duration}</span>

                {/* Cost Impact */}
                {/* TODO: wire to cost impact API */}
                <span style={{
                  fontSize: '0.78rem',
                  color: costIsPositive ? '#A32D2D' : costIsNeutral ? 'var(--color-text-tertiary, #94A3B8)' : '#475569',
                  fontWeight: costIsPositive ? 500 : 400,
                }}>
                  {costIsPositive ? `↑ ${costImpact}` : costImpact}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {alert.status === 'firing' && (
                    <button
                      onClick={() => !isDemoActive && acknowledgeMutation.mutate(alert.id)}
                      style={{ fontSize: '0.72rem', fontWeight: 700, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                      Acknowledge
                    </button>
                  )}
                  {alert.status !== 'resolved' && (
                    <button
                      onClick={() => !isDemoActive && resolveMutation.mutate(alert.id)}
                      style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* INTEGRATIONS PANEL */}
      <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', marginTop: '24px' }}>
        <p style={{ fontSize: '14px', fontWeight: 500, color: '#0F172A', margin: '0 0 14px' }}>
          Get notified where your team works
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>

          {/* Slack */}
          <div style={{ flex: 1, background: '#F8FAFC', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#4A154B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>#</span>
            </div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A', margin: '8px 0 4px' }}>Slack</p>
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 8px' }}>Not connected</p>
            <button
              onClick={() => router.push('/settings')}
              style={{ fontSize: '11px', color: '#534AB7', background: '#EEEDFE', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', display: 'block' }}
            >
              Connect Slack
            </button>
          </div>

          {/* Email */}
          <div style={{ flex: 1, background: '#F8FAFC', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#534AB7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="white" strokeWidth="1.5" fill="none"/>
                <path d="M1.5 4L8 9.5L14.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A', margin: '8px 0 4px' }}>Email</p>
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 8px' }}>Configure in settings</p>
            <button
              onClick={() => router.push('/settings')}
              style={{ fontSize: '11px', color: '#534AB7', background: '#EEEDFE', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', display: 'block' }}
            >
              Set up email
            </button>
          </div>

          {/* Webhooks */}
          <div style={{ flex: 1, background: '#F8FAFC', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#1D9E75', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 3L1 8l4 5M11 3l4 5-4 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A', margin: '8px 0 4px' }}>Webhooks</p>
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 8px' }}>Not configured</p>
            <button
              onClick={() => router.push('/settings')}
              style={{ fontSize: '11px', color: '#534AB7', background: '#EEEDFE', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', display: 'block' }}
            >
              Add webhook
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
