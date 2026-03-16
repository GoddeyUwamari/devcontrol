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
  const handleRunScan = (id: string) => handleExecuteScan(id);
  const handleViewDetails = (id: string) => {
    const real = frameworks.find((f) => f.id === id);
    if (real) {
      setDetailsFramework(real);
    } else {
      router.push(`/compliance/frameworks/${id}`);
    }
  };

  // ── KPI DERIVED VALUES ───────────────────────────────────────────────────
  const totalFrameworks  = isDemoActive ? 4 : displayFrameworks.length;
  const activeFrameworks = isDemoActive ? 4 : displayFrameworks.filter((f) => f.status !== 'failing').length;
  const customFrameworks = isDemoActive ? 0 : displayFrameworks.filter((f) => f.isCustom || f.framework_type === 'custom').length;
  const scansCompleted   = isDemoActive ? 12 : scans.filter((s) => s.status === 'completed').length;

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
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Compliance Frameworks
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Monitor CIS, SOC 2, NIST, and PCI-DSS compliance across your AWS infrastructure
          </p>
        </div>
        <button
          onClick={handleCreateFramework}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
        >
          <Plus size={15} /> New Framework
        </button>
      </div>

      {/* ── 4 KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Frameworks',  value: totalFrameworks,  sub: 'Configured',            valueColor: '#0F172A' },
          { label: 'Active Frameworks', value: activeFrameworks, sub: 'Passing or in progress', valueColor: '#059669' },
          { label: 'Custom Frameworks', value: customFrameworks, sub: 'User-defined rules',     valueColor: '#7C3AED' },
          { label: 'Scans Completed',   value: scansCompleted,  sub: 'Total scans run',        valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
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

      {/* ── ERROR — only in real data mode ── */}
      {displayError && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '14px 20px', marginBottom: '24px' }}>
          <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>{displayError}</p>
        </div>
      )}

      {/* ── FRAMEWORKS LIST ── */}
      {loading && !isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading frameworks...</p>
        </div>
      ) : displayFrameworks.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Shield size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No compliance frameworks yet</p>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
            Add CIS, SOC 2, NIST, or PCI-DSS frameworks to monitor your AWS infrastructure compliance.
          </p>
          <button
            onClick={handleCreateFramework}
            style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            + Create First Framework
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {displayFrameworks.map((f) => {
            const pct     = f.complianceScore ?? (f.enabled ? 80 : 40);
            const passing = f.status === 'passing'  || pct >= 80;
            const failing = f.status === 'failing'  || pct < 60;
            const statusColor = passing ? '#059669' : failing ? '#DC2626' : '#D97706';
            const statusBg    = passing ? '#F0FDF4'  : failing ? '#FEF2F2' : '#FFFBEB';
            const statusLabel = passing ? 'Passing'  : failing ? 'Failing' : 'In Progress';
            const isCustom    = f.isCustom || f.framework_type === 'custom';

            return (
              <div
                key={f.id}
                style={{ background: '#fff', borderRadius: '14px', padding: '24px 28px', border: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'center', transition: 'border-color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#F1F5F9'; }}
              >
                <div style={{ flex: 1 }}>
                  {/* Name + badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{f.name}</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: statusBg, color: statusColor }}>
                      {statusLabel}
                    </span>
                    {isCustom && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F5F3FF', color: '#7C3AED' }}>
                        Custom
                      </span>
                    )}
                    {f.is_default && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#EFF6FF', color: '#3B82F6' }}>
                        Default
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, height: '6px', background: '#F1F5F9', borderRadius: '100px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: statusColor, borderRadius: '100px', transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: statusColor, minWidth: '40px', textAlign: 'right' }}>{pct}%</span>
                  </div>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem', color: '#64748B' }}>
                    {f.rulesCount != null && <span>{f.rulesCount} rules</span>}
                    {f.standard_name && <span>{f.standard_name}{f.version ? ` ${f.version}` : ''}</span>}
                    {f.lastScanAt && <span>Last scan {new Date(f.lastScanAt).toLocaleString()}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleRunScan(f.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                  >
                    <RefreshCw size={12} /> Run Scan
                  </button>
                  <button
                    onClick={() => handleViewDetails(f.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#7C3AED', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, color: '#fff', cursor: 'pointer' }}
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
