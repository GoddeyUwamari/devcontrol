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
import { Shield, RefreshCw, Download, CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { usePlan } from '@/lib/hooks/use-plan';
import { demoModeService } from '@/lib/services/demo-mode.service';
import {
  complianceEngineService,
  ControlFramework,
  ControlResult,
  FrameworkScanResult,
} from '@/lib/services/compliance-engine.service';

// ─── Score Circle ─────────────────────────────────────────────────────────────

function ScoreCircle({ score, label, size = 120 }: { score: number; label: string; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;

  const color =
    score >= 80 ? '#059669' :
    score >= 60 ? '#D97706' :
    '#DC2626';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#F1F5F9"
            strokeWidth={10}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <span style={{ fontSize: size > 100 ? '1.6rem' : '1.1rem', fontWeight: 700, color, lineHeight: 1 }}>
            {score}%
          </span>
        </div>
      </div>
      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', textAlign: 'center' }}>{label}</span>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'pass') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px',
        borderRadius: '100px', background: '#F0FDF4', color: '#059669',
      }}>
        <CheckCircle2 size={11} /> PASS
      </span>
    );
  }
  if (status === 'not_applicable') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px',
        borderRadius: '100px', background: '#F8FAFC', color: '#64748B',
      }}>
        <MinusCircle size={11} /> N/A
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px',
      borderRadius: '100px', background: '#FEF2F2', color: '#DC2626',
    }}>
      <XCircle size={11} /> FAIL
    </span>
  );
}

// ─── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    critical: { bg: '#FEF2F2', color: '#DC2626' },
    high:     { bg: '#FFF7ED', color: '#C2410C' },
    medium:   { bg: '#FFFBEB', color: '#D97706' },
    low:      { bg: '#F0FDF4', color: '#059669' },
  };
  const style = map[severity] || map.low;
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px',
      borderRadius: '100px', background: style.bg, color: style.color,
      textTransform: 'uppercase',
    }}>
      {severity}
    </span>
  );
}

// ─── Control Row ──────────────────────────────────────────────────────────────

