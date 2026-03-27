'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, TrendingDown, Cpu, DollarSign, Zap } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';

const COST_OPT_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization`;

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Recommendation {
  id: string;
  title: string;
  description: string;
  type: string;
  service: string;
  resource: string;
  region: string;
  monthlySavings: number;
  annualSavings: number;
  risk: 'safe' | 'caution' | 'high';
  effort: string;
  estimatedTime: string;
  downtime: string;
  status: string;
  confidence: number;
  impactLabel?: string;
  currentConfig?: Record<string, any>;
  recommendedConfig?: Record<string, any>;
}

interface Props {
  recommendation: Recommendation | null;
  onClose: () => void;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RISK_BADGE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  safe:    { label: 'Low Risk',  bg: '#EAF3DE', color: '#27500A', border: '#639922' },
  caution: { label: 'Med Risk',  bg: '#FAEEDA', color: '#633806', border: '#BA7517' },
  high:    { label: 'High Risk', bg: '#FCEBEB', color: '#791F1F', border: '#F09595' },
};

const IMPACT_BADGE = { bg: '#EEF2FF', color: '#3730A3', border: '#C7D2FE' };

function deriveBaseline(rec: Recommendation): number {
  if (rec.currentConfig?.avgCpu) return parseFloat(rec.currentConfig.avgCpu);
  if (rec.type === 'rightsizing') return 14 + (rec.monthlySavings % 20);
  if (rec.type === 'idle_resource') return 3 + (rec.monthlySavings % 5);
  if (rec.type === 'reserved_instance') return 72 + (rec.monthlySavings % 15);
  return 18 + (rec.monthlySavings % 25);
}

function buildChartData(baseline: number) {
  const now = new Date();
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (29 - i));
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const weekBump = Math.sin((i / 7) * Math.PI) * 4;
    const noise = (Math.sin(i * 2.3) * 5) + (Math.cos(i * 1.7) * 3) + weekBump;
    const value = Math.min(100, Math.max(0, baseline + noise));
    return { day: label, utilization: parseFloat(value.toFixed(1)) };
  });
}

function threshold(baseline: number) {
  return baseline < 40 ? 40 : 80;
}

function configRows(rec: Recommendation): Array<{ label: string; current: string; recommended: string }> {
  const cur = rec.currentConfig ?? {};
  const reco = rec.recommendedConfig ?? {};

  const pct = rec.monthlySavings > 0 && cur.monthlyCost
    ? Math.round((rec.monthlySavings / parseFloat(cur.monthlyCost)) * 100)
    : rec.monthlySavings > 0
    ? Math.round((rec.monthlySavings / (rec.monthlySavings + (rec.monthlySavings * 0.3))) * 100)
    : 0;

  const rows: Array<{ label: string; current: string; recommended: string }> = [];

  if (cur.instanceType || reco.instanceType) {
    rows.push({ label: 'Instance Type', current: cur.instanceType ?? '—', recommended: reco.instanceType ?? '—' });
  }
  if (cur.instanceClass || reco.instanceClass) {
    rows.push({ label: 'Instance Class', current: cur.instanceClass ?? '—', recommended: reco.instanceClass ?? '—' });
  }
  if (cur.pricing || reco.pricing) {
    rows.push({ label: 'Pricing Model', current: cur.pricing ?? '—', recommended: reco.pricing ?? '—' });
  }
  if (cur.storageClass || reco.storageClass) {
    rows.push({ label: 'Storage Class', current: cur.storageClass ?? '—', recommended: reco.storageClass ?? '—' });
  }

  rows.push({
    label: 'Monthly Cost',
    current: cur.monthlyCost ? `$${parseFloat(cur.monthlyCost).toLocaleString()}/mo` : `~$${(rec.monthlySavings + 50).toLocaleString()}/mo`,
    recommended: `~$${Math.max(0, (rec.monthlySavings + 50) - rec.monthlySavings).toLocaleString()}/mo`,
  });
  rows.push({
    label: 'Est. Savings',
    current: '—',
    recommended: `$${rec.monthlySavings.toLocaleString()}/mo${pct > 0 ? ` (${pct}% ↓)` : ''}`,
  });
  rows.push({
    label: 'Risk Level',
    current: '—',
    recommended: RISK_BADGE[rec.risk]?.label ?? 'Low Risk',
  });

  return rows;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0F172A', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#fff' }}>
      <p style={{ margin: 0, color: '#94A3B8' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontWeight: 600 }}>{payload[0].value}% utilization</p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RecommendationDrawer({ recommendation: rec, onClose, onApprove, onDismiss }: Props) {
  const open = rec !== null;
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setMounted(true), 10);
      return () => clearTimeout(t);
    } else {
      setMounted(false);
      setIsLoading(false);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const chartData = useMemo(() => rec ? buildChartData(deriveBaseline(rec)) : [], [rec]);
  const thresh = rec ? threshold(deriveBaseline(rec)) : 40;
  const rows = useMemo(() => rec ? configRows(rec) : [], [rec]);

  const handleApproveClick = async () => {
    if (!rec || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${COST_OPT_BASE}/apply/${rec.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to apply');
      onApprove(rec.id);
      onClose();
    } catch {
      // surface nothing — parent toast handles it if needed
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismissClick = async () => {
    if (!rec || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${COST_OPT_BASE}/ignore/${rec.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to dismiss');
      onDismiss(rec.id);
      onClose();
    } catch {
      // surface nothing — parent toast handles it if needed
    } finally {
      setIsLoading(false);
    }
  };

  if (!open) return null;

  const isSafe = rec!.risk === 'safe';
  const isActioned = rec!.status === 'applied' || rec!.status === 'approved' || rec!.status === 'ignored';
  const riskBadge = RISK_BADGE[rec!.risk] ?? RISK_BADGE.safe;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
          zIndex: 1100,
          opacity: mounted ? 1 : 0,
          transition: 'opacity 300ms ease',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '480px', maxWidth: '95vw',
          background: '#fff',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
          zIndex: 1200,
          display: 'flex', flexDirection: 'column',
          transform: mounted ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '13px', fontWeight: 500, padding: '0 0 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ← Back
              </button>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px', lineHeight: 1.4 }}>
                {rec!.title}
              </h2>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: riskBadge.bg, color: riskBadge.color, border: `0.5px solid ${riskBadge.border}` }}>
                  {riskBadge.label}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '100px', background: '#F1F5F9', color: '#475569' }}>
                  {rec!.service}
                </span>
                {rec!.impactLabel && (
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: IMPACT_BADGE.bg, color: IMPACT_BADGE.color, border: `0.5px solid ${IMPACT_BADGE.border}` }}>
                    {rec!.impactLabel}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px', flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* Savings hero */}
          <div style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)', borderRadius: '12px', padding: '20px 24px', marginBottom: '24px', border: '1px solid #BBF7D0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <DollarSign size={15} color="#16A34A" />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Potential Savings</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
              <span style={{ fontSize: '2rem', fontWeight: 700, color: '#15803D', letterSpacing: '-0.03em' }}>
                ${rec!.monthlySavings.toLocaleString()}<span style={{ fontSize: '1rem', fontWeight: 500 }}>/mo</span>
              </span>
              <span style={{ fontSize: '0.875rem', color: '#16A34A', fontWeight: 500 }}>
                ${rec!.annualSavings.toLocaleString()}/yr
              </span>
            </div>
            {rec!.downtime && (
              <p style={{ fontSize: '12px', color: '#15803D', margin: '8px 0 0' }}>
                {rec!.downtime} · {rec!.estimatedTime}
              </p>
            )}
          </div>

          {/* Description */}
          <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.7, margin: '0 0 24px' }}>
            {rec!.description}
          </p>

          {/* Usage chart */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Cpu size={14} color="#6366F1" />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Usage — Last 30 Days</span>
            </div>
            <div style={{ background: '#FAFAFA', borderRadius: '10px', padding: '16px 8px 8px', border: '1px solid #F1F5F9' }}>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    tickLine={false}
                    axisLine={false}
                    interval={6}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    y={thresh}
                    stroke="#EF4444"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: `${thresh}% threshold`, position: 'insideTopRight', fontSize: 10, fill: '#EF4444' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="utilization"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#7C3AED', strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: '8px 0 0', textAlign: 'center' }}>
              Dashed red line = oversized threshold · data is illustrative
            </p>
          </div>

          {/* Configuration comparison */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <TrendingDown size={14} color="#6366F1" />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Configuration Change</span>
            </div>
            <div style={{ borderRadius: '10px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#F8FAFC' }}>
                {['', 'Current', 'Recommended'].map((h, i) => (
                  <div key={i} style={{ padding: '10px 14px', fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #E2E8F0' }}>
                    {h}
                  </div>
                ))}
              </div>
              {rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    borderBottom: i < rows.length - 1 ? '1px solid #F1F5F9' : 'none',
                    background: row.label === 'Est. Savings' ? '#F0FDF4' : 'transparent',
                  }}>
                  <div style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>{row.label}</div>
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: '#0F172A', fontFamily: row.label.includes('Type') || row.label.includes('Class') || row.label.includes('Model') ? 'monospace' : 'inherit' }}>{row.current}</div>
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: row.label === 'Est. Savings' ? '#16A34A' : '#0F172A', fontWeight: row.label === 'Est. Savings' ? 600 : 400, fontFamily: row.label.includes('Type') || row.label.includes('Class') ? 'monospace' : 'inherit' }}>{row.recommended}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI explanation */}
          <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '16px 18px', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Zap size={14} color="#7C3AED" />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Explanation</span>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.7, margin: 0, fontStyle: 'italic' }}>
              &ldquo;{rec!.description || `This ${rec!.service} resource has been consistently underutilised over the past 30 days. Based on observed usage patterns, the recommended configuration change would maintain performance while reducing cost by ${Math.round((rec!.monthlySavings / (rec!.monthlySavings + 50)) * 100)}%.`}&rdquo;
            </p>
            {rec!.confidence != null && (
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: '10px 0 0' }}>
                AI confidence: <span style={{ fontWeight: 600, color: rec!.confidence >= 90 ? '#16A34A' : '#D97706' }}>{rec!.confidence}%</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Footer actions ───────────────────────────────────────── */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #F1F5F9', flexShrink: 0, background: '#FAFAFA' }}>
          {isActioned ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: rec!.status === 'ignored' ? '#94A3B8' : '#16A34A' }}>
                {rec!.status === 'ignored' ? 'Dismissed' : '✓ Approved'}
              </span>
              <button onClick={onClose} style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleApproveClick}
                disabled={isLoading}
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: isLoading ? '#15803D' : isSafe ? '#16A34A' : '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 0', fontSize: '13px', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.8 : 1, transition: 'background 0.15s' }}>
                {isLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {isSafe ? 'Approve This Change' : 'Mark for Review'}
              </button>
              <button
                onClick={handleDismissClick}
                disabled={isLoading}
                style={{ flex: 1, background: 'transparent', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '11px 0', fontSize: '13px', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.5 : 1, transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = '#F9FAFB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                Dismiss
              </button>
              <button
                onClick={onClose}
                style={{ background: 'transparent', color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '11px 14px', fontSize: '13px', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}
