'use client';

import { useState, useEffect, useCallback } from 'react';
import { anomalyService } from '@/lib/services/anomaly.service';
import { logError } from '@/lib/safe-log';
import { usePlan } from '@/lib/hooks/use-plan';
import { PlanLoadingState, WorkspaceLoadError } from '@/components/plan/plan-status';
import { SEE_PLANS, planRequiredText, tierRequiredOf, type TierRequired } from '@/lib/plan/tier-required';
import { AnomalyDetection, AnomalyStats } from '@/types/anomaly.types';
import {
  AlertTriangle, AlertCircle, RefreshCw, Brain,
  CheckCheck, Flag, ChevronDown, MoreHorizontal, Plus, Trash2,
  ToggleLeft, ToggleRight, Settings, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import customAnomalyRulesService, { CustomAnomalyRule, CreateRulePayload } from '@/lib/services/custom-anomaly-rules.service';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#DC2626', bg: '#FEF2F2', border: '#FEE2E2', label: 'Critical' },
  warning:  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Warning'  },
  info:     { color: '#64748B', bg: '#F8FAFC', border: '#F1F5F9', label: 'Info'     },
};

const confidenceLabel = (score: number) => score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low';

export default function AnomaliesPage() {
  const plan = usePlan();
  // Only a known Pro-or-above plan loads anomalies; unknown is never treated as free.
  const isPro = plan.isKnown && plan.isPro;
  // Custom rules (/api/anomaly-rules) are Enterprise-only.
  const isEnterprise = plan.isKnown && plan.isEnterprise;
  // Set when the server refused for the plan (e.g. a restricted or changed plan): its gate.
  const [tierRequired, setTierRequired] = useState<TierRequired | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyDetection[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [lastScanLoading, setLastScanLoading] = useState(true);
  const [rules, setRules] = useState<CustomAnomalyRule[]>([]);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [newRule, setNewRule] = useState<CreateRulePayload>({ name: '', metric: 'cost', condition: 'greater_than', threshold: 0, timeWindow: '1h', severity: 'warning' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadAnomalies = useCallback(async () => {
    if (!isPro) return;
    try {
      const data = await anomalyService.getAnomalies(filter);
      setAnomalies(data.anomalies); setStats(data.stats);
    } catch (error: any) {
      const required = tierRequiredOf(error);
      if (required) setTierRequired(required);
    } finally { setIsLoading(false); }
  }, [filter, isPro]);

  useEffect(() => {
    if (!isPro || tierRequired) return;
    loadAnomalies(); const i = setInterval(loadAnomalies, 300000); return () => clearInterval(i);
  }, [loadAnomalies, isPro, tierRequired]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  useEffect(() => {
    if (!isPro) return;
    anomalyService.getLastScan().then(t => { setLastScanTime(t); setLastScanLoading(false); }).catch(() => setLastScanLoading(false));
  }, [isPro]);

  useEffect(() => {
    if (!isEnterprise) return;
    customAnomalyRulesService.getRules().then(setRules).catch(() => {});
  }, [isEnterprise]);

  const triggerScan = async () => {
    if (!isPro) return;
    setIsScanning(true); setLastScanResult(null);
    try { const r = await anomalyService.triggerScan(); setLastScanResult(r.message); setLastScanTime(new Date()); await loadAnomalies(); }
    catch { setLastScanResult('Scan failed. Please try again.'); }
    finally { setIsScanning(false); }
  };

  const handleAcknowledge = async (id: string) => { setActionLoading(id + '-ack'); try { await anomalyService.acknowledge(id); await loadAnomalies(); } catch (e) { logError('Failed to acknowledge anomaly', e); } finally { setActionLoading(null); } };
  const handleResolve = async (id: string) => { setActionLoading(id + '-res'); try { await anomalyService.resolve(id); await loadAnomalies(); } catch (e) { logError('Failed to resolve anomaly', e); } finally { setActionLoading(null); } };
  const handleFalsePositive = async (id: string) => { setActionLoading(id + '-fp'); try { await anomalyService.markFalsePositive(id); await loadAnomalies(); } catch (e) { logError('Failed to mark anomaly as false positive', e); } finally { setActionLoading(null); } };

  const handleCreateRule = async () => {
    if (!newRule.name.trim()) { toast.error('Rule name is required'); return; }
    if (!newRule.threshold) { toast.error('Threshold is required'); return; }
    setRulesLoading(true);
    try {
      const rule = await customAnomalyRulesService.createRule(newRule);
      setRules(r => [rule, ...r]); setShowCreateRule(false);
      setNewRule({ name: '', metric: 'cost', condition: 'greater_than', threshold: 0, timeWindow: '1h', severity: 'warning' });
      toast.success('Rule created');
    } catch (err: any) { toast.error(err?.response?.data?.message ?? 'Failed to create rule'); }
    finally { setRulesLoading(false); }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try { await customAnomalyRulesService.toggleRule(id, enabled); setRules(r => r.map(rule => rule.id === id ? { ...rule, enabled } : rule)); }
    catch { toast.error('Failed to update rule'); }
  };

  const handleDeleteRule = async (id: string) => {
    try { await customAnomalyRulesService.deleteRule(id); setRules(r => r.filter(rule => rule.id !== id)); toast.success('Rule deleted'); }
    catch { toast.error('Failed to delete rule'); }
  };

  const activeCount = stats?.active ?? anomalies.filter(a => a.status === 'active').length;
  const criticalCount = anomalies.filter(a => a.severity === 'critical' && a.status === 'active').length;
  const systemsImpacted = new Set(anomalies.filter(a => a.status === 'active').map(a => a.resourceName ?? a.resourceType).filter(Boolean)).size;
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' && a.status === 'active');
  const topAnomaly = criticalAnomalies[0] ?? anomalies[0];

  if (plan.status === 'loading') return <PlanLoadingState />;
  if (plan.status === 'error') return <WorkspaceLoadError onRetry={plan.retry} />;

  if (!isPro || tierRequired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5"><Lock size={24} className="text-violet-600" /></div>
          {tierRequired ? (
            <>
              <h2 className="text-ui font-semibold text-slate-900 mb-6">{planRequiredText(tierRequired)}</h2>
              <a href={SEE_PLANS.href} className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-ui font-semibold no-underline transition-colors">{SEE_PLANS.label}</a>
            </>
          ) : (
            <>
              <h2 className="text-ui font-semibold text-slate-900 mb-2.5">Pro Plan Required</h2>
              <p className="text-ui text-ink-muted leading-relaxed mb-6">This feature is available on the Pro plan and above.</p>
              <a href="/settings/billing/upgrade" className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-ui font-semibold no-underline transition-colors">Upgrade to Pro</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-1.5')}>Anomaly Detection</h1>
          {/* No detector evaluates measured AWS data (backend AnomalyDetectionService /
              CustomAnomalyRulesService return nothing), so the page must not claim monitoring. */}
          <p className={PAGE_SUBTITLE_CLASS}>Anomaly detection on measured data isn&apos;t currently active. An empty list here doesn&apos;t mean no issues exist.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastScanResult && <span className="text-meta text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">{lastScanResult}</span>}
          <button onClick={triggerScan} disabled={isScanning}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-ui font-semibold border-none whitespace-nowrap transition-colors ${isScanning ? 'bg-slate-200 text-ink-muted cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 text-white cursor-pointer'}`}>
            <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} /> {isScanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {/* Executive insight banner */}
      {anomalies.length > 0 && (
        <div className="bg-white border border-slate-200 border-l-[4px] border-l-red-600 rounded-xl p-5 sm:p-6 mb-5 flex items-start gap-4">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><AlertTriangle size={13} className="text-red-600" /></div>
          <div className="flex-1">
            <p className="text-ui font-semibold text-slate-900 mb-1.5">{criticalAnomalies.length} critical anomal{criticalAnomalies.length !== 1 ? 'ies' : 'y'} — EC2 latency risk causing user-facing degradation</p>
            <p className="text-meta text-ink-muted mb-3">{criticalAnomalies.length} service{criticalAnomalies.length !== 1 ? 's' : ''} impacted · {topAnomaly?.region ?? 'us-east-1'}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setExpandedId(topAnomaly?.id ?? null)} className="bg-red-600 hover:bg-red-700 text-white border-none rounded-lg px-3.5 py-1.5 text-label cursor-pointer transition-colors">Fix top issue →</button>
              <button onClick={() => setFilter('all')} className="bg-white text-slate-600 border border-slate-200 rounded-lg px-3.5 py-1.5 text-label cursor-pointer hover:bg-slate-50 transition-colors">View all anomalies</button>
            </div>
          </div>
        </div>
      )}

      {/* System status bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white rounded-xl border border-slate-200 px-4 py-2.5 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
            <span className="text-ui font-semibold text-slate-900">Anomaly detection not active</span>
          </div>
          <span className="text-slate-200">|</span>
          <span className="text-meta text-ink-muted">
            {isScanning ? 'Scan in progress…' : lastScanTime ? <>Last scan: <strong className="text-slate-700">{lastScanTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></> : 'No scan recorded yet'}
          </span>
        </div>
        <span className="text-meta text-ink-muted">No detector evaluates measured AWS data yet</span>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Active Issues', value: activeCount, dot: '#D97706', sub: 'Requiring immediate attention' },
          { label: 'Critical Issues', value: criticalCount, dot: '#DC2626', sub: 'Highest severity · action needed' },
          { label: 'Systems Impacted', value: systemsImpacted, dot: '#94A3B8', sub: 'Active resources affected' },
        ].map(({ label, value, dot, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-2.5">{label}</p>
            <div className="flex items-end gap-2 mb-1.5">
              <span className="text-kpi tabular-nums text-slate-900 leading-none">{value}</span>
              <span className="w-2 h-2 rounded-full mb-1 shrink-0" style={{ background: dot }} />
            </div>
            <p className="text-meta text-ink-muted leading-relaxed">{sub}</p>
          </div>
        ))}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-2.5">Estimated Impact</p>
          <div className={`text-section leading-none mb-1.5 ${activeCount === 0 ? 'text-ink-muted' : criticalCount > 0 ? 'text-ink-danger' : 'text-ink-warning'}`}>
            {activeCount === 0 ? 'Not assessed' : criticalCount > 0 ? `${criticalCount} service${criticalCount > 1 ? 's' : ''} degraded` : 'Monitoring'}
          </div>
          <p className="text-meta text-ink-muted leading-relaxed">{activeCount === 0 ? 'Anomaly detection on measured data isn’t active' : criticalCount > 0 ? `${criticalCount} user-facing service${criticalCount > 1 ? 's' : ''} — act now` : 'No critical issues active'}</p>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex bg-slate-50 rounded-lg p-0.5 gap-0.5">
          {(['active', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-label border-none cursor-pointer transition-all whitespace-nowrap ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-ink-muted'}`}>
              {f === 'active' ? `Active (${activeCount})` : 'All anomalies'}
            </button>
          ))}
        </div>
        <span className="text-slate-200 hidden sm:block">|</span>
        <span className="text-label text-ink-muted uppercase tracking-[0.04em] hidden sm:block">Filters:</span>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Severity', options: ['All', 'Critical', 'Warning', 'Info'] },
            { label: 'Service',  options: ['All', 'EC2', 'Lambda', 'RDS', 'S3'] },
            { label: 'Region',   options: ['All', 'us-east-1', 'us-west-2', 'eu-west-1'] },
            { label: 'Time',     options: ['Last 24h', 'Last 7d', 'Last 30d'] },
          ].map(({ label, options }) => (
            <select key={label} className="h-9 px-2.5 rounded-lg border border-slate-200 text-label font-normal text-slate-600 bg-white cursor-pointer">
              {options.map(o => <option key={o}>{o === 'All' ? `${label}: All` : o}</option>)}
            </select>
          ))}
        </div>
        <span className="text-meta text-ink-muted ml-auto whitespace-nowrap hidden sm:block">{anomalies.length} {filter === 'active' ? 'active' : 'total'} anomalies</span>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 mb-4">
        <label className="flex items-center gap-1.5 text-label text-slate-600 cursor-pointer font-medium shrink-0">
          <input type="checkbox" className="w-3.5 h-3.5 accent-violet-600"
            onChange={e => setSelectedIds(e.target.checked ? anomalies.map(a => a.id) : [])}
            checked={selectedIds.length === anomalies.length && anomalies.length > 0} />
          Select all
        </label>
        <span className="text-slate-200">|</span>
        <button onClick={async () => { await Promise.all(selectedIds.map(id => handleResolve(id))); setSelectedIds([]); }} disabled={selectedIds.length === 0}
          className="px-3 py-1 rounded-lg border border-green-200 bg-green-50 text-label text-ink-success cursor-pointer disabled:opacity-50">Resolve selected</button>
        <button onClick={async () => { await Promise.all(selectedIds.map(id => handleFalsePositive(id))); setSelectedIds([]); }} disabled={selectedIds.length === 0}
          className="px-3 py-1 rounded-lg border border-slate-200 bg-white text-label font-medium text-ink-muted cursor-pointer disabled:opacity-50">Ignore selected</button>
        <button className="px-3 py-1 rounded-lg border border-violet-200 bg-violet-50 text-label font-medium text-violet-600 cursor-pointer">Assign selected</button>
        <span className="text-label text-slate-900 ml-auto">Priority Issues ({activeCount})</span>
      </div>

      {/* Anomaly list */}
      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
            <RefreshCw size={22} className="text-slate-300 mx-auto mb-3" />
            <p className="text-ui text-ink-muted">Loading anomalies...</p>
          </div>
        ) : !lastScanLoading && !lastScanTime ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 sm:p-12">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="w-11 h-11 rounded-xl bg-slate-50 flex items-center justify-center shrink-0"><AlertCircle size={20} className="text-slate-400" /></div>
              <div className="flex-1">
                <p className="text-ui font-semibold text-slate-900 mb-1.5">No scan recorded yet</p>
                <p className="text-ui text-ink-muted leading-relaxed">Anomaly detection on measured data isn&apos;t currently active.</p>
              </div>
            </div>
          </div>
        ) : lastScanTime !== null && anomalies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 sm:p-12">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="w-11 h-11 rounded-xl bg-slate-50 flex items-center justify-center shrink-0"><AlertCircle size={20} className="text-slate-400" /></div>
              <div className="flex-1">
                <p className="text-ui font-semibold text-slate-900 mb-1.5">No anomalies recorded</p>
                <p className="text-ui text-ink-muted mb-5 leading-relaxed">Anomaly detection on measured data isn&apos;t currently active, so this doesn&apos;t mean no issues exist.</p>
                <div className="flex flex-wrap items-center gap-4">
                  <p className="text-meta text-ink-muted">Last scan: <span className="font-semibold text-slate-600">{lastScanLoading ? 'Checking…' : lastScanTime ? lastScanTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Pending first scan'}</span></p>
                </div>
              </div>
            </div>
          </div>
        ) : anomalies.map((anomaly: AnomalyDetection, index: number) => {
          const sev = severityConfig[anomaly.severity] ?? severityConfig.info;
          const isExpanded = expandedId === anomaly.id;
          const isFirst = filter === 'active' && index === 0;
          const minutesAgo = anomaly.detectedAt ? Math.round((Date.now() - new Date(anomaly.detectedAt).getTime()) / 60000) : null;
          const timeDisplay = minutesAgo === null ? 'Ongoing' : minutesAgo < 60 ? `Active ${minutesAgo}m` : minutesAgo < 1440 ? `Ongoing (${Math.floor(minutesAgo / 60)}h)` : `Ongoing (${Math.floor(minutesAgo / 1440)}d)`;
          const t = anomaly.title ?? '', rt = anomaly.resourceType ?? '';
          const d = anomaly.deviation ?? 0, dAbs = Math.round(Math.abs(d));
          const metric = anomaly.metric?.replace(/_/g, ' ') ?? 'metric';
          const riskTitle = t.toLowerCase().includes('cpu') ? `${rt} latency risk — CPU saturation (${anomaly.currentValue ? Math.round(anomaly.currentValue) : Math.round(d)}%)` : t.toLowerCase().includes('lambda') || t.toLowerCase().includes('invocation') ? `${rt} throttling risk — concurrency saturation (+${dAbs}%)` : t.toLowerCase().includes('cost') || t.toLowerCase().includes('spend') ? `Cost spike — ${rt} overspend (+${dAbs}%)` : t;
          const decisionSummary = rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu') ? 'User-facing API latency increasing' : rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation') ? 'Lambda concurrency exhausted — payment flow at risk' : anomaly.severity === 'critical' ? `${rt} degradation — immediate action required` : `${rt} anomaly — monitor for impact`;
          const impactText = rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu') ? `+${dAbs > 50 ? Math.round(dAbs * 0.3) : 35}% latency → user-facing degradation` : rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation') ? `+${dAbs}% load → Lambda throttling → payment risk` : anomaly.severity === 'critical' ? `${rt} degradation → user-facing services affected` : `${rt} performance degraded — monitor downstream`;
          const causeText = rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu') ? ['Traffic spike or under-provisioned EC2 instances', 'CPU sustained >80% → throttling risk'] : rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation') ? ['Invocation surge exceeding concurrency limits', `+${dAbs}% above normal → throttling + cost impact`] : [`${rt} ${metric} +${dAbs}% above normal baseline`, anomaly.severity === 'critical' ? 'Immediate investigation required' : 'Monitor for escalation'];

          return (
            <div key={anomaly.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Priority strip */}
              <div className="px-5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2.5">
                <span className={`text-label px-2 py-0.5 rounded uppercase tracking-[0.04em] ${isFirst ? 'bg-red-100 text-ink-danger' : 'bg-slate-100 text-ink-muted'}`}>{isFirst ? 'ACT NOW' : `#${index + 1} Priority`}</span>
                <span className="text-meta text-ink-muted">{isFirst ? `#1 of ${anomalies.length} — act on this first` : 'Secondary issue'}</span>
              </div>

              {/* Card body */}
              <div className="p-4 sm:p-5 flex items-start gap-3">
                <input type="checkbox" className="w-3.5 h-3.5 accent-violet-600 mt-1 shrink-0"
                  onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, anomaly.id] : prev.filter(id => id !== anomaly.id))}
                  checked={selectedIds.includes(anomaly.id)} />

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <p className="text-ui font-semibold text-slate-900 leading-snug">{riskTitle}</p>
                    <span className="text-label px-2 py-0.5 rounded shrink-0" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
                    <span className="text-label text-ink-warning bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1"><AlertCircle size={9} className="text-amber-500" />Unassigned</span>
                    {anomaly.status === 'acknowledged' && <span className="text-label px-2 py-0.5 rounded bg-sky-50 text-sky-600">Acknowledged</span>}
                    {anomaly.status === 'resolved' && <span className="text-label px-2 py-0.5 rounded bg-green-50 text-ink-success">Resolved</span>}
                    {anomaly.status === 'false_positive' && <span className="text-label px-2 py-0.5 rounded bg-slate-100 text-ink-muted">False Positive</span>}
                    <span className="ml-auto text-meta text-ink-muted font-medium whitespace-nowrap">{timeDisplay}</span>
                  </div>
                  <p className="text-meta font-medium text-slate-600 mb-2 leading-relaxed">{decisionSummary}</p>
                  <div className="flex flex-wrap gap-2 text-meta text-ink-muted mb-3">
                    {anomaly.resourceType && <span>{anomaly.resourceType}</span>}
                    {anomaly.resourceName && <><span>·</span><span>{anomaly.resourceName}</span></>}
                    {anomaly.region && <><span>·</span><span>{anomaly.region}</span></>}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 flex items-center gap-2 text-meta text-amber-800">
                    <AlertCircle size={11} className="text-amber-500 shrink-0" />
                    <span><strong>Impact:</strong> {impactText}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 mb-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Brain size={11} className="text-violet-600 shrink-0" />
                      <strong className="text-label text-ink-muted uppercase tracking-[0.04em]">Root Cause</strong>
                    </div>
                    {causeText.map((bullet, i) => (
                      <div key={i} className="flex items-start gap-2 mb-1 last:mb-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0 mt-1.5" />
                        <span className="text-meta text-slate-600 leading-relaxed">{bullet}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
                    <span className="font-semibold text-ink-success">{confidenceLabel(anomaly.confidence)} confidence</span>
                    <span className="text-slate-300">|</span>
                    <span>Deviation: <span className={`font-semibold ${Math.abs(anomaly.deviation) > 50 ? 'text-ink-danger' : 'text-ink-warning'}`}>{anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(0)}%</span></span>
                    <span className="text-slate-300">|</span>
                    <span>Medium effort · No downtime</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 shrink-0 w-28">
                  {(anomaly.status === 'active' || anomaly.status === 'acknowledged') && (
                    <button onClick={() => handleResolve(anomaly.id)} disabled={actionLoading === anomaly.id + '-res'}
                      className="bg-green-600 hover:bg-green-700 text-white border-none rounded-lg py-2 text-label cursor-pointer transition-colors w-full">
                      {actionLoading === anomaly.id + '-res' ? <RefreshCw size={10} className="animate-spin mx-auto" /> : 'Apply fix →'}
                    </button>
                  )}
                  <button onClick={() => setExpandedId(isExpanded ? null : anomaly.id)}
                    className="bg-white text-slate-600 border border-slate-200 rounded-lg py-2 text-label font-medium cursor-pointer hover:bg-slate-50 transition-colors w-full">Investigate</button>
                  <div className="relative">
                    <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === anomaly.id ? null : anomaly.id); }}
                      className="bg-transparent border border-slate-200 rounded-lg p-1.5 cursor-pointer text-slate-400 flex items-center justify-center w-full hover:bg-slate-50 transition-colors">
                      <MoreHorizontal size={13} />
                    </button>
                    {openMenuId === anomaly.id && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 min-w-[168px] p-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setExpandedId(isExpanded ? null : anomaly.id); setOpenMenuId(null); }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border-none bg-transparent text-label text-slate-600 cursor-pointer hover:bg-slate-50 font-medium text-left">
                          <ChevronDown size={12} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} className="text-slate-400" /> View Details
                        </button>
                        {(anomaly.status === 'active' || anomaly.status === 'acknowledged') && (
                          <>
                            <div className="h-px bg-slate-100 my-1" />
                            <button onClick={() => { handleResolve(anomaly.id); setOpenMenuId(null); }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border-none bg-transparent text-label text-ink-success cursor-pointer hover:bg-green-50 font-medium text-left"><CheckCheck size={12} /> Mark as Resolved</button>
                            <button onClick={() => { handleFalsePositive(anomaly.id); setOpenMenuId(null); }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border-none bg-transparent text-label text-ink-muted cursor-pointer hover:bg-slate-50 font-medium text-left"><Flag size={12} /> Mark as False Positive</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-5 py-5 border-t border-slate-100">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                    {[
                      { label: 'Current Value', value: anomaly.metric === 'total_cost' ? `$${anomaly.currentValue.toFixed(2)}` : anomaly.currentValue.toLocaleString() },
                      { label: 'Expected', value: anomaly.metric === 'total_cost' ? `$${anomaly.expectedValue.toFixed(2)}` : anomaly.expectedValue.toLocaleString() },
                      { label: 'Time Window', value: anomaly.timeWindow },
                      { label: 'Metric', value: anomaly.metric.replace(/_/g, ' ') },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-slate-50 border border-slate-100 rounded-lg px-3.5 py-3">
                        <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">{label}</p>
                        <p className="text-ui font-semibold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3">
                    {anomaly.description && <div><p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1.5">Description</p><p className="text-ui text-slate-600 leading-relaxed">{anomaly.description}</p></div>}
                    {anomaly.aiExplanation && <div className="bg-violet-50 border border-violet-100 rounded-xl p-4"><p className="text-label text-violet-600 uppercase tracking-[0.04em] mb-1.5">AI Analysis</p><p className="text-ui text-violet-800 leading-relaxed">{anomaly.aiExplanation}</p></div>}
                    {anomaly.impact && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4"><p className="text-label text-ink-warning uppercase tracking-[0.04em] mb-1.5">Impact</p><p className="text-ui text-amber-900 leading-relaxed">{anomaly.impact}</p></div>}
                    {anomaly.recommendation && <div className="bg-green-50 border border-green-200 rounded-xl p-4"><p className="text-label text-ink-success uppercase tracking-[0.04em] mb-1.5">Recommended Action</p><p className="text-ui text-green-900 leading-relaxed whitespace-pre-line">{anomaly.recommendation}</p></div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Anomaly Rules */}
      <div className="mt-8">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-white border border-slate-200 rounded-t-xl border-b-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-ui font-semibold text-ink-muted">Custom Detection Rules</h2>
            <span className="text-label px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 uppercase tracking-[0.04em]">Enterprise</span>
            <span className="text-meta text-ink-muted">{rules.length} rules active</span>
          </div>
          <button onClick={() => setShowCreateRule(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-label border-none cursor-pointer transition-colors">
            <Plus size={11} /> New Rule
          </button>
        </div>

        {showCreateRule && (
          <div className="bg-white border border-violet-200 rounded-xl p-5 sm:p-6 mb-4 mt-1">
            <h3 className="text-ui font-semibold text-slate-900 mb-5">Create Detection Rule</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {[
                { label: 'Rule Name *', type: 'text', value: newRule.name, onChange: (v: string) => setNewRule(r => ({ ...r, name: v })), placeholder: 'e.g. High EC2 Cost Alert' },
              ].map(({ label, type, value, onChange, placeholder }) => (
                <div key={label}>
                  <label className="text-label text-ink-muted uppercase tracking-[0.04em] block mb-1.5">{label}</label>
                  <input type={type} value={value as string} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 outline-none focus:border-violet-500 transition-colors box-border" />
                </div>
              ))}
              {[
                { label: 'Metric *', value: newRule.metric, onChange: (v: string) => setNewRule(r => ({ ...r, metric: v })), options: [['cost', 'Cost ($)'], ['cpu', 'CPU Utilization (%)'], ['memory', 'Memory Utilization (%)'], ['error_rate', 'Error Rate (%)'], ['invocations', 'Invocations']] },
                { label: 'Condition *', value: newRule.condition, onChange: (v: string) => setNewRule(r => ({ ...r, condition: v as CreateRulePayload['condition'] })), options: [['greater_than', 'Greater than'], ['less_than', 'Less than'], ['percent_change_up', '% increase above'], ['percent_change_down', '% decrease below']] },
                { label: 'Time Window', value: newRule.timeWindow, onChange: (v: string) => setNewRule(r => ({ ...r, timeWindow: v })), options: [['1h', 'Last 1 hour'], ['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days']] },
                { label: 'Severity', value: newRule.severity, onChange: (v: string) => setNewRule(r => ({ ...r, severity: v as CustomAnomalyRule['severity'] })), options: [['info', 'Info'], ['warning', 'Warning'], ['critical', 'Critical']] },
              ].map(({ label, value, onChange, options }) => (
                <div key={label}>
                  <label className="text-label text-ink-muted uppercase tracking-[0.04em] block mb-1.5">{label}</label>
                  <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-colors box-border">
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label className="text-label text-ink-muted uppercase tracking-[0.04em] block mb-1.5">Threshold *</label>
                <input type="number" value={newRule.threshold} onChange={e => setNewRule(r => ({ ...r, threshold: parseFloat(e.target.value) || 0 }))} placeholder="e.g. 500" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 outline-none focus:border-violet-500 transition-colors box-border" />
              </div>
            </div>
            <div className="flex gap-2.5 justify-end">
              <button onClick={() => setShowCreateRule(false)} className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-ink-muted text-label cursor-pointer hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleCreateRule} disabled={rulesLoading} className={`px-4 py-2.5 rounded-lg border-none text-white text-label transition-colors ${rulesLoading ? 'bg-violet-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
                {rulesLoading ? 'Creating...' : 'Create Rule'}
              </button>
            </div>
          </div>
        )}

        {rules.length === 0 && !showCreateRule ? (
          <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl px-5 py-6 text-center">
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center mx-auto mb-2.5"><Settings size={15} className="text-violet-600" /></div>
            <p className="text-ui font-semibold text-slate-900 mb-1.5">No custom rules yet</p>
            <p className="text-meta text-ink-muted leading-relaxed mb-4 max-w-sm mx-auto">Custom rules aren&apos;t currently evaluated, and no default detection is running. Rules you create are saved but not run.</p>
            <button onClick={() => setShowCreateRule(true)} className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-label border-none cursor-pointer transition-colors">
              <Plus size={12} /> Create First Rule
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 mt-1">
            {rules.map(rule => {
              const sc = rule.severity === 'critical' ? '#DC2626' : rule.severity === 'warning' ? '#D97706' : '#3B82F6';
              const sb = rule.severity === 'critical' ? '#FEF2F2' : rule.severity === 'warning' ? '#FFFBEB' : '#EFF6FF';
              return (
                <div key={rule.id} className={`bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 ${!rule.enabled ? 'opacity-60' : ''}`}>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-ui font-semibold text-slate-900">{rule.name}</span>
                      <span className="text-label px-2 py-0.5 rounded-full uppercase tracking-[0.04em]" style={{ background: sb, color: sc }}>{rule.severity}</span>
                      {!rule.enabled && <span className="text-label text-ink-muted">Disabled</span>}
                      {/* Custom rules are stored but not evaluated: their metrics were read from AWS tags, not measured data. */}
                      <span className="text-label text-ink-muted">Not currently evaluated</span>
                    </div>
                    <p className="text-meta text-ink-muted">{rule.metric} {rule.condition.replace(/_/g, ' ')} {rule.threshold} · {rule.timeWindow} window</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleToggleRule(rule.id, !rule.enabled)} className="bg-transparent border-none cursor-pointer p-1" style={{ color: rule.enabled ? '#7C3AED' : '#94A3B8' }}>
                      {rule.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                    <button onClick={() => handleDeleteRule(rule.id)} className="flex items-center gap-1 border border-red-200 rounded-lg px-2.5 py-1.5 text-label text-ink-danger bg-transparent cursor-pointer hover:bg-red-50 transition-colors">
                      <Trash2 size={10} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}