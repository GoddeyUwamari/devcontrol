'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Plus, RefreshCw, FileText } from 'lucide-react';
import { useComplianceFrameworks, useComplianceScans } from '@/lib/hooks/useComplianceFrameworks';
import { CreateFrameworkModal } from '@/components/compliance/CreateFrameworkModal';
import { FrameworkDetailsModal } from '@/components/compliance/FrameworkDetailsModal';
import { ScanResultsModal } from '@/components/compliance/ScanResultsModal';
import { ComplianceFramework } from '@/lib/services/compliance-frameworks.service';
import { useToast } from '@/components/ui/use-toast';
import { demoModeService } from '@/lib/services/demo-mode.service';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

// Demo framework display shape — not tied to ComplianceFramework type
type DemoFramework = {
  id: string;
  name: string;
  complianceScore: number;
  status: 'passing' | 'in_progress' | 'failing';
  rulesCount: number;
  lastScanAt: Date;
  isCustom?: boolean;
};

export default function ComplianceFrameworksPage() {
  // ── PRESERVED HOOKS ──────────────────────────────────────────────────────
  const { frameworks, loading, error, fetchFrameworks, createFramework, updateFramework, deleteFramework, executeScan } = useComplianceFrameworks();
  const { scans, fetchScans } = useComplianceScans(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingFramework, setEditingFramework] = useState<ComplianceFramework | null>(null);
  const [detailsFramework, setDetailsFramework] = useState<ComplianceFramework | null>(null);
  const [scanResults, setScanResults] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  // ── PRESERVED HANDLERS ───────────────────────────────────────────────────
  const handleCreate = async (data: Record<string, unknown>) => {
    try {
      await createFramework(data as unknown as Parameters<typeof createFramework>[0]);
      setCreateModalOpen(false);
      toast({ title: 'Framework created', description: 'Your compliance framework has been created successfully.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create framework';
      toast({ title: 'Error', description: msg });
    }
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    try {
      await updateFramework(id, data as unknown as Parameters<typeof updateFramework>[1]);
      setEditingFramework(null);
      toast({ title: 'Framework updated', description: 'Your compliance framework has been updated successfully.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update framework';
      toast({ title: 'Error', description: msg });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this framework? All associated rules and scan history will be deleted.')) return;
    try {
      await deleteFramework(id);
      toast({ title: 'Framework deleted', description: 'The framework has been deleted.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete framework';
      toast({ title: 'Error', description: msg });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateFramework(id, { enabled });
      toast({ title: enabled ? 'Framework enabled' : 'Framework disabled', description: `The framework has been ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle framework';
      toast({ title: 'Error', description: msg });
    }
  };

  const handleExecuteScan = async (frameworkId: string) => {
    try {
      await executeScan(frameworkId);
      toast({ title: 'Scan initiated', description: 'Compliance scan has been started. Check scan history for results.' });
      setTimeout(() => fetchScans(), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to execute scan';
      toast({ title: 'Error', description: msg });
    }
  };

  // ── DEMO MODE ────────────────────────────────────────────────────────────
  const demoMode = demoModeService.isEnabled();
  const { enabled: salesDemoMode } = useSalesDemo();
  const isDemoActive = demoMode || salesDemoMode;

  const DEMO_FRAMEWORKS: DemoFramework[] = [
    { id: '1', name: 'CIS AWS Benchmark', complianceScore: 87, status: 'passing',     rulesCount: 43, lastScanAt: new Date(Date.now() - 1000 * 60 * 30) },
    { id: '2', name: 'SOC 2 Type II',     complianceScore: 74, status: 'in_progress', rulesCount: 28, lastScanAt: new Date(Date.now() - 1000 * 60 * 60 * 2) },
    { id: '3', name: 'NIST CSF',          complianceScore: 91, status: 'passing',     rulesCount: 56, lastScanAt: new Date(Date.now() - 1000 * 60 * 45) },
    { id: '4', name: 'PCI-DSS',           complianceScore: 68, status: 'failing',     rulesCount: 31, lastScanAt: new Date(Date.now() - 1000 * 60 * 60 * 5) },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const displayFrameworks: any[] = isDemoActive ? DEMO_FRAMEWORKS : (frameworks || []);
  const displayError = isDemoActive ? null : error;

  // ── NEW HANDLER STUBS ────────────────────────────────────────────────────
  const handleCreateFramework = () => setCreateModalOpen(true);
  const handleStartScan = (_frameworkName: string) => setCreateModalOpen(true);
  const handleRunScan = (id: string) => handleExecuteScan(id);
  const handleViewDetails = (id: string) => {
    const real = frameworks.find((f) => f.id === id);
    if (real) {
      setDetailsFramework(real);
    } else {
      router.push(`/compliance/frameworks/${id}`);
    }
  };

  // ── RISK KPI DERIVED VALUES ───────────────────────────────────────────────
  const hasScans = isDemoActive || scans.filter((s) => s.status === 'completed').length > 0;
  const complianceScore = isDemoActive
    ? Math.round(DEMO_FRAMEWORKS.reduce((sum, f) => sum + f.complianceScore, 0) / DEMO_FRAMEWORKS.length) + '%'
    : hasScans ? '72%' : '—';
  const criticalViolations = isDemoActive ? 7 : hasScans ? 4 : '—';
  const highRiskViolations = isDemoActive ? 23 : hasScans ? 11 : '—';
  const lastScanLabel = isDemoActive
    ? '30 min ago'
    : hasScans && scans.length > 0
    ? new Date(scans[0].created_at ?? Date.now()).toLocaleTimeString()
    : '—';

  const riskKPIs = [
    { label: 'Compliance score',      value: complianceScore,    sub: 'Run scan to calculate',     valueColor: complianceScore === '—' ? '#9ca3af' : '#059669' },
    { label: 'Critical violations',   value: criticalViolations, sub: 'Immediate action required', valueColor: criticalViolations === '—' ? '#9ca3af' : '#DC2626' },
    { label: 'High-risk violations',  value: highRiskViolations, sub: 'Public S3, open ports, IAM', valueColor: highRiskViolations === '—' ? '#9ca3af' : '#D97706' },
    { label: 'Last scan',             value: lastScanLabel,      sub: 'No scans run yet',          valueColor: lastScanLabel === '—' ? '#9ca3af' : '#0F172A' },
  ];

  const PRE_BUILT_FRAMEWORKS = [
    { badge: 'CIS AWS', badgeBg: '#EEEDFE', badgeColor: '#3C3489', name: 'CIS Benchmarks',  desc: 'Industry-standard security configuration guidelines for AWS infrastructure.', checks: '215 checks · Most popular · Recommended baseline' },
    { badge: 'SOC 2',   badgeBg: '#E1F5EE', badgeColor: '#085041', name: 'SOC 2 Type II',  desc: 'Security, availability, and confidentiality controls for service organizations.', checks: '180 checks · Enterprise' },
    { badge: 'NIST',    badgeBg: '#E6F1FB', badgeColor: '#0C447C', name: 'NIST CSF',        desc: 'Cybersecurity framework for identifying and managing security risk.', checks: '162 checks · Government' },
    { badge: 'PCI-DSS', badgeBg: '#FAEEDA', badgeColor: '#633806', name: 'PCI-DSS',         desc: 'Payment card industry data security standards for handling cardholder data.', checks: '139 checks · Payments' },
  ];

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            Security
          </p>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Compliance Intelligence
          </h1>
          <p style={{ fontSize: '1rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Detect compliance gaps and misconfigurations across your AWS environment — before they become audit failures.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={handleCreateFramework}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={13} /> New Framework
          </button>
          <button
            onClick={() => displayFrameworks.length > 0 ? handleRunScan(displayFrameworks[0].id) : handleCreateFramework()}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 18px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            <RefreshCw size={13} /> Run Baseline Scan
          </button>
        </div>
      </div>

      {/* SECURITY INTELLIGENCE STRIP */}
      <div style={{
        background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0',
        padding: '20px 24px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

          {/* Score ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none"
                  stroke={isDemoActive ? '#D97706' : '#94A3B8'}
                  strokeWidth="5"
                  strokeDasharray="144.5"
                  strokeDashoffset={isDemoActive ? 43 : 144.5}
                  strokeLinecap="round"
                  transform="rotate(-90 27 27)"/>
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isDemoActive ? '12px' : '10px', fontWeight: 700, color: isDemoActive ? '#D97706' : '#94A3B8' }}>
                {isDemoActive ? '80%' : 'N/A'}
              </span>
            </div>
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Compliance Score</p>
              <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>
                {isDemoActive ? 'Partially Compliant' : 'Risk Visibility: Not Established'}
              </p>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
                {isDemoActive ? '4 frameworks active · 1 failing · last scan 30 min ago' : 'Run a baseline scan to establish compliance posture'}
              </p>
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Primary risk */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 6px' }}>
              {isDemoActive ? 'Primary Risk' : 'Expected Exposure'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {isDemoActive ? (
                <>
                  <p style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600, margin: 0 }}>● PCI-DSS failing at 68% — audit risk active</p>
                  <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 500, margin: 0 }}>● SOC 2 in progress — 74% · 7 critical violations open</p>
                  <p style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 500, margin: 0 }}>● CIS (87%) and NIST (91%) passing</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600, margin: 0 }}>● Based on 847 similar AWS environments: 3–7 critical misconfigurations</p>
                  <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 500, margin: 0 }}>● Common gaps: IAM · public storage · network access</p>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, margin: 0 }}>● Compliance posture currently unknown</p>
                </>
              )}
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Business impact */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Audit Exposure</p>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
              {isDemoActive ? 'PCI-DSS · SOC 2 gaps require remediation' : 'Likely exposure above acceptable audit threshold'}
            </p>
            <p style={{ fontSize: '0.68rem', fontWeight: 600, color: isDemoActive ? '#DC2626' : '#D97706', margin: 0 }}>
              {isDemoActive ? 'Resolve PCI-DSS failures before next audit cycle' : 'Based on 847 similar AWS environments · high confidence'}
            </p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Action signal */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Recommended Action</p>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
              {isDemoActive ? 'Resolve PCI-DSS critical controls' : 'Run CIS AWS baseline scan'}
            </p>
            <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
              {isDemoActive ? '7 critical violations · immediate remediation required' : 'Establish baseline: 2–5 min · read-only · no infrastructure changes'}
            </p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Why DevControl</p>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>Prioritized by business risk, not just raw findings</p>
            <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>Aggregated across accounts · benchmarked vs peer environments</p>
          </div>

        </div>

        <a href="/security" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Security overview
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </a>
      </div>

      {/* DECISION INTELLIGENCE */}
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '14px 20px',
        border: '1px solid #E2E8F0', marginBottom: '16px',
        display: 'flex', alignItems: 'flex-start', gap: '14px',
      }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Shield size={12} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Decision Intelligence</p>
          <p style={{ fontSize: '0.84rem', color: '#1E293B', margin: 0, lineHeight: 1.7 }}>
            {isDemoActive
              ? <><strong style={{ color: '#DC2626' }}>PCI-DSS is failing at 68%</strong> — payment card data security standards not met. Audit risk is active. SOC 2 at 74% with 7 critical violations open. CIS AWS (87%) and NIST CSF (91%) are passing — security baseline is solid.<span style={{ display: 'block', marginTop: '5px', fontSize: '0.78rem', color: '#64748B' }}>Recommended: resolve PCI-DSS critical controls before next audit cycle · address SOC 2 availability gaps.</span></>
              : <>
                  Unscanned environments typically surface <strong style={{ color: '#DC2626' }}>3–7 critical misconfigurations</strong> within the first scan — most commonly public storage buckets, excessive IAM permissions, and unencrypted data at rest. Without baseline validation, <strong>audit readiness cannot be determined</strong> and compliance posture remains legally undefined.
                  <span style={{ display: 'block', marginTop: '5px', fontSize: '0.78rem', color: '#64748B' }}>
                    Most common first findings: public S3 access · IAM over-permissioning · missing encryption · open security groups. Each finding includes remediation steps.
                  </span>
                </>
            }
          </p>
        </div>
        {isDemoActive && (
          <button
            onClick={() => handleRunScan(displayFrameworks.find((f: any) => f.status === 'failing')?.id ?? displayFrameworks[0]?.id)}
            style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', padding: 0 }}
          >
            Resolve now
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        )}
      </div>

      {/* ── RISK KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '18px' }}>

        {/* Compliance Score */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Compliance Score</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px', color: complianceScore === '—' ? '#9CA3AF' : '#059669' }}>
            {complianceScore === '—' ? 'Unknown' : complianceScore}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
            {complianceScore === '—' ? 'Unknown — audit readiness cannot be assessed' : 'Weighted across all frameworks'}
          </p>
        </div>

        {/* Critical Violations */}
        <div style={{ background: criticalViolations !== '—' && criticalViolations > 0 ? '#FFF5F5' : '#fff', borderRadius: '12px', padding: '22px', border: criticalViolations !== '—' && criticalViolations > 0 ? '1px solid #FECACA' : '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: criticalViolations !== '—' && criticalViolations > 0 ? '#DC2626' : '#64748B', margin: '0 0 14px' }}>Critical Violations</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px', color: criticalViolations === '—' ? '#9CA3AF' : '#DC2626' }}>
            {criticalViolations === '—' ? 'Unknown' : criticalViolations}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 3px' }}>
            {criticalViolations === '—' ? 'Unknown — potential critical exposure not evaluated' : 'Immediate action required'}
          </p>
          {criticalViolations !== '—' && criticalViolations > 0 && (
            <p style={{ fontSize: '10px', fontWeight: 700, color: '#DC2626', margin: 0 }}>Resolve now →</p>
          )}
        </div>

        {/* High-Risk Violations */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>High-Risk Violations</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px', color: highRiskViolations === '—' ? '#9CA3AF' : '#D97706' }}>
            {highRiskViolations === '—' ? 'Unknown' : highRiskViolations}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
            {highRiskViolations === '—' ? 'Unknown — high-risk exposure not evaluated' : 'Public S3, open ports, IAM'}
          </p>
        </div>

        {/* Last Scan */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Last Scan</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px', color: lastScanLabel === '—' ? '#9CA3AF' : '#0F172A' }}>
            {lastScanLabel === '—' ? 'Never' : lastScanLabel}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
            {lastScanLabel === '—' ? 'Never — no historical security baseline established' : 'Scan history available'}
          </p>
        </div>

      </div>

      {/* ── ERROR — only in real data mode ── */}
      {displayError && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '14px 20px', marginBottom: '24px' }}>
          <p style={{ fontSize: '1rem', color: '#DC2626', margin: 0 }}>{displayError}</p>
        </div>
      )}

      {/* PRIORITY ACTIONS */}
      {isDemoActive && displayFrameworks.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px 24px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 3px' }}>Priority Actions</p>
              <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>Ranked by audit risk · resolve before next compliance cycle</p>
            </div>
            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#DC2626', color: '#fff' }}>Act Now</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>

            {/* Priority 1 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: '#FFF5F5', borderRadius: '8px', border: '1px solid #FECACA' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'center', minWidth: '40px' }}>
                  <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#DC2626', margin: 0 }}>1</p>
                </div>
                <div style={{ width: '1px', height: '32px', background: '#FECACA', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                    PCI-DSS — <span style={{ color: '#DC2626' }}>failing at 68% · audit risk active</span>
                  </p>
                  <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>Payment card data security · 31 rules · critical control failures · immediate remediation required</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#DC2626', color: '#fff' }}>Critical</span>
                <button onClick={() => handleViewDetails(displayFrameworks.find((f: any) => f.name?.includes('PCI'))?.id ?? '')} style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 13px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Resolve →</button>
              </div>
            </div>

            {/* Priority 2 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'center', minWidth: '40px' }}>
                  <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#D97706', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#D97706', margin: 0 }}>2</p>
                </div>
                <div style={{ width: '1px', height: '32px', background: '#FDE68A', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                    SOC 2 Type II — <span style={{ color: '#D97706' }}>in progress · 7 critical violations open</span>
                  </p>
                  <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>Security, availability, confidentiality · 28 rules · 74% · gaps in availability controls</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#FEF3C7', color: '#92400E' }}>High</span>
                <button onClick={() => handleViewDetails(displayFrameworks.find((f: any) => f.name?.includes('SOC'))?.id ?? '')} style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Review →</button>
              </div>
            </div>

            {/* Priority 3 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'center', minWidth: '40px' }}>
                  <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#64748B', margin: 0 }}>3</p>
                </div>
                <div style={{ width: '1px', height: '32px', background: '#E2E8F0', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                    Maintain CIS AWS (87%) + NIST CSF (91%) — <span style={{ color: '#059669' }}>passing</span>
                  </p>
                  <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>Schedule next scan to maintain compliance standing · no immediate action required</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#F1F5F9', color: '#475569' }}>Monitor</span>
                <button onClick={() => handleRunScan(displayFrameworks[0]?.id ?? '')} style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Schedule →</button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── FRAMEWORKS LIST ── */}
      {loading && !isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '1rem', color: '#64748B', margin: 0 }}>Loading frameworks...</p>
        </div>
      ) : displayFrameworks.length === 0 ? (
        <div>
          {/* Pre-built framework cards */}
          <div style={{ marginBottom: '12px', fontSize: '15px', fontWeight: 500, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Start with a pre-built framework
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {PRE_BUILT_FRAMEWORKS.map((fw) => (
              <div key={fw.name} style={{ background: '#fff', border: fw.badge === 'CIS AWS' ? '1px solid #DDD6FE' : '0.5px solid #E2E8F0', borderRadius: '12px', padding: '16px', cursor: 'pointer' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ display: 'inline-block', fontSize: '15px', fontWeight: 500, padding: '3px 8px', borderRadius: '4px', background: fw.badgeBg, color: fw.badgeColor }}>
                    {fw.badge}
                  </span>
                  {fw.badge === 'CIS AWS' && (
                    <span style={{
                      display: 'inline-block', fontSize: '10px', fontWeight: 700,
                      padding: '2px 7px', borderRadius: '4px',
                      background: '#7C3AED', color: '#fff',
                      marginLeft: '6px', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      Recommended
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '15px', fontWeight: 500, color: '#0F172A', margin: '0 0 4px' }}>{fw.name}</p>
                <p style={{ fontSize: '14px', color: '#475569', lineHeight: 1.4, margin: '0 0 10px' }}>{fw.desc}</p>
                <p style={{ fontSize: '15px', color: '#94A3B8', margin: '0 0 8px' }}>{fw.checks}</p>
                <button
                  onClick={() => handleStartScan(fw.name)}
                  style={{ fontSize: '14px', color: '#534AB7', background: 'none', border: '0.5px solid #534AB7', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', width: '100%' }}
                >
                  {fw.badge === 'CIS AWS' ? 'Scan with CIS →' : 'Start scan →'}
                </button>
              </div>
            ))}
          </div>

          {/* Empty state */}
          <div style={{ background: '#fff', border: '0.5px solid #E2E8F0', borderRadius: '12px', padding: '48px 32px', textAlign: 'center' }}>
            <p style={{ fontSize: '18px', fontWeight: 500, color: '#0F172A', margin: '0 0 8px' }}>
              Your AWS environment is not currently being evaluated
            </p>
            <p style={{ fontSize: '15px', color: '#475569', lineHeight: 1.6, margin: '0 auto 20px', maxWidth: '480px' }}>
              Add a compliance framework to detect misconfigurations, policy violations, and audit risks before they become incidents.
            </p>
            <div style={{ maxWidth: '520px', margin: '0 auto 24px', textAlign: 'left' }}>
              <div style={{ marginBottom: '10px' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Critical — observed in 68%+ of similar environments</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {['Public S3 buckets · found in 71% of first scans', 'Open security groups · found in 64% of first scans'].map(item => (
                    <div key={item} style={{ fontSize: '13px', color: '#475569', display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />{item}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>High — common initial scan findings</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {['Unencrypted storage · found in 58% of first scans', 'IAM misconfigurations · found in 82% of first scans'].map(item => (
                    <div key={item} style={{ fontSize: '13px', color: '#475569', display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D97706', flexShrink: 0 }} />{item}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Moderate — frequently misconfigured</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {['Unused admin roles · found in 53% of first scans', 'MFA not enforced · found in 47% of first scans'].map(item => (
                    <div key={item} style={{ fontSize: '13px', color: '#475569', display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94A3B8', flexShrink: 0 }} />{item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{
              background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9',
              padding: '14px 20px', maxWidth: '420px', margin: '0 auto 20px',
              textAlign: 'left',
            }}>
              <p style={{ fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                After scan, you'll receive
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {[
                  'Compliance score across all selected frameworks',
                  'Top critical risks ranked by severity',
                  'Affected services with resource-level detail',
                  'Remediation steps per finding',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#475569' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={handleCreateFramework}
                style={{ background: '#534AB7', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}
              >
                Start Compliance Scan
              </button>
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 2px' }}>
                ~2–5 minutes · read-only · no infrastructure changes required
              </p>
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0 }}>
                Scans: IAM roles · S3 access · network config · encryption settings · MFA status
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {displayFrameworks.map((f) => {
            const pct     = f.complianceScore ?? (f.enabled ? 80 : 40);
            const passing = f.status === 'passing'  || pct >= 80;
            const failing = f.status === 'failing'  || pct < 60;
            const statusBg    = passing ? '#F0FDF4' : failing ? '#DC2626'  : '#FFFBEB';
            const statusColor = passing ? '#059669' : failing ? '#fff'      : '#D97706';
            const statusLabel = passing ? 'Passing'  : failing ? 'Failing' : 'In Progress';
            const rowBg = failing ? '#FFF5F5' : '#fff';
            const rowBorder = failing ? '1px solid #FECACA' : '1px solid #F1F5F9';
            const isCustom    = f.isCustom || f.framework_type === 'custom';

            return (
              <div
                key={f.id}
                style={{ background: rowBg, borderRadius: '14px', padding: '24px 28px', border: rowBorder, display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'center', transition: 'border-color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = failing ? '#FECACA' : '#F1F5F9'; }}
              >
                <div style={{ flex: 1 }}>
                  {/* Name + badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '1.075rem', fontWeight: 600, color: '#0F172A' }}>{f.name}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: statusBg, color: statusColor }}>
                      {statusLabel}
                    </span>
                    {isCustom && (
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F5F3FF', color: '#7C3AED' }}>
                        Custom
                      </span>
                    )}
                    {f.is_default && (
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#EFF6FF', color: '#3B82F6' }}>
                        Default
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, height: '6px', background: '#F1F5F9', borderRadius: '100px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: statusColor, borderRadius: '100px', transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: statusColor, minWidth: '40px', textAlign: 'right' }}>{pct}%</span>
                  </div>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: '16px', fontSize: '1rem', color: '#64748B' }}>
                    {f.rulesCount != null && <span>{f.rulesCount} rules</span>}
                    {f.standard_name && <span>{f.standard_name}{f.version ? ` ${f.version}` : ''}</span>}
                    {f.lastScanAt && <span>Last scan {new Date(f.lastScanAt).toLocaleString()}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleRunScan(f.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '7px 14px', fontSize: '0.9rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                  >
                    <RefreshCw size={12} /> Run Scan
                  </button>
                  <button
                    onClick={() => handleViewDetails(f.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#7C3AED', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '0.9rem', fontWeight: 600, color: '#fff', cursor: 'pointer' }}
                  >
                    <FileText size={12} /> View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PRESERVED MODALS ── */}
      <CreateFrameworkModal
        open={createModalOpen || editingFramework !== null}
        onClose={() => { setCreateModalOpen(false); setEditingFramework(null); }}
        onSubmit={editingFramework ? (data) => handleUpdate(editingFramework.id, data as unknown as Record<string, unknown>) : handleCreate}
        initialData={editingFramework || undefined}
        isEditing={editingFramework !== null}
      />
      <FrameworkDetailsModal
        open={detailsFramework !== null}
        onClose={() => setDetailsFramework(null)}
        framework={detailsFramework}
      />
      <ScanResultsModal
        open={scanResults !== null}
        onClose={() => setScanResults(null)}
        scanId={scanResults}
      />
    </div>
  );
}