function ControlRow({ ctrl }: { ctrl: ControlResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', background: expanded ? '#FAFAFE' : '#fff' }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = '#F9FAFB'; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = '#fff'; }}
      >
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {expanded ? <ChevronDown size={14} style={{ color: '#94A3B8', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />}
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', fontFamily: 'monospace' }}>
              {ctrl.controlId}
            </span>
          </div>
        </td>
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>{ctrl.category}</span>
        </td>
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>{ctrl.name}</span>
        </td>
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <SeverityBadge severity={ctrl.severity} />
        </td>
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <StatusBadge status={ctrl.status} />
        </td>
        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, height: '5px', background: '#F1F5F9', borderRadius: '100px', minWidth: '60px' }}>
              <div style={{
                width: `${ctrl.score}%`, height: '100%', borderRadius: '100px',
                background: ctrl.score >= 80 ? '#059669' : ctrl.score >= 60 ? '#D97706' : '#DC2626',
                transition: 'width 0.5s ease',
              }} />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', minWidth: '34px', textAlign: 'right' }}>
              {ctrl.score}%
            </span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#F8FAFC' }}>
          <td colSpan={6} style={{ padding: '16px 24px 20px 48px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px' }}>
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                  Description
                </p>
                <p style={{ fontSize: '0.83rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{ctrl.description}</p>
                {ctrl.evidence?.details && (
                  <div style={{ marginTop: '12px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '10px 14px' }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>
                      Evidence
                    </p>
                    <p style={{ fontSize: '0.82rem', color: '#0F172A', margin: 0, lineHeight: 1.5 }}>{ctrl.evidence.details}</p>
                    {ctrl.evidence.totalResources != null && (
                      <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                        {ctrl.evidence.passingCount != null && (
                          <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                            ✓ {ctrl.evidence.passingCount} passing
                          </span>
                        )}
                        {ctrl.evidence.failingCount != null && ctrl.evidence.failingCount > 0 && (
                          <span style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600 }}>
                            ✗ {ctrl.evidence.failingCount} failing
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {ctrl.status === 'fail' && (
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                    Remediation Steps
                  </p>
                  <p style={{ fontSize: '0.83rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{ctrl.remediationGuidance}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Empty / Locked State ────────────────────────────────────────────────────

function LockedState() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  return (
    <div style={{
      background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '64px 40px',
      textAlign: 'center', border: '1px solid #F1F5F9',
    }}>
      <div style={{
        width: '56px', height: '56px', borderRadius: '16px',
        background: 'linear-gradient(135deg, #7C3AED20, #7C3AED10)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
      }}>
        <Shield size={26} style={{ color: '#7C3AED' }} />
      </div>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>
        Enterprise Feature
      </h3>
      <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 28px', lineHeight: 1.6, maxWidth: '420px', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}>
        Named-control SOC 2 Type II and HIPAA compliance scanning with PDF audit reports is available on the Enterprise plan.
      </p>
      <a
        href="/settings/billing?upgrade=enterprise"
        style={{
          display: 'inline-block', background: '#7C3AED', color: '#fff',
          padding: '11px 28px', borderRadius: '8px', fontSize: '0.875rem',
          fontWeight: 600, textDecoration: 'none',
        }}
      >
        Upgrade to Enterprise
      </a>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const { user } = useAuth();
  const { isEnterprise } = usePlan();

  const [activeFramework, setActiveFramework] = useState<ControlFramework>('soc2');
  const [soc2Result, setSoc2Result] = useState<FrameworkScanResult | null>(null);
  const [hipaaResult, setHipaaResult] = useState<FrameworkScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pass' | 'fail'>('all');

  const activeResult = activeFramework === 'soc2' ? soc2Result : hipaaResult;

  const fetchResults = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const results = await complianceEngineService.getAllResults();
      setSoc2Result(results.soc2);
      setHipaaResult(results.hipaa);
    } catch (err: any) {
      // 402 = enterprise required, 404/Not Found = no data yet — show empty state, not error
      const msg: string = err.message ?? '';
      const isSuppressed =
        msg.includes('402') || msg.includes('Subscription') ||
        msg.includes('404') || msg.toLowerCase().includes('not found');
      if (!isSuppressed) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handleRunScan = async () => {
    try {
      setScanning(true);
      setError(null);
      const results = await complianceEngineService.runAllScans();
      setSoc2Result(results.soc2);
      setHipaaResult(results.hipaa);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleDownloadReport = async () => {
    try {
      setDownloading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const url = complianceEngineService.getReportUrl(activeFramework);
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download report');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${activeFramework === 'soc2' ? 'SOC2' : 'HIPAA'}-compliance-report-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  // Filter controls
  const filteredControls = activeResult?.controlResults?.filter((ctrl) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pass') return ctrl.status === 'pass' || ctrl.status === 'not_applicable';
    return ctrl.status === 'fail';
  }) ?? [];

  // KPIs
  const totalControls = (soc2Result?.controlsTotal ?? 0) + (hipaaResult?.controlsTotal ?? 0);
  const totalPassed   = (soc2Result?.controlsPassed ?? 0) + (hipaaResult?.controlsPassed ?? 0);
  const totalFailed   = (soc2Result?.controlsFailed ?? 0) + (hipaaResult?.controlsFailed ?? 0);
  const combinedScore = totalControls > 0 ? Math.round((totalPassed / totalControls) * 100) : 0;

  const hasResults = soc2Result !== null || hipaaResult !== null;
  const isDemoActive = demoModeService.isEnabled();
  const displayError = isDemoActive ? null : error;

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
            Compliance Engine
          </p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            SOC 2 & HIPAA Compliance
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Named-control pass/fail audit reports — ready for your auditors.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {hasResults && (
            <button
              onClick={handleDownloadReport}
              disabled={downloading || !activeResult}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px',
                padding: '10px 18px', fontSize: '0.875rem', fontWeight: 600,
                color: '#475569', cursor: downloading ? 'not-allowed' : 'pointer',
                opacity: downloading ? 0.6 : 1,
              }}
            >
              <Download size={14} />
              {downloading ? 'Downloading…' : 'Download PDF'}
            </button>
          )}
          <button
            onClick={handleRunScan}
            disabled={scanning}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px',
              padding: '10px 20px', fontSize: '0.875rem', fontWeight: 600,
              cursor: scanning ? 'not-allowed' : 'pointer',
              opacity: scanning ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
            {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {displayError && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '24px',
        }}>
          <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>{displayError}</p>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading compliance data…</p>
        </div>
      )}

      {!loading && !hasResults && !displayError && (
        <div style={{ marginBottom: '28px' }}>
          {/* Show enterprise gated state or empty state */}
          <div style={{
            background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '56px 40px',
            textAlign: 'center', border: '1px solid #F1F5F9',
          }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: '16px',
              background: '#F5F3FF', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 20px',
            }}>
              <Shield size={26} style={{ color: '#7C3AED' }} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>
              No scans yet
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 28px', lineHeight: 1.6 }}>
              Run your first compliance scan to generate SOC 2 Type II and HIPAA control results.
            </p>
            <button
              onClick={handleRunScan}
              disabled={scanning}
              style={{
                background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px',
                padding: '11px 28px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {scanning ? 'Scanning…' : 'Run First Scan'}
            </button>
          </div>
        </div>
      )}

      {!loading && hasResults && (
        <>
          {/* ── KPI Row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            {[
              { label: 'Overall Score',     value: `${combinedScore}%`, sub: 'Weighted across both frameworks', color: combinedScore >= 80 ? '#059669' : combinedScore >= 60 ? '#D97706' : '#DC2626' },
              { label: 'Controls Passing',  value: totalPassed,  sub: 'Across SOC 2 + HIPAA', color: '#059669' },
              { label: 'Controls Failing',  value: totalFailed,  sub: 'Require remediation',  color: totalFailed > 0 ? '#DC2626' : '#059669' },
              { label: 'Total Controls',    value: totalControls, sub: '12 SOC 2 · 12 HIPAA',  color: '#0F172A' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '28px 32px', border: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>
                  {label}
                </p>
                <div style={{ fontSize: '2.25rem', fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '6px' }}>
                  {value}
                </div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* ── Score Circles + Framework Selector ── */}
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', padding: '32px 40px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Framework Overview</h2>
              {activeResult?.scannedAt && (
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0 }}>
                  Last scan: {new Date(activeResult.scannedAt).toLocaleString()}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '80px', flexWrap: 'wrap' }}>
              {/* SOC 2 */}
              <button
                onClick={() => setActiveFramework('soc2')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
                  background: activeFramework === 'soc2' ? '#F5F3FF' : 'transparent',
                  border: activeFramework === 'soc2' ? '2px solid #7C3AED' : '2px solid transparent',
                  borderRadius: '16px', padding: '24px 32px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <ScoreCircle score={soc2Result?.overallScore ?? 0} label="" size={140} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>SOC 2 Type II</p>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
                    {soc2Result?.controlsPassed ?? 0}/{soc2Result?.controlsTotal ?? 0} controls passing
                  </p>
                </div>
              </button>

              {/* Divider */}
              <div style={{ width: '1px', height: '120px', background: '#E2E8F0' }} />

              {/* HIPAA */}
              <button
                onClick={() => setActiveFramework('hipaa')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
                  background: activeFramework === 'hipaa' ? '#F5F3FF' : 'transparent',
                  border: activeFramework === 'hipaa' ? '2px solid #7C3AED' : '2px solid transparent',
                  borderRadius: '16px', padding: '24px 32px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <ScoreCircle score={hipaaResult?.overallScore ?? 0} label="" size={140} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>HIPAA Security Rule</p>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
                    {hipaaResult?.controlsPassed ?? 0}/{hipaaResult?.controlsTotal ?? 0} controls passing
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* ── Controls Table ── */}
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>
            {/* Table header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                  {activeFramework === 'soc2' ? 'SOC 2 Type II' : 'HIPAA Security Rule'} Controls
                </h2>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', background: '#F5F3FF', padding: '2px 8px', borderRadius: '100px' }}>
                  {activeResult?.controlsTotal ?? 0} controls
                </span>
              </div>
              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: '4px', background: '#F8FAFC', borderRadius: '8px', padding: '3px' }}>
                {(['all', 'pass', 'fail'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    style={{
                      padding: '5px 14px', borderRadius: '6px', border: 'none',
                      fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      background: filterStatus === f ? '#fff' : 'transparent',
                      color: filterStatus === f ? '#0F172A' : '#64748B',
                      boxShadow: filterStatus === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.1s',
                    }}
                  >
                    {f === 'all' ? `All (${activeResult?.controlsTotal ?? 0})` :
                     f === 'pass' ? `Pass (${activeResult?.controlsPassed ?? 0})` :
                     `Fail (${activeResult?.controlsFailed ?? 0})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                    {['Control ID', 'Category', 'Control Name', 'Severity', 'Status', 'Score'].map((h) => (
                      <th key={h} style={{
                        padding: '10px 16px', textAlign: 'left',
                        fontSize: '0.72rem', fontWeight: 700, color: '#475569',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredControls.map((ctrl, i) => (
                    <tr key={ctrl.id} style={{ borderBottom: i < filteredControls.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <ControlRow ctrl={ctrl} />
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ))}
                  {filteredControls.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94A3B8', fontSize: '0.875rem' }}>
                        No controls match the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
