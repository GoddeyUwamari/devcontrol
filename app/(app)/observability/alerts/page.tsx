'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock, Sparkles, ArrowRight, RefreshCw } from 'lucide-react';
import { alertHistoryService } from '@/lib/services/alert-history.service';
import { Alert, AlertFilters as AlertFiltersType, DateRangeOption } from '@/lib/types';
import { subDays, format } from 'date-fns';
import { toast } from 'sonner';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

function generateTrendData(days: number) {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);
    data.push({ date: format(date, 'yyyy-MM-dd'), critical: Math.floor(Math.random() * 10), warning: Math.floor(Math.random() * 15), info: Math.floor(Math.random() * 20) });
  }
  return data;
}

const DEMO_ALERTS: Alert[] = [
  { id: 'a1', alertName: 'High CPU Usage',          serviceName: 'api-gateway',          severity: 'critical', status: 'firing',       description: 'CPU usage above 90% for 15 minutes on api-gateway ECS cluster.',  labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(), durationMinutes: 25,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a2', alertName: 'Lambda Invocation Spike', serviceName: 'payment-processor',    severity: 'critical', status: 'firing',       description: 'Lambda invocation count increased 178% in the last 10 minutes.',   labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(), durationMinutes: 12,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a3', alertName: 'High Error Rate',         serviceName: 'auth-service',         severity: 'warning',  status: 'firing',       description: 'Error rate at 1.23%, above 1% threshold.',                        labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),  durationMinutes: 8,   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a4', alertName: 'RDS Connection Pool',     serviceName: 'payment-processor',    severity: 'warning',  status: 'acknowledged', description: 'RDS connection pool at 85% capacity.',                             labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(), durationMinutes: 45,  acknowledgedBy: 'sarah.chen', acknowledgedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a5', alertName: 'Memory Pressure',         serviceName: 'analytics-worker',     severity: 'warning',  status: 'firing',       description: 'Memory usage at 87% on analytics-worker EC2 instance.',           labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(), durationMinutes: 18,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a6', alertName: 'Disk Space Low',          serviceName: 'notification-service', severity: 'warning',  status: 'firing',       description: 'Disk usage at 78% on notification-service.',                      labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), durationMinutes: 60,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a7', alertName: 'Deployment Failed',       serviceName: 'auth-service',         severity: 'critical', status: 'resolved',     description: 'Deployment to staging failed. Rolled back to previous version.',  labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(), durationMinutes: 22,  resolvedAt: new Date(Date.now() - 1000 * 60 * 68).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'a8', alertName: 'SSL Certificate Expiry',  serviceName: 'api-gateway',          severity: 'warning',  status: 'acknowledged', description: 'SSL certificate expires in 14 days. Renew before expiry.',         labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), durationMinutes: 180, acknowledgedBy: 'mike.johnson', acknowledgedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];
const DEMO_STATS = { total: 4, active: 2, critical: 1, avgResolutionTime: 47 };
const getDemoCostImpact = (a: Alert) => a.status === 'resolved' || a.status === 'acknowledged' ? 'No cost impact' : a.severity === 'critical' ? '+$120/mo estimated' : '+$48/mo if sustained';

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Loading...</div>}>
      <AlertsContent />
    </Suspense>
  );
}

function AlertsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState<DateRangeOption>((searchParams.get('dateRange') as DateRangeOption) || '30d');
  const [selectedSeverity, setSelectedSeverity] = useState<string>(searchParams.get('severity') || 'all');
  const [selectedStatus, setSelectedStatus] = useState<string>(searchParams.get('status') || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());

  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;

  useEffect(() => {
    const urlDateRange = searchParams.get('dateRange') as DateRangeOption;
    const urlSeverity = searchParams.get('severity');
    const urlStatus = searchParams.get('status');
    if (urlDateRange && urlDateRange !== dateRange) setDateRange(urlDateRange);
    if (urlSeverity && urlSeverity !== selectedSeverity) setSelectedSeverity(urlSeverity);
    if (urlStatus && urlStatus !== selectedStatus) setSelectedStatus(urlStatus);
  }, [searchParams]);

  const updateURL = (updates: { severity?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (updates.severity !== undefined) { if (updates.severity === 'all') params.delete('severity'); else params.set('severity', updates.severity); }
    if (updates.status !== undefined) { if (updates.status === 'all') params.delete('status'); else params.set('status', updates.status); }
    const queryString = params.toString();
    router.push(`/admin/alerts${queryString ? `?${queryString}` : ''}`);
  };

  const filters: AlertFiltersType & { page: number; limit: number } = { dateRange, page, limit: 50, ...(selectedSeverity !== 'all' && { severity: selectedSeverity as any }), ...(selectedStatus !== 'all' && { status: selectedStatus as any }) };

  const { data: statsData } = useQuery({ queryKey: ['alert-stats', dateRange], queryFn: () => alertHistoryService.getAlertStats({ dateRange }), refetchInterval: 30000 });
  const { data: historyData, isLoading: historyLoading, refetch } = useQuery({ queryKey: ['alert-history', filters], queryFn: () => alertHistoryService.getAlertHistory(filters), refetchInterval: 30000 });

  const acknowledgeMutation = useMutation({ mutationFn: (id: string) => alertHistoryService.acknowledgeAlert(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['alert-history'] }); queryClient.invalidateQueries({ queryKey: ['alert-stats'] }); toast.success('Alert acknowledged'); } });
  const resolveMutation = useMutation({ mutationFn: (id: string) => alertHistoryService.resolveAlert(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['alert-history'] }); queryClient.invalidateQueries({ queryKey: ['alert-stats'] }); toast.success('Alert resolved'); } });

  const displayAlerts: Alert[] = isDemoActive ? DEMO_ALERTS : (historyData?.data || []);
  const displayStats = isDemoActive ? DEMO_STATS : { total: statsData?.data?.total || 0, active: statsData?.data?.active || 0, critical: statsData?.data?.criticalCount || 0, avgResolutionTime: statsData?.data?.avgResolutionTime || 0 };

  const filteredAlerts = displayAlerts.filter((a: Alert) => {
    if (selectedSeverity !== 'all' && a.severity !== selectedSeverity) return false;
    if (selectedStatus !== 'all' && a.status !== selectedStatus) return false;
    if (searchQuery && !a.alertName.toLowerCase().includes(searchQuery.toLowerCase()) && !a.serviceName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Active Alerts</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Live alerts and incidents across all services · Real-time monitoring</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refetch()} className="flex items-center gap-2 bg-white text-slate-500 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <RefreshCw size={14} /> Refresh
          </button>
          <a href="/observability/alert-history" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap">
            <Clock size={14} /> Alert History
          </a>
        </div>
      </div>

      {/* AI Insight banner */}
      <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-6 py-4 mb-6 flex items-start gap-3.5">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-white" /></div>
        <div className="flex-1">
          <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-widest mb-1">AI Insight</p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {isDemoActive
              ? '2 critical alerts firing. API Gateway latency spike detected in us-east-1 — P99 latency at 2,400ms. EC2 CPU spike sustained for 8 minutes. Estimated cost impact if unresolved: $168/month.'
              : displayStats.active > 0
                ? `${displayStats.critical} critical and ${displayStats.active - displayStats.critical} warning alerts active. Average resolution time is ${displayStats.avgResolutionTime} minutes.`
                : 'All systems healthy. No active alerts in the last 24 hours. Actively monitoring cost spikes, security risks, traffic thresholds, and latency degradation across all services.'}
          </p>
        </div>
        {displayStats.critical > 0 && (
          <a href="/monitoring" className="text-xs font-semibold text-red-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">View monitoring <ArrowRight size={11} /></a>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Total Alerts</p>
          <div className="text-3xl font-bold text-slate-900 tracking-tight leading-none mb-2">{displayStats.total}</div>
          <p className="text-xs text-slate-400">{displayStats.total === 0 ? 'Stable — last 7 days clean' : `${displayStats.total} recorded`}</p>
        </div>
        <div className={`rounded-xl p-4 sm:p-8 border ${displayStats.active === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Active Now</p>
          <div className={`text-3xl font-bold tracking-tight leading-none mb-2 ${displayStats.active === 0 ? 'text-green-600' : 'text-red-700'}`}>{displayStats.active}</div>
          <p className="text-xs text-slate-400">{displayStats.active === 0 ? 'All services healthy' : 'Requires immediate attention'}</p>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Critical</p>
          <div className={`text-3xl font-bold tracking-tight leading-none mb-2 ${displayStats.critical === 0 ? 'text-green-600' : 'text-red-700'}`}>{displayStats.critical}</div>
          <p className="text-xs text-slate-400">{displayStats.critical === 0 ? 'No critical issues' : 'Immediate action required'}</p>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Avg Resolution</p>
          <div className="text-3xl font-bold text-slate-900 tracking-tight leading-none mb-2">{displayStats.avgResolutionTime ? `${displayStats.avgResolutionTime}m` : '—'}</div>
          <p className="text-xs text-slate-400">{displayStats.avgResolutionTime ? 'Mean time to resolve' : 'No alerts resolved yet'}</p>
        </div>
      </div>

      {/* Demo summary strip */}
      {isDemoActive && (
        <div className="bg-slate-50 rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mr-2">Last 30 days:</span>
          {[{ label: 'alerts triggered', value: '12' }, { label: 'critical', value: '3' }, { label: 'avg resolution', value: '18 min' }, { label: 'Most common: CPU spikes', value: null }].map((item, i, arr) => (
            <span key={i} className="text-xs text-slate-500">{item.value && <span className="font-medium text-slate-900">{item.value} </span>}{item.label}{i < arr.length - 1 && <span className="mx-2 text-slate-300">·</span>}</span>
          ))}
        </div>
      )}

      {/* Recommended safeguards (real mode, no alerts) */}
      {!isDemoActive && displayAlerts.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-900">Recommended safeguards</span>
            <button className="bg-violet-700 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg border-none cursor-pointer hover:bg-violet-800 transition-colors">Apply all</button>
          </div>
          <div className="flex flex-col gap-2">
            {[
              { title: 'Set cost spike alert (>20% increase)', sub: 'Get notified before bills spike unexpectedly', btn: 'Set up →', href: '/settings' },
              { title: 'Enable anomaly detection', sub: 'AI-powered detection of unusual patterns', btn: 'Enable →', href: '/settings' },
              { title: 'Configure Slack escalation', sub: 'Route critical alerts to your team instantly', btn: 'Configure →', href: '/settings' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-green-600 font-bold text-sm mt-0.5">→</span>
                  <div>
                    <p className="text-xs font-medium text-slate-900 mb-0.5">{item.title}</p>
                    <p className="text-[11px] text-slate-400">{item.sub}</p>
                  </div>
                </div>
                <button onClick={() => router.push(item.href)} className="text-[11px] text-violet-700 bg-violet-50 border-none rounded px-2.5 py-1 cursor-pointer shrink-0 hover:bg-violet-100 transition-colors">{item.btn}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {/* Filters */}
        <div className="px-4 sm:px-7 py-4 border-b border-slate-100 flex flex-wrap items-center justify-end gap-3">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search alerts..."
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-900 outline-none focus:border-violet-500 w-40 transition-colors" />
          <div className="flex bg-slate-50 rounded-lg p-0.5 gap-0.5">
            {['all', 'critical', 'warning'].map(s => (
              <button key={s} onClick={() => setSelectedSeverity(s)}
                className={`px-3 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer capitalize transition-all ${selectedSeverity === s ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-50 rounded-lg p-0.5 gap-0.5">
            {['all', 'firing', 'acknowledged', 'resolved'].map(s => (
              <button key={s} onClick={() => setSelectedStatus(s)}
                className={`px-2.5 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer capitalize transition-all ${selectedStatus === s ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <div className="grid px-7 py-2.5 bg-slate-50 border-b border-slate-50 min-w-[780px]" style={{ gridTemplateColumns: '2fr 130px 110px 120px 90px 150px 150px' }}>
            {['Alert', 'Service', 'Severity', 'Status', 'Duration', 'Cost Impact', 'Actions'].map(col => (
              <span key={col} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{col}</span>
            ))}
          </div>
          {filteredAlerts.length === 0 ? (
            <EmptyState searchQuery={searchQuery} selectedSeverity={selectedSeverity} selectedStatus={selectedStatus} />
          ) : filteredAlerts.map((alert: Alert, idx: number) => {
            const sevCls = alert.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600';
            const statusCls = alert.status === 'firing' ? 'bg-red-50 text-red-600' : alert.status === 'acknowledged' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600';
            const statusLabel = alert.status === 'firing' ? 'Firing' : alert.status === 'acknowledged' ? 'Acknowledged' : 'Resolved';
            const costImpact = isDemoActive ? getDemoCostImpact(alert) : '—';
            const costIsPositive = costImpact.startsWith('+');
            return (
              <div key={alert.id} className={`grid px-7 py-3.5 items-center hover:bg-slate-50 transition-colors min-w-[780px] ${idx < filteredAlerts.length - 1 ? 'border-b border-slate-50' : ''}`} style={{ gridTemplateColumns: '2fr 130px 110px 120px 90px 150px 150px' }}>
                <div>
                  <p className="text-sm font-semibold text-slate-900 mb-0.5">{alert.alertName}</p>
                  <p className="text-[11px] text-slate-400 truncate max-w-xs">{alert.description}</p>
                </div>
                <span className="text-xs text-slate-500 font-mono truncate">{alert.serviceName || '—'}</span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full w-fit capitalize ${sevCls}`}>{alert.severity}</span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full w-fit ${statusCls}`}>{statusLabel}</span>
                <span className="text-xs text-slate-400">{alert.durationMinutes ? `${alert.durationMinutes}m` : '—'}</span>
                <span className={`text-xs ${costIsPositive ? 'text-red-700 font-medium' : 'text-slate-400'}`}>{costIsPositive ? `↑ ${costImpact}` : costImpact}</span>
                <div className="flex gap-1.5">
                  {alert.status === 'firing' && (
                    <button onClick={() => !isDemoActive && acknowledgeMutation.mutate(alert.id)} className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors">Acknowledge</button>
                  )}
                  {alert.status !== 'resolved' && (
                    <button onClick={() => !isDemoActive && resolveMutation.mutate(alert.id)} className="text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-green-100 transition-colors">Resolve</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden flex flex-col divide-y divide-slate-50">
          {filteredAlerts.length === 0 ? (
            <EmptyState searchQuery={searchQuery} selectedSeverity={selectedSeverity} selectedStatus={selectedStatus} />
          ) : filteredAlerts.map((alert: Alert) => {
            const sevCls = alert.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600';
            const statusCls = alert.status === 'firing' ? 'bg-red-50 text-red-600' : alert.status === 'acknowledged' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600';
            const statusLabel = alert.status === 'firing' ? 'Firing' : alert.status === 'acknowledged' ? 'Ack' : 'Resolved';
            return (
              <div key={alert.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-slate-900 leading-snug flex-1">{alert.alertName}</p>
                  <div className="flex gap-1.5 shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${sevCls}`}>{alert.severity}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCls}`}>{statusLabel}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-1.5 line-clamp-2">{alert.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">{alert.serviceName}</span>
                  <div className="flex gap-1.5">
                    {alert.status === 'firing' && <button onClick={() => !isDemoActive && acknowledgeMutation.mutate(alert.id)} className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg cursor-pointer">Acknowledge</button>}
                    {alert.status !== 'resolved' && <button onClick={() => !isDemoActive && resolveMutation.mutate(alert.id)} className="text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg cursor-pointer">Resolve</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Integrations panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mt-6">
        <p className="text-sm font-medium text-slate-900 mb-4">Get notified where your team works</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: <span className="text-white text-sm font-bold">#</span>, iconBg: 'bg-[#4A154B]', name: 'Slack', sub: 'Not connected', btn: 'Connect Slack' },
            { icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="white" strokeWidth="1.5" fill="none"/><path d="M1.5 4L8 9.5L14.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>, iconBg: 'bg-violet-700', name: 'Email', sub: 'Configure in settings', btn: 'Set up email' },
            { icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3L1 8l4 5M11 3l4 5-4 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>, iconBg: 'bg-emerald-600', name: 'Webhooks', sub: 'Not configured', btn: 'Add webhook' },
          ].map(({ icon, iconBg, name, sub, btn }) => (
            <div key={name} className="bg-slate-50 rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center mb-2`}>{icon}</div>
              <p className="text-sm font-medium text-slate-900 mb-1">{name}</p>
              <p className="text-[11px] text-slate-400 mb-2.5">{sub}</p>
              <button onClick={() => router.push('/settings')} className="text-[11px] text-violet-700 bg-violet-50 border-none rounded px-2.5 py-1 cursor-pointer hover:bg-violet-100 transition-colors block">{btn}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ searchQuery, selectedSeverity, selectedStatus }: { searchQuery: string; selectedSeverity: string; selectedStatus: string }) {
  const hasFilters = searchQuery || selectedSeverity !== 'all' || selectedStatus !== 'all';
  return (
    <div className="p-10 sm:p-16 text-center">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 ${hasFilters ? 'bg-slate-50' : 'bg-green-50'}`}>
        {hasFilters ? <AlertCircle size={20} className="text-slate-300" /> : <CheckCircle2 size={20} className="text-green-600" />}
      </div>
      <p className="text-base font-semibold text-slate-900 mb-1.5">{hasFilters ? 'No alerts match your filters' : 'All systems healthy'}</p>
      <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto">
        {hasFilters ? 'Try adjusting your search or filter criteria.' : 'No active alerts in the last 24 hours. Actively monitoring cost spikes, security risks, traffic thresholds, and latency degradation.'}
      </p>
    </div>
  );
}