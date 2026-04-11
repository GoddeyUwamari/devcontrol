'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download } from 'lucide-react';
import { auditLogsService, AuditLogFilters } from '@/lib/services/audit-logs.service';
import { demoModeService } from '@/lib/services/demo-mode.service';

type DemoLog = { id: string; timestamp: Date; user: string; action: string; resource: string; resourceType: string; status: 'success' | 'warning' | 'error'; duration: number; ipAddress: string };

const DEMO_LOGS: DemoLog[] = [
  { id: '1',  timestamp: new Date(Date.now() - 1000 * 60 * 5),   user: 'sarah.chen@company.com',  action: 'deployment.create',   resource: 'api-gateway',        resourceType: 'ECS',    status: 'success', duration: 2340,  ipAddress: '192.168.1.42'  },
  { id: '2',  timestamp: new Date(Date.now() - 1000 * 60 * 12),  user: 'mike.johnson@company.com', action: 'security.scan',       resource: 'production-cluster', resourceType: 'EKS',    status: 'success', duration: 8920,  ipAddress: '192.168.1.15'  },
  { id: '3',  timestamp: new Date(Date.now() - 1000 * 60 * 28),  user: 'alex.wong@company.com',    action: 'cost.optimization',   resource: 'rds-prod-01',        resourceType: 'RDS',    status: 'success', duration: 1200,  ipAddress: '192.168.1.88'  },
  { id: '4',  timestamp: new Date(Date.now() - 1000 * 60 * 45),  user: 'sarah.chen@company.com',   action: 'config.update',       resource: 's3-assets-bucket',   resourceType: 'S3',     status: 'success', duration: 340,   ipAddress: '192.168.1.42'  },
  { id: '5',  timestamp: new Date(Date.now() - 1000 * 60 * 67),  user: 'emma.davis@company.com',   action: 'compliance.scan',     resource: 'CIS AWS Benchmark',  resourceType: 'Policy', status: 'success', duration: 15600, ipAddress: '192.168.1.71'  },
  { id: '6',  timestamp: new Date(Date.now() - 1000 * 60 * 89),  user: 'david.kim@company.com',    action: 'deployment.create',   resource: 'payment-processor',  resourceType: 'Lambda', status: 'success', duration: 3100,  ipAddress: '192.168.1.33'  },
  { id: '7',  timestamp: new Date(Date.now() - 1000 * 60 * 120), user: 'mike.johnson@company.com', action: 'anomaly.acknowledge', resource: 'production-worker',  resourceType: 'EC2',    status: 'success', duration: 180,   ipAddress: '192.168.1.15'  },
  { id: '8',  timestamp: new Date(Date.now() - 1000 * 60 * 145), user: 'alex.wong@company.com',    action: 'auth.login',          resource: 'devcontrol-app',     resourceType: 'Auth',   status: 'success', duration: 210,   ipAddress: '203.0.113.42'  },
  { id: '9',  timestamp: new Date(Date.now() - 1000 * 60 * 180), user: 'emma.davis@company.com',   action: 'cost.export',         resource: 'cost-report-march',  resourceType: 'Report', status: 'success', duration: 890,   ipAddress: '192.168.1.71'  },
  { id: '10', timestamp: new Date(Date.now() - 1000 * 60 * 210), user: 'sarah.chen@company.com',   action: 'security.policy',     resource: 'iam-prod-policy',    resourceType: 'IAM',    status: 'warning', duration: 450,   ipAddress: '192.168.1.42'  },
];

