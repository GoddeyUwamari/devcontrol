'use client';

import { useState, useEffect, useCallback } from 'react';
import { anomalyService } from '@/lib/services/anomaly.service';
import { AnomalyDetection, AnomalyStats } from '@/types/anomaly.types';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Activity,
  RefreshCw,
  Brain,
  DollarSign,
  Server,
  Eye,
  CheckCheck,
  Flag,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#DC2626', bg: '#FEF2F2', border: '#FEE2E2', label: 'Critical' },
  warning:  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Warning'  },
  info:     { color: '#64748B', bg: '#F8FAFC', border: '#F1F5F9', label: 'Info'     },
};

const overline: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 16px',
};

export default function AnomaliesPage() {
  // ── PRESERVED STATE ──────────────────────────────────────────────────────
  const [anomalies, setAnomalies] = useState<AnomalyDetection[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);

  // ── ADDED STATE ──────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── PRESERVED LOGIC ─────────────────────────────────────────────────────
  const loadAnomalies = useCallback(async () => {
    try {
      const data = await anomalyService.getAnomalies(filter);
      setAnomalies(data.anomalies);
      setStats(data.stats);
    } catch (error) {
      console.error('Failed to load anomalies:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadAnomalies();
    const interval = setInterval(loadAnomalies, 30000);
    return () => clearInterval(interval);
  }, [loadAnomalies]);

  const triggerScan = async () => {
    setIsScanning(true);
    setLastScanResult(null);
    try {
      const result = await anomalyService.triggerScan();
      setLastScanResult(result.message);
      await loadAnomalies();
    } catch (error) {
      console.error('Scan failed:', error);
      setLastScanResult('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  // ── ACTION HANDLERS WITH LOADING STATE ──────────────────────────────────
  const handleAcknowledge = async (id: string) => {
    setActionLoading(id + '-ack');
    try { await anomalyService.acknowledge(id); await loadAnomalies(); }
    catch (e) { console.error(e); }
    finally { setActionLoading(null); }
  };

  const handleResolve = async (id: string) => {
    setActionLoading(id + '-res');
    try { await anomalyService.resolve(id); await loadAnomalies(); }
    catch (e) { console.error(e); }
    finally { setActionLoading(null); }
  };

  const handleFalsePositive = async (id: string) => {
    setActionLoading(id + '-fp');
    try { await anomalyService.markFalsePositive(id); await loadAnomalies(); }
    catch (e) { console.error(e); }
    finally { setActionLoading(null); }
  };

  // ── DERIVED VALUES ───────────────────────────────────────────────────────
  const activeCount   = stats?.active ?? anomalies.filter(a => a.status === 'active').length;
  const criticalCount = stats?.bySeverity?.critical ?? anomalies.filter(a => a.severity === 'critical').length;
  const resolvedCount = anomalies.filter(a => a.status === 'resolved').length;
  const fpCount       = anomalies.filter(a => a.status === 'false_positive').length;

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '40px 56px 80px',
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
            Anomaly Detection
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
            AI-powered threat detection across your AWS infrastructure · Auto-refreshes every 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {lastScanResult && (
            <span style={{ fontSize: '0.78rem', color: '#059669', background: '#F0FDF4', padding: '6px 12px', borderRadius: '8px', border: '1px solid #D1FAE5' }}>
              {lastScanResult}
            </span>
          )}
          <button
            onClick={triggerScan}
            disabled={isScanning}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: isScanning ? '#E2E8F0' : '#7C3AED',
              color: isScanning ? '#94A3B8' : '#fff',
              padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600,
              border: 'none', cursor: isScanning ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
            }}
          >
            {isScanning
              ? <><RefreshCw size={15} /> Scanning...</>
              : <><RefreshCw size={15} /> Run Scan</>
            }
          </button>
        </div>
      </div>

      {/* ── 4 KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          {
            label: 'Active Anomalies',
            value: isLoading ? '—' : activeCount,
            sub: 'Requiring attention',
            valueColor: activeCount > 5 ? '#DC2626' : activeCount > 0 ? '#D97706' : '#059669',
          },
          {
            label: 'Critical Severity',
            value: isLoading ? '—' : criticalCount,
            sub: 'Immediate action required',
            valueColor: criticalCount > 0 ? '#DC2626' : '#059669',
          },
          {
            label: 'Resolved Today',
            value: isLoading ? '—' : resolvedCount,
            sub: 'Successfully mitigated',
            valueColor: '#059669',
          },
          {
            label: 'False Positives',
            value: isLoading ? '—' : fpCount,
            sub: 'Marked this session',
            valueColor: '#64748B',
          },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #F1F5F9' }}>
            <p style={overline}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
              {value}
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── FILTER TABS ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
          {(['active', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '7px 20px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
                background: filter === f ? '#fff' : 'transparent',
                color: filter === f ? '#0F172A' : '#64748B',
                boxShadow: filter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {f === 'active' ? `Active (${stats?.active ?? 0})` : 'All Anomalies'}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
          {anomalies.length} {filter === 'active' ? 'active' : 'total'} anomalies
        </p>
      </div>

      {/* ── ANOMALY LIST ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {isLoading ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
            <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading anomalies...</p>
          </div>
        ) : anomalies.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
            <CheckCircle2 size={32} style={{ color: '#059669', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No anomalies detected</p>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.6 }}>
              Your infrastructure is clean. Run a scan to check for new threats.
            </p>
            <button
              onClick={triggerScan}
              style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              Run Scan Now
            </button>
          </div>
        ) : (
          anomalies.map((anomaly: AnomalyDetection) => {
            const sev = severityConfig[anomaly.severity] ?? severityConfig.info;
            const isExpanded = expandedId === anomaly.id;

            return (
              <div
                key={anomaly.id}
                style={{
                  background: '#fff',
                  borderRadius: '14px',
                  border: `1px solid ${isExpanded ? sev.border : '#F1F5F9'}`,
                  overflow: 'hidden',
                  transition: 'all 0.15s',
                }}
              >
                {/* ── Main row ── */}
                <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>

                  {/* Severity dot */}
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: sev.color, flexShrink: 0 }} />

                  {/* Title + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0F172A', margin: 0, lineHeight: 1.4 }}>
                        {anomaly.title}
                      </p>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: sev.bg, color: sev.color, flexShrink: 0 }}>
                        {sev.label}
                      </span>
                      {anomaly.status === 'acknowledged' && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F0F9FF', color: '#0EA5E9', flexShrink: 0 }}>
                          Acknowledged
                        </span>
                      )}
                      {anomaly.status === 'resolved' && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F0FDF4', color: '#059669', flexShrink: 0 }}>
                          Resolved
                        </span>
                      )}
                      {anomaly.status === 'false_positive' && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F8FAFC', color: '#64748B', flexShrink: 0 }}>
                          False Positive
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.78rem', color: '#64748B', flexWrap: 'wrap' }}>
                      {anomaly.resourceType && <span>{anomaly.resourceType}</span>}
                      {anomaly.resourceName && <><span>·</span><span>{anomaly.resourceName}</span></>}
                      {anomaly.region && <><span>·</span><span>{anomaly.region}</span></>}
                      {anomaly.detectedAt && (
                        <><span>·</span><span>{new Date(anomaly.detectedAt).toLocaleString()}</span></>
                      )}
                    </div>
                  </div>

                  {/* Metric chips */}
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <div style={{ textAlign: 'center', padding: '6px 12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
                      <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginBottom: '2px' }}>Deviation</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: Math.abs(anomaly.deviation) > 50 ? '#DC2626' : '#D97706', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        {anomaly.deviation > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(0)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '6px 12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
                      <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginBottom: '2px' }}>Confidence</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>{anomaly.confidence}%</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {anomaly.status === 'active' && (
                      <>
                        <button
                          onClick={() => handleAcknowledge(anomaly.id)}
                          disabled={actionLoading === anomaly.id + '-ack'}
                          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                        >
                          {actionLoading === anomaly.id + '-ack' ? <RefreshCw size={11} /> : <Eye size={11} />}
                          Acknowledge
                        </button>
                        <button
                          onClick={() => handleResolve(anomaly.id)}
                          disabled={actionLoading === anomaly.id + '-res'}
                          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#059669', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#fff', cursor: 'pointer' }}
                        >
                          {actionLoading === anomaly.id + '-res' ? <RefreshCw size={11} /> : <CheckCheck size={11} />}
                          Resolve
                        </button>
                      </>
                    )}
                    {anomaly.status === 'acknowledged' && (
                      <button
                        onClick={() => handleResolve(anomaly.id)}
                        disabled={actionLoading === anomaly.id + '-res'}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#059669', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#fff', cursor: 'pointer' }}
                      >
                        {actionLoading === anomaly.id + '-res' ? <RefreshCw size={11} /> : <CheckCheck size={11} />}
                        Resolve
                      </button>
                    )}
                    {(anomaly.status === 'active' || anomaly.status === 'acknowledged') && (
                      <button
                        onClick={() => handleFalsePositive(anomaly.id)}
                        disabled={actionLoading === anomaly.id + '-fp'}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 500, color: '#94A3B8', cursor: 'pointer' }}
                      >
                        {actionLoading === anomaly.id + '-fp' ? <RefreshCw size={11} /> : <Flag size={11} />}
                        False Positive
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : anomaly.id)}
                      style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', color: '#64748B', display: 'flex', alignItems: 'center' }}
                    >
                      <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                    </button>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div style={{ padding: '20px 24px', borderTop: `1px solid ${sev.border}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                      {[
                        {
                          label: 'Current Value',
                          value: anomaly.metric === 'total_cost'
                            ? `$${anomaly.currentValue.toFixed(2)}`
                            : anomaly.currentValue.toLocaleString(),
                        },
                        {
                          label: 'Expected',
                          value: anomaly.metric === 'total_cost'
                            ? `$${anomaly.expectedValue.toFixed(2)}`
                            : anomaly.expectedValue.toLocaleString(),
                        },
                        { label: 'Time Window', value: anomaly.timeWindow },
                        { label: 'Metric',      value: anomaly.metric.replace(/_/g, ' ') },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
                          <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{label}</p>
                          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {anomaly.description && (
                        <div>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Description</p>
                          <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{anomaly.description}</p>
                        </div>
                      )}
                      {anomaly.aiExplanation && (
                        <div style={{ padding: '14px 16px', background: '#F5F3FF', borderRadius: '10px', border: '1px solid #EDE9FE' }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>AI Analysis</p>
                          <p style={{ fontSize: '0.875rem', color: '#3730A3', margin: 0, lineHeight: 1.7 }}>{anomaly.aiExplanation}</p>
                        </div>
                      )}
                      {anomaly.impact && (
                        <div style={{ padding: '14px 16px', background: '#FFFBEB', borderRadius: '10px', border: '1px solid #FDE68A' }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Impact</p>
                          <p style={{ fontSize: '0.875rem', color: '#92400E', margin: 0, lineHeight: 1.7 }}>{anomaly.impact}</p>
                        </div>
                      )}
                      {anomaly.recommendation && (
                        <div style={{ padding: '14px 16px', background: '#F0FDF4', borderRadius: '10px', border: '1px solid #BBF7D0' }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Recommended Action</p>
                          <p style={{ fontSize: '0.875rem', color: '#065F46', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{anomaly.recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
