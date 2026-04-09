'use client';

import { useState, useEffect, useCallback } from 'react';

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
import { anomalyService } from '@/lib/services/anomaly.service';
import { usePlan } from '@/lib/hooks/use-plan';
import { AnomalyDetection, AnomalyStats } from '@/types/anomaly.types';
import {
  AlertTriangle,
  AlertCircle,
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
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Settings,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import customAnomalyRulesService, { CustomAnomalyRule, CreateRulePayload } from '@/lib/services/custom-anomaly-rules.service';

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#DC2626', bg: '#FEF2F2', border: '#FEE2E2', label: 'Critical' },
  warning:  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Warning'  },
  info:     { color: '#64748B', bg: '#F8FAFC', border: '#F1F5F9', label: 'Info'     },
};

const confidenceLabel = (score: number): string => {
  if (score >= 80) return 'High'
  if (score >= 50) return 'Medium'
  return 'Low'
}

const overline: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 16px',
};

export default function AnomaliesPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  // ── PRESERVED STATE ──────────────────────────────────────────────────────
  const { isPro } = usePlan();
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false);
  const [anomalies, setAnomalies] = useState<AnomalyDetection[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);

  // ── ADDED STATE ──────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [lastScanLoading, setLastScanLoading] = useState(true);
  const [rules, setRules] = useState<CustomAnomalyRule[]>([])
  const [showRulesPanel, setShowRulesPanel] = useState(false)
  const [showCreateRule, setShowCreateRule] = useState(false)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [newRule, setNewRule] = useState<CreateRulePayload>({
    name: '',
    metric: 'cost',
    condition: 'greater_than',
    threshold: 0,
    timeWindow: '1h',
    severity: 'warning',
  })
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ── PRESERVED LOGIC ─────────────────────────────────────────────────────
  const loadAnomalies = useCallback(async () => {
    try {
      const data = await anomalyService.getAnomalies(filter);
      setAnomalies(data.anomalies);
      setStats(data.stats);
    } catch (error: any) {
      if (error?.status === 402) setShowUpgradeBanner(true);
      else console.error('Failed to load anomalies:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadAnomalies();
    const interval = setInterval(loadAnomalies, 300000);
    return () => clearInterval(interval);
  }, [loadAnomalies]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  useEffect(() => {
    anomalyService.getLastScan()
      .then(t => { setLastScanTime(t); setLastScanLoading(false) })
      .catch(() => setLastScanLoading(false))
    customAnomalyRulesService.getRules()
      .then(setRules)
      .catch(() => {})
  }, [])

  const triggerScan = async () => {
    setIsScanning(true);
    setLastScanResult(null);
    try {
      const result = await anomalyService.triggerScan();
      setLastScanResult(result.message);
      setLastScanTime(new Date());
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

  const handleCreateRule = async () => {
    if (!newRule.name.trim()) { toast.error('Rule name is required'); return }
    if (!newRule.threshold)   { toast.error('Threshold is required'); return }
    setRulesLoading(true)
    try {
      const rule = await customAnomalyRulesService.createRule(newRule)
      setRules(r => [rule, ...r])
      setShowCreateRule(false)
      setNewRule({ name: '', metric: 'cost', condition: 'greater_than', threshold: 0, timeWindow: '1h', severity: 'warning' })
      toast.success('Rule created')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to create rule')
    } finally {
      setRulesLoading(false)
    }
  }

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      await customAnomalyRulesService.toggleRule(id, enabled)
      setRules(r => r.map(rule => rule.id === id ? { ...rule, enabled } : rule))
    } catch {
      toast.error('Failed to update rule')
    }
  }

  const handleDeleteRule = async (id: string) => {
    try {
      await customAnomalyRulesService.deleteRule(id)
      setRules(r => r.filter(rule => rule.id !== id))
      toast.success('Rule deleted')
    } catch {
      toast.error('Failed to delete rule')
    }
  }

  // ── DERIVED VALUES ───────────────────────────────────────────────────────
  const activeCount   = stats?.active ?? anomalies.filter(a => a.status === 'active').length;
  const criticalCount = anomalies.filter(a => a.severity === 'critical' && a.status === 'active').length;
  const resolvedCount = anomalies.filter(a => a.status === 'resolved').length;
  const fpCount       = anomalies.filter(a => a.status === 'false_positive').length;
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' && a.status === 'active');
  const topAnomaly = criticalAnomalies[0] ?? anomalies[0];
  const systemsImpacted = new Set(
    anomalies
      .filter(a => a.status === 'active')
      .map(a => a.resourceName ?? a.resourceType)
      .filter(Boolean)
  ).size;

  // ── RENDER ───────────────────────────────────────────────────────────────
  if (!isPro) {
    return (
      <div style={{
        padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 80px', maxWidth: '1320px', margin: '0 auto',
        minHeight: '100vh', background: '#F9FAFB', fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px', background: '#F5F3FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <Lock size={24} color="#7C3AED" />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>
            Pro Plan Required
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>
            This feature is available on the Pro plan and above.
          </p>
          <a
            href="/settings/billing/upgrade"
            style={{
              display: 'inline-block', background: '#7C3AED', color: '#fff',
              padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem',
              fontWeight: 600, textDecoration: 'none',
            }}
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 80px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* UPGRADE BANNER */}
      {showUpgradeBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '24px', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400E' }}>
              This feature requires the Pro plan.
            </span>
          </div>
          <a
            href="/settings/billing/upgrade"
            style={{
              flexShrink: 0, fontSize: '0.8125rem', fontWeight: 600,
              color: '#fff', background: '#D97706', borderRadius: '6px',
              padding: '7px 16px', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            Upgrade to Pro
          </a>
        </div>
      )}

      {/* ── PAGE HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Detect Cost, Security, and Infrastructure Anomalies in Real Time
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
            AI continuously analyzes your AWS activity to surface unusual spend, misconfigurations, and performance risks · AI scans run every 15 minutes
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
              border: 'none', cursor: isScanning ? 'not-allowed' : 'pointer',
            }}
          >
            {isScanning
              ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</>
              : <><RefreshCw size={15} /> Run Scan</>
            }
          </button>
        </div>
      </div>

      {/* ── EXECUTIVE INSIGHT BANNER ── */}
      {anomalies.length > 0 && (
        <div style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderLeft: '4px solid #DC2626',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px',
        }}>
          <div style={{
            width: '34px', height: '34px',
            borderRadius: '8px', background: '#FEF2F2',
            flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={14} style={{ color: '#DC2626' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{
              fontSize: '0.875rem', fontWeight: 700,
              color: '#0F172A', margin: '0 0 8px',
            }}>
              {criticalAnomalies.length} critical anomal{criticalAnomalies.length !== 1 ? 'ies' : 'y'} — EC2 latency risk causing user-facing degradation
            </p>
            <p style={{
              fontSize: '0.78rem', color: '#475569',
              margin: '0 0 14px',
            }}>
              {criticalAnomalies.length} service{criticalAnomalies.length !== 1 ? 's' : ''} impacted · {topAnomaly?.region ?? 'us-east-1'}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setExpandedId(topAnomaly?.id ?? null)}
                style={{
                  background: '#DC2626', color: '#fff',
                  border: 'none', borderRadius: '7px',
                  padding: '7px 16px', fontSize: '0.78rem',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Fix top issue →
              </button>
              <button
                onClick={() => setFilter('all')}
                style={{
                  background: '#fff', color: '#374151',
                  border: '1px solid #E2E8F0',
                  borderRadius: '7px', padding: '7px 16px',
                  fontSize: '0.78rem', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View all anomalies
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM STATUS BAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '14px', padding: '9px 16px',
        background: '#fff', borderRadius: '8px',
        border: '1px solid #E2E8F0',
        marginBottom: '20px',
        justifyContent: 'space-between',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              width: '7px', height: '7px',
              borderRadius: '50%', background: '#22C55E',
              display: 'inline-block',
            }}/>
            <span style={{
              fontSize: '0.875rem', fontWeight: 600,
              color: '#0F172A',
            }}>
              Monitoring active
            </span>
          </div>
          <span style={{ color: '#E2E8F0' }}>|</span>
          <span style={{
            fontSize: '0.82rem', color: '#475569',
          }}>
            {isScanning
              ? 'Scan in progress…'
              : lastScanTime
                ? <>Last scan:{' '}
                  <strong style={{ color: '#374151' }}>
                    {lastScanTime.toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </strong></>
                : 'Initial scan in progress'
            }{' · '}next scan{' '}
            <strong style={{ color: '#374151' }}>
              ~15 min
            </strong>
          </span>
        </div>
        <span style={{
          fontSize: '0.78rem', color: '#64748B',
        }}>
          EC2, S3, RDS, IAM, Lambda
        </span>
      </div>

      {/* ── 4 KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '20px' }}>
        {/* Card 1 — Active Issues */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>Active Issues</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>{activeCount}</span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#D97706', flexShrink: 0, display: 'inline-block' }} />
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6, minHeight: '2.4em' }}>Requiring immediate attention</p>
        </div>
        {/* Card 2 — Critical Issues */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>Critical Issues</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>{criticalCount}</span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#DC2626', flexShrink: 0, display: 'inline-block' }} />
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6, minHeight: '2.4em' }}>Highest severity · action needed</p>
        </div>
        {/* Card 3 — Systems Impacted */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>Systems Impacted</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>{systemsImpacted}</span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94A3B8', flexShrink: 0, display: 'inline-block' }} />
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6, minHeight: '2.4em' }}>Active resources affected</p>
        </div>
        {/* Card 4 — Estimated Impact */}
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>Estimated Impact</p>
          <div style={{
            fontSize: '1.25rem', fontWeight: 700,
            color: activeCount === 0 ? '#059669' : criticalCount > 0 ? '#DC2626' : '#D97706',
            letterSpacing: '-0.02em', lineHeight: 1.2,
            minHeight: '40px', display: 'flex', alignItems: 'center',
            marginBottom: '8px',
          }}>
            {activeCount === 0
              ? 'None'
              : criticalCount > 0
                ? `${criticalCount} service${criticalCount > 1 ? 's' : ''} degraded`
                : 'Monitoring'}
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6, minHeight: '2.4em' }}>
            {activeCount === 0
              ? 'No active issues detected'
              : criticalCount > 0
                ? `${criticalCount} user-facing service${criticalCount > 1 ? 's' : ''} — act now`
                : 'No critical issues active'}
          </p>
        </div>
      </div>

      {/* ── FILTER ROW ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '12px', marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{
          display: 'flex', background: '#F8FAFC',
          borderRadius: '8px', padding: '3px',
          gap: '2px', flexShrink: 0,
        }}>
          {(['active', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: filter === f ? 600 : 500,
                border: 'none', cursor: 'pointer',
                background: filter === f ? '#fff' : 'transparent',
                color: filter === f ? '#0F172A' : '#64748B',
                boxShadow: filter === f ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {f === 'active' ? `Active (${activeCount})` : 'All anomalies'}
            </button>
          ))}
        </div>
        <span style={{ width: '1px', height: '20px', background: '#E2E8F0', flexShrink: 0 }}/>
        <span style={{
          fontSize: '0.78rem', fontWeight: 600,
          color: '#64748B', letterSpacing: '0.04em',
          textTransform: 'uppercase', flexShrink: 0,
        }}>
          Filters:
        </span>
        {[
          { label: 'Severity', options: ['All', 'Critical', 'Warning', 'Info'] },
          { label: 'Service', options: ['All', 'EC2', 'Lambda', 'RDS', 'S3'] },
          { label: 'Region', options: ['All', 'us-east-1', 'us-west-2', 'eu-west-1'] },
          { label: 'Time', options: ['Last 24h', 'Last 7d', 'Last 30d'] },
        ].map(({ label, options }) => (
          <select
            key={label}
            style={{
              height: '38px', padding: '0 10px',
              borderRadius: '7px',
              border: '1px solid #E2E8F0',
              fontSize: '0.82rem', color: '#374151',
              background: '#fff', cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {options.map(o => (
              <option key={o}>
                {o === 'All' ? `${label}: All` : o}
              </option>
            ))}
          </select>
        ))}
        <span style={{
          fontSize: '0.78rem', color: '#64748B',
          marginLeft: 'auto', whiteSpace: 'nowrap',
        }}>
          {anomalies.length}{' '}
          {filter === 'active' ? 'active' : 'total'}{' '}
          anomalies
        </span>
      </div>

      {/* ── BULK ACTIONS ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: '10px', marginBottom: '14px',
        background: '#F8FAFC',
        borderRadius: '8px',
        padding: '8px 12px',
        border: '1px solid #E2E8F0',
      }}>
        <label style={{
          display: 'flex', alignItems: 'center',
          gap: '6px', fontSize: '0.82rem',
          color: '#374151', cursor: 'pointer',
          fontWeight: 500, flexShrink: 0,
        }}>
          <input type="checkbox" style={{
            width: '13px', height: '13px',
            accentColor: '#7C3AED',
          }}
          onChange={(e) => {
            setSelectedIds(e.target.checked
              ? anomalies.map(a => a.id)
              : [])
          }}
          checked={selectedIds.length === anomalies.length && anomalies.length > 0}
          />
          Select all
        </label>
        <span style={{ color: '#E2E8F0' }}>|</span>
        <button
          onClick={async () => {
            await Promise.all(selectedIds.map(id => handleResolve(id)))
            setSelectedIds([])
          }}
          disabled={selectedIds.length === 0}
          style={{
            padding: '4px 12px', borderRadius: '6px',
            border: '1px solid #BBF7D0',
            background: '#F0FDF4', fontSize: '0.82rem',
            fontWeight: 600, color: '#059669',
            cursor: 'pointer',
          }}
        >
          Resolve selected
        </button>
        <button
          onClick={async () => {
            await Promise.all(selectedIds.map(id => handleFalsePositive(id)))
            setSelectedIds([])
          }}
          disabled={selectedIds.length === 0}
          style={{
            padding: '4px 12px', borderRadius: '6px',
            border: '1px solid #E2E8F0',
            background: '#fff', fontSize: '0.82rem',
            fontWeight: 500, color: '#64748B',
            cursor: 'pointer', opacity: 0.8,
          }}>
          Ignore selected
        </button>
        <button style={{
          padding: '4px 12px', borderRadius: '6px',
          border: '1px solid #DDD6FE',
          background: '#F5F3FF', fontSize: '0.82rem',
          fontWeight: 500, color: '#7C3AED',
          cursor: 'pointer', opacity: 0.8,
        }}>
          Assign selected
        </button>
        <span style={{
          fontSize: '0.82rem', fontWeight: 600,
          color: '#0F172A', marginLeft: '8px',
        }}>
          Priority Issues ({activeCount})
        </span>
      </div>

      {/* ── ANOMALY LIST ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {isLoading ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
            <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading anomalies...</p>
          </div>
        ) : anomalies.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '48px 56px', border: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                <CheckCircle2 size={22} style={{ color: '#16A34A' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>
                  No anomalies detected — your infrastructure looks healthy
                </p>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.7 }}>
                  We continuously monitor for:
                </p>
                <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {[
                    'Unusual cost spikes and budget overruns',
                    'Suspicious access patterns and IAM changes',
                    'Security misconfigurations and open ports',
                    'Infrastructure performance anomalies',
                  ].map(item => (
                    <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.855rem', color: '#374151' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#7C3AED', flexShrink: 0, display: 'inline-block' }} />
                      {item}
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
                    Last scan completed:{' '}
                    <span style={{ fontWeight: 600, color: '#64748B' }}>
                      {lastScanLoading
                        ? 'Checking…'
                        : lastScanTime
                          ? lastScanTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : 'Pending first scan'}
                    </span>
                  </p>
                  <button
                    onClick={triggerScan}
                    disabled={isScanning}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#7C3AED', color: '#fff', padding: '8px 18px', borderRadius: '7px', fontSize: '0.82rem', fontWeight: 600, border: 'none', cursor: isScanning ? 'not-allowed' : 'pointer' }}
                  >
                    {isScanning ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Scanning…</> : <><RefreshCw size={12} /> Run Scan Now</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          anomalies.map((anomaly: AnomalyDetection, index: number) => {
            const sev = severityConfig[anomaly.severity] ?? severityConfig.info;
            const isExpanded = expandedId === anomaly.id;
            const isFirst = filter === 'active' && index === 0;
            const minutesAgo = anomaly.detectedAt
              ? Math.round((Date.now() - new Date(anomaly.detectedAt).getTime()) / 60000)
              : null;
            const timeDisplay = minutesAgo === null
              ? 'Ongoing'
              : minutesAgo < 60
                ? `Active ${minutesAgo}m`
                : minutesAgo < 1440
                  ? `Ongoing (${Math.floor(minutesAgo / 60)}h)`
                  : `Ongoing (${Math.floor(minutesAgo / 1440)}d)`;

            return (
              <div
                key={anomaly.id}
                style={{
                  background: '#fff',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  overflow: 'hidden',
                }}
              >
                {/* ── Priority header strip ── */}
                <div style={{
                  padding: '7px 20px 7px 22px',
                  background: '#F8FAFC',
                  borderBottom: '1px solid #E2E8F0',
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  {isFirst ? (
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#FEE2E2', color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ACT NOW
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#F1F5F9', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      #{index + 1} Priority
                    </span>
                  )}
                  <span style={{ fontSize: '0.78rem', color: '#475569' }}>
                    {isFirst
                      ? `#1 of ${anomalies.length} — act on this first`
                      : 'Secondary issue'}
                  </span>
                </div>

                {/* ── Main card body ── */}
                <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>

                  {/* Checkbox */}
                  <input type="checkbox" style={{ width: '13px', height: '13px', accentColor: '#7C3AED', marginTop: '5px', flexShrink: 0 }}
                    onChange={(e) => {
                      setSelectedIds(prev =>
                        e.target.checked
                          ? [...prev, anomaly.id]
                          : prev.filter(id => id !== anomaly.id))
                    }}
                    checked={selectedIds.includes(anomaly.id)}
                  />

                  {/* Center content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Title row + all derived text */}
                    {(() => {
                      const t = anomaly.title ?? '';
                      const rt = anomaly.resourceType ?? '';
                      const d = anomaly.deviation ?? 0;
                      const dAbs = Math.round(Math.abs(d));
                      const metric = anomaly.metric?.replace(/_/g, ' ') ?? 'metric';

                      // CHANGE 5: Lambda uses "concurrency saturation"
                      const riskTitle = (() => {
                        if (t.toLowerCase().includes('cpu')) {
                          return `${rt} latency risk — CPU saturation (${anomaly.currentValue ? Math.round(anomaly.currentValue) : Math.round(d)}%)`;
                        }
                        if (t.toLowerCase().includes('lambda') || t.toLowerCase().includes('invocation')) {
                          return `${rt} throttling risk — concurrency saturation (+${Math.round(Math.abs(d))}%)`;
                        }
                        if (t.toLowerCase().includes('cost') || t.toLowerCase().includes('spend')) {
                          return `Cost spike — ${rt} overspend (+${Math.round(Math.abs(d))}%)`;
                        }
                        if (t.toLowerCase().includes('memory')) {
                          return `${rt} memory pressure — degradation risk`;
                        }
                        return t;
                      })();

                      const decisionSummary = (() => {
                        if (rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu')) {
                          return 'User-facing API latency increasing';
                        }
                        if (rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation')) {
                          return 'Lambda concurrency exhausted — payment flow at risk';
                        }
                        if (anomaly.severity === 'critical') {
                          return `${rt} degradation — immediate action required`;
                        }
                        return `${rt} anomaly — monitor for impact`;
                      })();

                      const impactText = (() => {
                        if (rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu')) {
                          return `+${dAbs > 50 ? Math.round(dAbs * 0.3) : 35}% latency → user-facing degradation`;
                        }
                        if (rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation')) {
                          return `+${dAbs}% load → Lambda throttling → payment risk`;
                        }
                        if (anomaly.severity === 'critical') {
                          return `${rt} degradation → user-facing services affected`;
                        }
                        return `${rt} performance degraded — monitor downstream`;
                      })();

                      // CHANGE 3: cause bullets array
                      const causeText: string[] = (() => {
                        if (rt.toLowerCase().includes('ec2') || metric.toLowerCase().includes('cpu')) {
                          return [
                            'Traffic spike or under-provisioned EC2 instances',
                            'CPU sustained >80% → throttling risk',
                          ];
                        }
                        if (rt.toLowerCase().includes('lambda') || metric.toLowerCase().includes('invocation')) {
                          return [
                            'Invocation surge exceeding concurrency limits',
                            `+${dAbs}% above normal → throttling + cost impact`,
                          ];
                        }
                        return [
                          `${rt} ${metric} +${dAbs}% above normal baseline`,
                          anomaly.severity === 'critical' ? 'Immediate investigation required' : 'Monitor for escalation',
                        ];
                      })();

                      return (
                        <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.4 }}>
                        {riskTitle}
                      </p>
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: sev.bg, color: sev.color, flexShrink: 0 }}>
                        {sev.label}
                      </span>
                      {/* CHANGE 6: Unassigned moved here, after severity badge */}
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 600, color: '#D97706',
                        background: '#FFFBEB', border: '1px solid #FDE68A',
                        padding: '2px 8px', borderRadius: '4px',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                      }}>
                        <AlertCircle size={10} style={{ color: '#D97706' }}/>
                        Unassigned
                      </span>
                      {anomaly.status === 'acknowledged' && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: '#F0F9FF', color: '#0EA5E9', flexShrink: 0 }}>Acknowledged</span>
                      )}
                      {anomaly.status === 'resolved' && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: '#F0FDF4', color: '#059669', flexShrink: 0 }}>Resolved</span>
                      )}
                      {anomaly.status === 'false_positive' && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: '#F8FAFC', color: '#64748B', flexShrink: 0 }}>False Positive</span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#64748B', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {timeDisplay}
                      </span>
                    </div>

                    {/* Decision summary */}
                    <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#374151', margin: '0 0 8px', lineHeight: 1.5 }}>
                      {decisionSummary}
                    </p>

                    {/* Metadata row */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', fontSize: '0.82rem', color: '#475569', flexWrap: 'wrap' }}>
                      {anomaly.resourceType && <span>{anomaly.resourceType}</span>}
                      {anomaly.resourceName && <><span style={{ color: '#D1D5DB' }}>·</span><span>{anomaly.resourceName}</span></>}
                      {anomaly.region && <><span style={{ color: '#D1D5DB' }}>·</span><span>{anomaly.region}</span></>}
                    </div>

                    {/* Impact block — CHANGE 2: padding 10px 14px */}
                    <div style={{
                      background: '#FFFBEB', border: '1px solid #FDE68A',
                      borderRadius: '6px', padding: '10px 14px', marginBottom: '8px',
                      display: 'flex', alignItems: 'center', gap: '7px',
                      fontSize: '0.875rem', color: '#92400E',
                    }}>
                      <AlertCircle size={12} style={{ color: '#D97706', flexShrink: 0 }} />
                      <strong style={{ color: '#92400E' }}>Impact:</strong>{' '}{impactText}
                    </div>

                    {/* Root cause block — CHANGE 3: bullet list */}
                    <div style={{
                      background: '#F8FAFC', border: '1px solid #E2E8F0',
                      borderRadius: '6px', padding: '10px 12px', marginBottom: '12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <Brain size={12} style={{ color: '#7C3AED', flexShrink: 0 }}/>
                        <strong style={{ fontSize: '0.75rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Root Cause
                        </strong>
                      </div>
                      {causeText.map((bullet, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: i < causeText.length - 1 ? '4px' : 0 }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#7C3AED', flexShrink: 0, marginTop: '7px' }}/>
                          <span style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>{bullet}</span>
                        </div>
                      ))}
                    </div>

                    {/* Signal line */}
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#059669' }}>
                        {confidenceLabel(anomaly.confidence)} confidence
                      </span>
                      <span style={{ color: '#D1D5DB', userSelect: 'none' }}>|</span>
                      <span>
                        <span style={{ color: '#64748B' }}>Deviation:</span>{' '}
                        <span style={{ fontWeight: 600, color: Math.abs(anomaly.deviation) > 50 ? '#DC2626' : '#D97706' }}>
                          {anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(0)}%
                        </span>
                      </span>
                      <span style={{ color: '#D1D5DB', userSelect: 'none' }}>|</span>
                      <span style={{ color: '#475569' }}>Medium effort · No downtime</span>
                    </p>
                        </>
                      );
                    })()}
                  </div>

                  {/* Right: action column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', flexShrink: 0, minWidth: '130px' }}>
                    {(anomaly.status === 'active' || anomaly.status === 'acknowledged') && (
                      <button
                        onClick={() => handleResolve(anomaly.id)}
                        disabled={actionLoading === anomaly.id + '-res'}
                        style={{
                          background: '#059669', color: '#fff', border: 'none',
                          borderRadius: '8px', padding: '9px 14px',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {actionLoading === anomaly.id + '-res'
                          ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
                          : 'Apply fix →'}
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : anomaly.id)}
                      style={{
                        background: '#fff', color: '#374151',
                        border: '1px solid #E2E8F0', borderRadius: '8px',
                        padding: '8px 14px', fontSize: '0.82rem', fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Investigate
                    </button>

                    {/* ⋯ overflow menu */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === anomaly.id ? null : anomaly.id) }}
                        style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', color: '#64748B', display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'center' }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {openMenuId === anomaly.id && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.10)', zIndex: 50, minWidth: '178px', padding: '4px' }}
                        >
                          <button
                            onClick={() => { setExpandedId(isExpanded ? null : anomaly.id); setOpenMenuId(null) }}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', borderRadius: '5px', border: 'none', background: 'none', fontSize: '0.8rem', color: '#374151', cursor: 'pointer', textAlign: 'left', fontWeight: 500 }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >
                            <ChevronDown size={13} style={{ color: '#6B7280', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
                            View Details
                          </button>
                          {(anomaly.status === 'active' || anomaly.status === 'acknowledged') && (
                            <>
                              <div style={{ height: '1px', background: '#F1F5F9', margin: '3px 0' }} />
                              <button
                                onClick={() => { handleResolve(anomaly.id); setOpenMenuId(null) }}
                                disabled={actionLoading === anomaly.id + '-res'}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', borderRadius: '5px', border: 'none', background: 'none', fontSize: '0.8rem', color: '#059669', cursor: 'pointer', textAlign: 'left', fontWeight: 500 }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                <CheckCheck size={13} /> Mark as Resolved
                              </button>
                              <button
                                onClick={() => { handleFalsePositive(anomaly.id); setOpenMenuId(null) }}
                                disabled={actionLoading === anomaly.id + '-fp'}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', borderRadius: '5px', border: 'none', background: 'none', fontSize: '0.8rem', color: '#64748B', cursor: 'pointer', textAlign: 'left', fontWeight: 500 }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                <Flag size={13} /> Mark as False Positive
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div style={{ padding: '20px 24px', borderTop: `1px solid #E2E8F0` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
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

      {/* CUSTOM ANOMALY RULES — Enterprise */}
      <div style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px 12px 0 0', borderBottom: 'none' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '0.78rem', fontWeight: 500, color: '#64748B', margin: 0 }}>Custom Detection Rules</h2>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: '#F5F3FF', color: '#7C3AED', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Enterprise</span>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{rules.length} rules active</span>
            </div>
          </div>
          <button
            onClick={() => setShowCreateRule(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#7C3AED', color: '#fff', padding: '5px 11px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <Plus size={12} /> New Rule
          </button>
        </div>

        {/* Create Rule Form */}
        {showCreateRule && (
          <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #DDD6FE', padding: '24px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 20px' }}>Create Detection Rule</h3>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rule Name *</label>
                <input
                  value={newRule.name}
                  onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))}
                  placeholder="e.g. High EC2 Cost Alert"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric *</label>
                <select
                  value={newRule.metric}
                  onChange={e => setNewRule(r => ({ ...r, metric: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                  <option value="cost">Cost ($)</option>
                  <option value="cpu">CPU Utilization (%)</option>
                  <option value="memory">Memory Utilization (%)</option>
                  <option value="error_rate">Error Rate (%)</option>
                  <option value="invocations">Invocations</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Condition *</label>
                <select
                  value={newRule.condition}
                  onChange={e => setNewRule(r => ({ ...r, condition: e.target.value as CreateRulePayload['condition'] }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                  <option value="greater_than">Greater than</option>
                  <option value="less_than">Less than</option>
                  <option value="percent_change_up">% increase above</option>
                  <option value="percent_change_down">% decrease below</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Threshold *</label>
                <input
                  type="number"
                  value={newRule.threshold}
                  onChange={e => setNewRule(r => ({ ...r, threshold: parseFloat(e.target.value) || 0 }))}
                  placeholder="e.g. 500"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time Window</label>
                <select
                  value={newRule.timeWindow}
                  onChange={e => setNewRule(r => ({ ...r, timeWindow: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                  <option value="1h">Last 1 hour</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Severity</label>
                <select
                  value={newRule.severity}
                  onChange={e => setNewRule(r => ({ ...r, severity: e.target.value as CustomAnomalyRule['severity'] }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateRule(false)} style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateRule} disabled={rulesLoading} style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: rulesLoading ? '#A78BFA' : '#7C3AED', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: rulesLoading ? 'not-allowed' : 'pointer' }}>
                {rulesLoading ? 'Creating...' : 'Create Rule'}
              </button>
            </div>
          </div>
        )}

        {/* Rules List */}
        {rules.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '12px 18px', textAlign: 'center' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
              <Settings size={16} style={{ color: '#7C3AED' }} />
            </div>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No custom rules yet</p>
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 16px', lineHeight: 1.6 }}>No custom rules active — only default AI detection running. Add rules to detect issues specific to your infrastructure thresholds.</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', justifyContent: 'center' }}>
              {[
                'Detect unusual cost spikes',
                'Flag security misconfigurations',
                'Monitor abnormal traffic patterns',
              ].map(example => (
                <span key={example} style={{ fontSize: '0.7rem', color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: '6px', padding: '3px 8px', lineHeight: 1.4 }}>
                  {example}
                </span>
              ))}
            </div>
            <button onClick={() => setShowCreateRule(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#7C3AED', color: '#fff', padding: '9px 20px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              <Plus size={13} /> Create First Rule
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rules.map(rule => {
              const severityColor = rule.severity === 'critical' ? '#DC2626' : rule.severity === 'warning' ? '#D97706' : '#3B82F6'
              const severityBg    = rule.severity === 'critical' ? '#FEF2F2' : rule.severity === 'warning' ? '#FFFBEB' : '#EFF6FF'
              return (
                <div key={rule.id} style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${rule.enabled ? '#E2E8F0' : '#F1F5F9'}`, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: '16px', opacity: rule.enabled ? 1 : 0.6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0F172A' }}>{rule.name}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: severityBg, color: severityColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{rule.severity}</span>
                      {!rule.enabled && <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8' }}>Disabled</span>}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
                      {rule.metric} {rule.condition.replace(/_/g, ' ')} {rule.threshold} · {rule.timeWindow} window
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: rule.enabled ? '#7C3AED' : '#94A3B8', display: 'flex', alignItems: 'center', padding: '4px' }}
                      title={rule.enabled ? 'Disable rule' : 'Enable rule'}>
                      {rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      style={{ background: 'none', border: '1px solid #FECACA', borderRadius: '6px', padding: '5px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  );
}