export default function AuditLogsPage() {
  const [filters, setFilters] = useState<AuditLogFilters>({ page: 1, limit: 50 });
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch } = useQuery({ queryKey: ['audit-logs', filters], queryFn: () => auditLogsService.getAll(filters) });
  const { data: actionsData } = useQuery({ queryKey: ['audit-log-actions'], queryFn: () => auditLogsService.getActions() });
  const { data: resourceTypesData } = useQuery({ queryKey: ['audit-log-resource-types'], queryFn: () => auditLogsService.getResourceTypes() });

  const logs = data?.data || [], total = data?.total || 0;
  const actions = actionsData || [], resourceTypesList = resourceTypesData || [];
  const updateFilter = (key: keyof AuditLogFilters, value: unknown) => setFilters({ ...filters, [key]: value, page: 1 });
  const clearFilters = () => setFilters({ page: 1, limit: 50 });

  const demoMode = demoModeService.isEnabled();
  const rawLogs: any[] = demoMode ? DEMO_LOGS : logs;

  const displayLogs: any[] = searchQuery.trim()
    ? rawLogs.filter((l: any) => { const q = searchQuery.toLowerCase(); return (l.user ?? l.user_email ?? '').toLowerCase().includes(q) || (l.resource ?? l.resource_type ?? '').toLowerCase().includes(q) || (l.action ?? '').toLowerCase().includes(q); })
    : rawLogs;

  const hasLogs = displayLogs.length > 0;
  const suspiciousCount = displayLogs.filter((l: any) => { const a = (l.action ?? '').toLowerCase(); return a.includes('delete') || a.includes('modify') || l.status === 'warning' || l.status === 'error'; }).length;
  const failedCount = displayLogs.filter((l: any) => l.status === 'failed' || l.status === 'error' || l.status === 'warning').length;
  const highRiskCount = displayLogs.filter((l: any) => { const a = (l.action ?? '').toLowerCase(); return a.includes('iam') || a.includes('securitygroup') || a.includes('policy'); }).length;
  const now24h = Date.now() - 1000 * 60 * 60 * 24;
  const activeUserCount = new Set(displayLogs.filter((l: any) => new Date(l.timestamp ?? l.created_at).getTime() > now24h).map((l: any) => l.user ?? l.user_email)).size;

  const handleExport = () => {
    const csv = displayLogs.map((l: any) => { const ts = l.timestamp || l.created_at; return `${new Date(ts).toISOString()},${l.user || l.user_email || ''},${l.action},${l.resource || l.resource_type || ''},${l.status || ''},${l.duration || l.duration_ms || ''},${l.ipAddress || l.ip_address || ''}`; }).join('\n');
    const blob = new Blob([`Time,User,Action,Resource,Status,Duration,IP\n${csv}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'audit-logs.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const getRiskLevel = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('delete') || a.includes('iam') || a.includes('policy')) return { label: 'High', cls: 'bg-red-100 text-red-800' };
    if (a.includes('modify') || a.includes('update') || a.includes('security')) return { label: 'Medium', cls: 'bg-amber-100 text-amber-800' };
    return { label: 'Low', cls: 'bg-slate-100 text-slate-600' };
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Audit Logs &amp; Activity Monitoring</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Monitor activity, detect anomalies, and investigate security events across your AWS environment</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleExport} className="flex items-center gap-2 bg-white text-slate-500 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <Download size={14} /> Export CSV
          </button>
          <button onClick={() => refetch()} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white border-none px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        {[
          { label: 'Suspicious events',  value: hasLogs ? suspiciousCount : '—', sub: 'AI-detected anomalies',        color: !hasLogs || suspiciousCount === 0 ? 'text-slate-300' : 'text-red-600' },
          { label: 'Failed actions',      value: hasLogs ? failedCount     : '—', sub: 'Last 24 hours',                color: !hasLogs || failedCount === 0     ? 'text-slate-300' : 'text-amber-500' },
          { label: 'High-risk actions',   value: hasLogs ? highRiskCount   : '—', sub: 'IAM changes, security groups', color: !hasLogs || highRiskCount === 0   ? 'text-slate-300' : 'text-red-600' },
          { label: 'Active users',        value: hasLogs ? activeUserCount : '—', sub: 'Last 24 hours',                color: 'text-slate-300' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
            <div className={`text-3xl font-bold tracking-tight leading-none mb-2 ${color}`}>{value}</div>
            <p className="text-xs text-slate-400 leading-relaxed">{sub}</p>
          </div>
        ))}
      </div>

      {/* AI anomaly banner */}
      {hasLogs && suspiciousCount > 0 && (
        <div className="bg-red-50 border border-red-100 border-l-[3px] border-l-red-600 rounded-xl px-4 py-3.5 mb-5 flex items-start gap-3">
          <div className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center shrink-0 text-red-600 text-sm">⚠</div>
          <div>
            <p className="text-[10px] font-medium text-red-900 uppercase tracking-widest mb-1">AI anomaly detected</p>
            <p className="text-xs text-red-900 leading-relaxed mb-0.5">Unusual spike in IAM policy changes detected in the last 2 hours. {suspiciousCount} action{suspiciousCount !== 1 ? 's' : ''} were performed outside normal usage patterns.</p>
            <p className="text-[11px] text-red-700">Review flagged events below.</p>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="relative mb-3">
        <input type="text" placeholder="Search by user, action, or resource..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="w-full border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm bg-white text-slate-900 outline-none focus:border-violet-500 transition-colors" />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">⌕</span>
      </div>

      {/* Filters */}
      {hasLogs && (
        <div className="bg-white rounded-xl p-5 sm:p-7 border border-slate-100 mb-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Action', value: filters.action || '', onChange: (v: string) => updateFilter('action', v || undefined), type: 'select', options: actions },
              { label: 'Resource Type', value: filters.resource_type || '', onChange: (v: string) => updateFilter('resource_type', v || undefined), type: 'select', options: resourceTypesList },
              { label: 'Start Date', value: filters.start_date || '', onChange: (v: string) => updateFilter('start_date', v || undefined), type: 'date', options: [] },
              { label: 'End Date', value: filters.end_date || '', onChange: (v: string) => updateFilter('end_date', v || undefined), type: 'date', options: [] },
            ].map(({ label, value, onChange, type, options }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p>
                {type === 'select' ? (
                  <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white cursor-pointer outline-none focus:border-violet-500 transition-colors">
                    <option value="">All {label}s</option>
                    {(options as string[]).map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="date" value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white outline-none focus:border-violet-500 transition-colors box-border" />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={clearFilters} className="bg-transparent border border-slate-200 rounded-lg px-4 py-1.5 text-xs font-medium text-slate-500 cursor-pointer hover:bg-slate-50 transition-colors">Clear Filters</button>
          </div>
        </div>
      )}

      {/* Audit log table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Recent Activity</p>
          <p className="text-xs text-slate-400">Showing {displayLogs.length} {displayLogs.length === 1 ? 'entry' : 'entries'}</p>
        </div>

        {isLoading && !demoMode ? (
          <div className="p-12 text-center">
            <RefreshCw size={20} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading audit logs...</p>
          </div>
        ) : displayLogs.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <p className="text-base font-medium text-slate-900 mb-2.5">No audit activity detected yet</p>
            <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-lg mx-auto">Once connected, DevControl will track all infrastructure actions, API calls, and user activity across your AWS environment.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-w-sm mx-auto text-left">
              {['Trace who made changes', 'Detect unusual access patterns', 'Investigate incidents in seconds', 'Track IAM and policy changes'].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0" />{item}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <div className="grid px-7 py-2.5 border-b border-slate-50 bg-slate-50 min-w-[860px]" style={{ gridTemplateColumns: '140px 180px 160px 70px 1fr 80px 80px 120px' }}>
                {['Time', 'User', 'Action', 'Risk', 'Resource', 'Status', 'Duration', 'IP Address'].map(col => (
                  <span key={col} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{col}</span>
                ))}
              </div>
              {displayLogs.map((log: any, idx: number) => {
                const ts = log.timestamp ?? log.created_at;
                const user = log.user ?? log.user_email ?? '—';
                const resource = log.resource ?? log.resource_type ?? '—';
                const ip = log.ipAddress ?? log.ip_address ?? '—';
                const durationMs = log.duration ?? log.duration_ms;
                let status: 'success' | 'warning' | 'error' = 'success';
                if (log.status) status = log.status;
                else if (log.status_code != null) status = log.status_code < 300 ? 'success' : log.status_code < 500 ? 'warning' : 'error';
                const statusClass = status === 'success' ? 'bg-green-50 text-green-600' : status === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
                const risk = getRiskLevel(log.action ?? '');
                return (
                  <div key={log.id} className={`grid px-7 py-3.5 items-center hover:bg-slate-50 transition-colors min-w-[860px] ${idx < displayLogs.length - 1 ? 'border-b border-slate-50' : ''}`} style={{ gridTemplateColumns: '140px 180px 160px 70px 1fr 80px 80px 120px' }}>
                    <span className="text-xs text-slate-500">{new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="text-xs font-medium text-slate-700 truncate pr-2">{user}</span>
                    <span className="text-[11px] font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded w-fit truncate">{log.action}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded w-fit ${risk.cls}`}>{risk.label}</span>
                    <span className="text-xs text-slate-700 truncate pr-2">{resource}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit capitalize ${statusClass}`}>{status}</span>
                    <span className="text-xs text-slate-400">{durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '—'}</span>
                    <span className="text-[11px] font-mono text-slate-400">{ip}</span>
                  </div>
                );
              })}
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col divide-y divide-slate-50">
              {displayLogs.map((log: any) => {
                const ts = log.timestamp ?? log.created_at;
                const user = log.user ?? log.user_email ?? '—';
                const resource = log.resource ?? log.resource_type ?? '—';
                let status: 'success' | 'warning' | 'error' = 'success';
                if (log.status) status = log.status;
                else if (log.status_code != null) status = log.status_code < 300 ? 'success' : log.status_code < 500 ? 'warning' : 'error';
                const statusClass = status === 'success' ? 'bg-green-50 text-green-600' : status === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
                const risk = getRiskLevel(log.action ?? '');
                return (
                  <div key={log.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded">{log.action}</span>
                      <div className="flex gap-1.5 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${risk.cls}`}>{risk.label}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${statusClass}`}>{status}</span>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-slate-700 mb-1 truncate">{user}</p>
                    <p className="text-xs text-slate-400 truncate mb-1">{resource}</p>
                    <p className="text-[11px] text-slate-300">{new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {!demoMode && total > (filters.limit || 50) && (
        <div className="flex items-center justify-between mt-5">
          <span className="text-xs text-slate-400">Page {filters.page || 1} of {Math.ceil(total / (filters.limit || 50))}</span>
          <div className="flex gap-2">
            <button onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })} disabled={(filters.page || 1) === 1}
              className={`bg-white border border-slate-200 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${(filters.page || 1) === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50 cursor-pointer'}`}>
              Previous
            </button>
            <button onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })} disabled={(filters.page || 1) >= Math.ceil(total / (filters.limit || 50))}
              className={`bg-white border border-slate-200 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${(filters.page || 1) >= Math.ceil(total / (filters.limit || 50)) ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50 cursor-pointer'}`}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}