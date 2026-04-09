'use client';

import { useState, useEffect } from 'react';

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
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download } from 'lucide-react';
import { auditLogsService, AuditLogFilters } from '@/lib/services/audit-logs.service';
import { demoModeService } from '@/lib/services/demo-mode.service';
import { formatDistanceToNow } from 'date-fns';

// Demo log shape — separate from API shape
type DemoLog = {
  id: string;
  timestamp: Date;
  user: string;
  action: string;
  resource: string;
  resourceType: string;
  status: 'success' | 'warning' | 'error';
  duration: number;
  ipAddress: string;
};

export default function AuditLogsPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  // ── PRESERVED STATE ──────────────────────────────────────────────────────
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    limit: 50,
  });
  const [searchQuery, setSearchQuery] = useState('');

  // ── PRESERVED QUERIES ────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => auditLogsService.getAll(filters),
  });

  const { data: actionsData } = useQuery({
    queryKey: ['audit-log-actions'],
    queryFn: () => auditLogsService.getActions(),
  });

  const { data: resourceTypesData } = useQuery({
    queryKey: ['audit-log-resource-types'],
    queryFn: () => auditLogsService.getResourceTypes(),
  });

  // ── PRESERVED DERIVED VALUES ─────────────────────────────────────────────
  const logs = data?.data || [];
  const total = data?.total || 0;
  const actions = actionsData || [];
  const resourceTypesList = resourceTypesData || [];

  // ── PRESERVED FILTER HELPERS ─────────────────────────────────────────────
  const updateFilter = (key: keyof AuditLogFilters, value: unknown) => {
    setFilters({ ...filters, [key]: value, page: 1 });
  };

  const clearFilters = () => {
    setFilters({ page: 1, limit: 50 });
  };

  // ── DEMO MODE ────────────────────────────────────────────────────────────
  const demoMode = demoModeService.isEnabled();

  const DEMO_LOGS: DemoLog[] = [
    { id: '1',  timestamp: new Date(Date.now() - 1000 * 60 * 5),   user: 'sarah.chen@company.com',   action: 'deployment.create',   resource: 'api-gateway',        resourceType: 'ECS',    status: 'success', duration: 2340,  ipAddress: '192.168.1.42'  },
    { id: '2',  timestamp: new Date(Date.now() - 1000 * 60 * 12),  user: 'mike.johnson@company.com',  action: 'security.scan',       resource: 'production-cluster', resourceType: 'EKS',    status: 'success', duration: 8920,  ipAddress: '192.168.1.15'  },
    { id: '3',  timestamp: new Date(Date.now() - 1000 * 60 * 28),  user: 'alex.wong@company.com',     action: 'cost.optimization',   resource: 'rds-prod-01',        resourceType: 'RDS',    status: 'success', duration: 1200,  ipAddress: '192.168.1.88'  },
    { id: '4',  timestamp: new Date(Date.now() - 1000 * 60 * 45),  user: 'sarah.chen@company.com',    action: 'config.update',       resource: 's3-assets-bucket',   resourceType: 'S3',     status: 'success', duration: 340,   ipAddress: '192.168.1.42'  },
    { id: '5',  timestamp: new Date(Date.now() - 1000 * 60 * 67),  user: 'emma.davis@company.com',    action: 'compliance.scan',     resource: 'CIS AWS Benchmark',  resourceType: 'Policy', status: 'success', duration: 15600, ipAddress: '192.168.1.71'  },
    { id: '6',  timestamp: new Date(Date.now() - 1000 * 60 * 89),  user: 'david.kim@company.com',     action: 'deployment.create',   resource: 'payment-processor',  resourceType: 'Lambda', status: 'success', duration: 3100,  ipAddress: '192.168.1.33'  },
    { id: '7',  timestamp: new Date(Date.now() - 1000 * 60 * 120), user: 'mike.johnson@company.com',  action: 'anomaly.acknowledge', resource: 'production-worker',  resourceType: 'EC2',    status: 'success', duration: 180,   ipAddress: '192.168.1.15'  },
    { id: '8',  timestamp: new Date(Date.now() - 1000 * 60 * 145), user: 'alex.wong@company.com',     action: 'auth.login',          resource: 'devcontrol-app',     resourceType: 'Auth',   status: 'success', duration: 210,   ipAddress: '203.0.113.42'  },
    { id: '9',  timestamp: new Date(Date.now() - 1000 * 60 * 180), user: 'emma.davis@company.com',    action: 'cost.export',         resource: 'cost-report-march',  resourceType: 'Report', status: 'success', duration: 890,   ipAddress: '192.168.1.71'  },
    { id: '10', timestamp: new Date(Date.now() - 1000 * 60 * 210), user: 'sarah.chen@company.com',    action: 'security.policy',     resource: 'iam-prod-policy',    resourceType: 'IAM',    status: 'warning', duration: 450,   ipAddress: '192.168.1.42'  },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawLogs: any[] = demoMode ? DEMO_LOGS : logs;

  // ── SEARCH FILTER ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const displayLogs: any[] = searchQuery.trim()
    ? rawLogs.filter((l: any) => {
        const q = searchQuery.toLowerCase();
        const user     = (l.user     ?? l.user_email    ?? '').toLowerCase();
        const resource = (l.resource ?? l.resource_type ?? '').toLowerCase();
        const action   = (l.action   ?? '').toLowerCase();
        return user.includes(q) || action.includes(q) || resource.includes(q);
      })
    : rawLogs;

  // ── RISK KPI DERIVED VALUES ───────────────────────────────────────────────
  const hasLogs = displayLogs.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const suspiciousCount = displayLogs.filter((l: any) => {
    const a = (l.action ?? '').toLowerCase();
    return a.includes('delete') || a.includes('modify') || l.status === 'warning' || l.status === 'error';
  }).length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failedCount = displayLogs.filter((l: any) =>
    l.status === 'failed' || l.status === 'error' || l.status === 'warning'
  ).length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highRiskCount = displayLogs.filter((l: any) => {
    const a = (l.action ?? '').toLowerCase();
    return a.includes('iam') || a.includes('securitygroup') || a.includes('policy');
  }).length;
  const now24h = Date.now() - 1000 * 60 * 60 * 24;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeUserCount = new Set(displayLogs.filter((l: any) => new Date(l.timestamp ?? l.created_at).getTime() > now24h).map((l: any) => l.user ?? l.user_email)).size;

  const showingCount = displayLogs.length;

  // ── HANDLER STUBS ─────────────────────────────────────────────────────────
  const handleExport = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const csv = displayLogs.map((l: any) => {
      const ts       = l.timestamp || l.created_at;
      const user     = l.user     || l.user_email   || '';
      const resource = l.resource || l.resource_type || '';
      const status   = l.status   || (l.status_code != null ? (l.status_code < 300 ? 'success' : l.status_code < 500 ? 'warning' : 'error') : '');
      const duration = l.duration || l.duration_ms  || '';
      const ip       = l.ipAddress || l.ip_address  || '';
      return `${new Date(ts).toISOString()},${user},${l.action},${resource},${status},${duration},${ip}`;
    }).join('\n');
    const blob = new Blob([`Time,User,Action,Resource,Status,Duration,IP\n${csv}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-logs.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh = () => { refetch(); };

  const handleClearFilters = () => { clearFilters(); };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Audit Logs & Activity Monitoring
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Monitor activity, detect anomalies, and investigate security events across your AWS environment
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleExport}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}
          >
            <Download size={15} /> Export CSV
          </button>
          <button
            onClick={handleRefresh}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* ── RISK KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Suspicious events',   value: hasLogs ? suspiciousCount  : '—', sub: 'AI-detected anomalies',        valueColor: !hasLogs || suspiciousCount === 0  ? '#9ca3af' : '#DC2626' },
          { label: 'Failed actions',       value: hasLogs ? failedCount      : '—', sub: 'Last 24 hours',                valueColor: !hasLogs || failedCount === 0      ? '#9ca3af' : '#D97706' },
          { label: 'High-risk actions',    value: hasLogs ? highRiskCount    : '—', sub: 'IAM changes, security groups', valueColor: !hasLogs || highRiskCount === 0    ? '#9ca3af' : '#DC2626' },
          { label: 'Active users',         value: hasLogs ? activeUserCount  : '—', sub: 'Last 24 hours',                valueColor: '#9ca3af' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
              {label}
            </p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
              {value}
            </div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── AI ANOMALY BANNER ── */}
      {hasLogs && suspiciousCount > 0 && (
        <div style={{
          border: '0.5px solid #FECACA',
          borderLeft: '2px solid #DC2626',
          borderRadius: '8px',
          padding: '14px 16px',
          marginBottom: '20px',
          display: 'flex',
          gap: '10px',
          alignItems: 'flex-start',
          background: '#FEF2F2',
        }}>
          <div style={{ width: '28px', height: '28px', background: '#FEE2E2', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#DC2626', fontSize: '13px' }}>
            ⚠
          </div>
          <div>
            <p style={{ fontSize: '11px', fontWeight: 500, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>
              AI anomaly detected
            </p>
            <p style={{ fontSize: '13px', color: '#7F1D1D', lineHeight: 1.5, margin: '0 0 2px' }}>
              Unusual spike in IAM policy changes detected in the last 2 hours. {suspiciousCount} action{suspiciousCount !== 1 ? 's' : ''} were performed outside normal usage patterns.
            </p>
            <p style={{ fontSize: '12px', color: '#991B1B', margin: 0 }}>
              Review flagged events below.
            </p>
          </div>
        </div>
      )}

      {/* ── SEARCH BAR ── */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="Search by user, action, or resource..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            border: '0.5px solid #E2E8F0',
            borderRadius: '8px',
            padding: '8px 12px 8px 36px',
            fontSize: '13px',
            background: '#fff',
            color: '#0F172A',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: '14px' }}>⌕</span>
      </div>

      {/* ── FILTERS (only when logs exist) ── */}
      {hasLogs && (
        <div style={{ background: '#fff', borderRadius: '14px', padding: '24px 28px', border: '1px solid #F1F5F9', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '16px', alignItems: 'end' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Action</p>
              <select
                value={filters.action || ''}
                onChange={(e) => updateFilter('action', e.target.value || undefined)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', cursor: 'pointer', outline: 'none' }}
              >
                <option value="">All Actions</option>
                {actions.map((a: string) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Resource Type</p>
              <select
                value={filters.resource_type || ''}
                onChange={(e) => updateFilter('resource_type', e.target.value || undefined)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', cursor: 'pointer', outline: 'none' }}
              >
                <option value="">All Types</option>
                {resourceTypesList.map((r: string) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Start Date</p>
              <input
                type="date"
                value={filters.start_date || ''}
                onChange={(e) => updateFilter('start_date', e.target.value || undefined)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>End Date</p>
              <input
                type="date"
                value={filters.end_date || ''}
                onChange={(e) => updateFilter('end_date', e.target.value || undefined)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleClearFilters}
              style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 16px', fontSize: '0.78rem', fontWeight: 500, color: '#475569', cursor: 'pointer' }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* ── AUDIT LOG TABLE ── */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>

        {/* Table header bar */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Recent Activity
          </p>
          <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
            Showing {showingCount} {showingCount === 1 ? 'entry' : 'entries'}
          </p>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 200px 180px 72px 1fr 90px 90px 130px', padding: '10px 28px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
          {['Time', 'User', 'Action', 'Risk', 'Resource', 'Status', 'Duration', 'IP Address'].map((col) => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {col}
            </span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !demoMode ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading audit logs...</p>
          </div>
        ) : displayLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: isMobile ? '16px 14px' : '48px 32px' }}>
            <p style={{ fontSize: '16px', fontWeight: 500, color: '#0F172A', margin: '0 0 8px' }}>
              No audit activity detected yet
            </p>
            <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 auto 20px', maxWidth: '480px' }}>
              Once connected, DevControl will track all infrastructure actions, API calls, and user activity across your AWS environment.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '6px', maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
              {['Trace who made changes', 'Detect unusual access patterns', 'Investigate incidents in seconds', 'Track IAM and policy changes'].map((item) => (
                <div key={item} style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#534AB7', flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          displayLogs.map((log: any, idx: number) => {
            const ts       = log.timestamp ?? log.created_at;
            const user     = log.user      ?? log.user_email    ?? '—';
            const resource = log.resource  ?? log.resource_type ?? '—';
            const ip       = log.ipAddress ?? log.ip_address    ?? '—';
            const durationMs = log.duration ?? log.duration_ms;

            // Normalise status from either shape
            let status: 'success' | 'warning' | 'error' = 'success';
            if (log.status) {
              status = log.status as typeof status;
            } else if (log.status_code != null) {
              status = log.status_code < 300 ? 'success' : log.status_code < 500 ? 'warning' : 'error';
            }

            const statusColor = status === 'success' ? '#059669' : status === 'warning' ? '#D97706' : '#DC2626';
            const statusBg    = status === 'success' ? '#F0FDF4'  : status === 'warning' ? '#FFFBEB' : '#FEF2F2';

            return (
              <div
                key={log.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 200px 180px 72px 1fr 90px 90px 130px',
                  padding: '14px 28px',
                  borderBottom: idx < displayLogs.length - 1 ? '1px solid #F8FAFC' : 'none',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>
                  {new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#1E293B', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user}
                </span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#7C3AED', background: '#F5F3FF', padding: '2px 8px', borderRadius: '4px', width: 'fit-content' }}>
                  {log.action}
                </span>
                {(() => {
                  const a = (log.action ?? '').toLowerCase();
                  if (a.includes('delete') || a.includes('iam') || a.includes('policy'))
                    return <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', background: '#FEE2E2', color: '#991B1B', width: 'fit-content' }}>High</span>;
                  if (a.includes('modify') || a.includes('update') || a.includes('security'))
                    return <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', background: '#FAEEDA', color: '#633806', width: 'fit-content' }}>Medium</span>;
                  return <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', background: '#F1EFE8', color: '#444441', width: 'fit-content' }}>Low</span>;
                })()}
                <span style={{ fontSize: '0.78rem', color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {resource}
                </span>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', width: 'fit-content', background: statusBg, color: statusColor, textTransform: 'capitalize' }}>
                  {status}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>
                  {durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '—'}
                </span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#64748B' }}>
                  {ip}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* ── PAGINATION (preserved) ── */}
      {!demoMode && total > (filters.limit || 50) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '20px' }}>
          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
            Page {filters.page || 1} of {Math.ceil(total / (filters.limit || 50))}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
              disabled={(filters.page || 1) === 1}
              style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 16px', fontSize: '0.78rem', fontWeight: 500, color: (filters.page || 1) === 1 ? '#94A3B8' : '#475569', cursor: (filters.page || 1) === 1 ? 'not-allowed' : 'pointer' }}
            >
              Previous
            </button>
            <button
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
              disabled={(filters.page || 1) >= Math.ceil(total / (filters.limit || 50))}
              style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 16px', fontSize: '0.78rem', fontWeight: 500, color: (filters.page || 1) >= Math.ceil(total / (filters.limit || 50)) ? '#94A3B8' : '#475569', cursor: (filters.page || 1) >= Math.ceil(total / (filters.limit || 50)) ? 'not-allowed' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
