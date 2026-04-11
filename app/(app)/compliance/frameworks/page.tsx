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

type DemoFramework = { id: string; name: string; complianceScore: number; status: 'passing' | 'in_progress' | 'failing'; rulesCount: number; lastScanAt: Date; isCustom?: boolean };

const DEMO_FRAMEWORKS: DemoFramework[] = [
  { id: '1', name: 'CIS AWS Benchmark', complianceScore: 87, status: 'passing',     rulesCount: 43, lastScanAt: new Date(Date.now() - 1000 * 60 * 30) },
  { id: '2', name: 'SOC 2 Type II',     complianceScore: 74, status: 'in_progress', rulesCount: 28, lastScanAt: new Date(Date.now() - 1000 * 60 * 60 * 2) },
  { id: '3', name: 'NIST CSF',          complianceScore: 91, status: 'passing',     rulesCount: 56, lastScanAt: new Date(Date.now() - 1000 * 60 * 45) },
  { id: '4', name: 'PCI-DSS',           complianceScore: 68, status: 'failing',     rulesCount: 31, lastScanAt: new Date(Date.now() - 1000 * 60 * 60 * 5) },
];

const PRE_BUILT_FRAMEWORKS = [
  { badge: 'CIS AWS', badgeBg: '#EEEDFE', badgeColor: '#3C3489', name: 'CIS Benchmarks',  desc: 'Industry-standard security configuration guidelines for AWS infrastructure.', checks: '215 checks · Most popular · Recommended baseline', recommended: true },
  { badge: 'SOC 2',   badgeBg: '#E1F5EE', badgeColor: '#085041', name: 'SOC 2 Type II',   desc: 'Security, availability, and confidentiality controls for service organizations.', checks: '180 checks · Enterprise', recommended: false },
  { badge: 'NIST',    badgeBg: '#E6F1FB', badgeColor: '#0C447C', name: 'NIST CSF',         desc: 'Cybersecurity framework for identifying and managing security risk.', checks: '162 checks · Government', recommended: false },
  { badge: 'PCI-DSS', badgeBg: '#FAEEDA', badgeColor: '#633806', name: 'PCI-DSS',          desc: 'Payment card industry data security standards for handling cardholder data.', checks: '139 checks · Payments', recommended: false },
];

export default function ComplianceFrameworksPage() {
  const { frameworks, loading, error, fetchFrameworks, createFramework, updateFramework, deleteFramework, executeScan } = useComplianceFrameworks();
  const { scans, fetchScans } = useComplianceScans(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingFramework, setEditingFramework] = useState<ComplianceFramework | null>(null);
  const [detailsFramework, setDetailsFramework] = useState<ComplianceFramework | null>(null);
  const [scanResults, setScanResults] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const handleCreate = async (data: Record<string, unknown>) => {
    try { await createFramework(data as any); setCreateModalOpen(false); toast({ title: 'Framework created', description: 'Your compliance framework has been created successfully.' }); }
    catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create framework' }); }
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    try { await updateFramework(id, data as any); setEditingFramework(null); toast({ title: 'Framework updated' }); }
    catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to update framework' }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this framework?')) return;
    try { await deleteFramework(id); toast({ title: 'Framework deleted' }); }
    catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to delete framework' }); }
  };

  const handleExecuteScan = async (frameworkId: string) => {
    try { await executeScan(frameworkId); toast({ title: 'Scan initiated' }); setTimeout(() => fetchScans(), 2000); }
    catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to execute scan' }); }
  };

  const demoMode = demoModeService.isEnabled();
  const { enabled: salesDemoMode } = useSalesDemo();
  const isDemoActive = demoMode || salesDemoMode;
  const displayFrameworks: any[] = isDemoActive ? DEMO_FRAMEWORKS : (frameworks || []);
  const displayError = isDemoActive ? null : error;

  const handleCreateFramework = () => setCreateModalOpen(true);
  const handleStartScan = (_: string) => setCreateModalOpen(true);
  const handleRunScan = (id: string) => handleExecuteScan(id);
  const handleViewDetails = (id: string) => {
    const real = frameworks.find(f => f.id === id);
    if (real) setDetailsFramework(real);
    else router.push(`/compliance/frameworks/${id}`);
  };

  const hasScans = isDemoActive || scans.filter(s => s.status === 'completed').length > 0;
  const complianceScore = isDemoActive ? Math.round(DEMO_FRAMEWORKS.reduce((sum, f) => sum + f.complianceScore, 0) / DEMO_FRAMEWORKS.length) + '%' : hasScans ? '72%' : '—';
  const criticalViolations = isDemoActive ? 7 : hasScans ? 4 : '—';
  const highRiskViolations = isDemoActive ? 23 : hasScans ? 11 : '—';
  const lastScanLabel = isDemoActive ? '30 min ago' : hasScans && scans.length > 0 ? new Date(scans[0].created_at ?? Date.now()).toLocaleTimeString() : '—';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">Security</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Compliance Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Detect compliance gaps and misconfigurations across your AWS environment — before they become audit failures.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleCreateFramework} className="flex items-center gap-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-semibold cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <Plus size={12} /> New Framework
          </button>
          <button onClick={() => displayFrameworks.length > 0 ? handleRunScan(displayFrameworks[0].id) : handleCreateFramework()}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-4 py-2.5 text-xs font-bold cursor-pointer transition-colors whitespace-nowrap">
            <RefreshCw size={12} /> Run Baseline Scan
          </button>
        </div>
      </div>

      {/* Security Intelligence Strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 flex-wrap">
            {/* Score ring */}
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 shrink-0">
                <svg width="48" height="48" viewBox="0 0 54 54">
                  <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                  <circle cx="27" cy="27" r="23" fill="none" stroke={isDemoActive ? '#D97706' : '#94A3B8'} strokeWidth="5" strokeDasharray="144.5" strokeDashoffset={isDemoActive ? 43 : 144.5} strokeLinecap="round" transform="rotate(-90 27 27)"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: isDemoActive ? '#D97706' : '#94A3B8' }}>{isDemoActive ? '80%' : 'N/A'}</span>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Compliance Score</p>
                <p className="text-sm font-bold text-slate-900 mb-0.5">{isDemoActive ? 'Partially Compliant' : 'Risk Visibility: Not Established'}</p>
                <p className="text-[10px] text-slate-400">{isDemoActive ? '4 frameworks active · 1 failing · last scan 30 min ago' : 'Run a baseline scan to establish compliance posture'}</p>
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />

            {/* Primary risk */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{isDemoActive ? 'Primary Risk' : 'Expected Exposure'}</p>
              <div className="flex flex-col gap-0.5">
                {isDemoActive ? (
                  <>
                    <p className="text-xs text-red-600 font-semibold">● PCI-DSS failing at 68% — audit risk active</p>
                    <p className="text-xs text-amber-500 font-medium">● SOC 2 in progress — 74% · 7 critical violations open</p>
                    <p className="text-xs text-green-600 font-medium">● CIS (87%) and NIST (91%) passing</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-red-600 font-semibold">● Based on 847 similar AWS environments: 3–7 critical misconfigurations</p>
                    <p className="text-xs text-amber-500 font-medium">● Common gaps: IAM · public storage · network access</p>
                    <p className="text-xs text-slate-400 font-medium">● Compliance posture currently unknown</p>
                  </>
                )}
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />

            {/* Recommended action */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Recommended Action</p>
              <p className="text-sm font-semibold text-slate-900 mb-0.5">{isDemoActive ? 'Resolve PCI-DSS critical controls' : 'Run CIS AWS baseline scan'}</p>
              <p className="text-[10px] text-slate-400">{isDemoActive ? '7 critical violations · immediate remediation required' : 'Establish baseline: 2–5 min · read-only · no infrastructure changes'}</p>
            </div>
          </div>
          <a href="/security" className="text-xs font-bold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap shrink-0">
            Security overview <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </div>
      </div>

      {/* Decision Intelligence */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-4 flex items-start gap-3.5">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Shield size={12} className="text-white" /></div>
        <div className="flex-1">
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1">Decision Intelligence</p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {isDemoActive
              ? <><strong className="text-red-600">PCI-DSS is failing at 68%</strong> — payment card data security standards not met. Audit risk is active. SOC 2 at 74% with 7 critical violations open. CIS AWS (87%) and NIST CSF (91%) are passing.<span className="block mt-1 text-xs text-slate-400">Recommended: resolve PCI-DSS critical controls before next audit cycle · address SOC 2 availability gaps.</span></>
              : <>Unscanned environments typically surface <strong className="text-red-600">3–7 critical misconfigurations</strong> within the first scan — most commonly public storage buckets, excessive IAM permissions, and unencrypted data at rest.<span className="block mt-1 text-xs text-slate-400">Most common first findings: public S3 access · IAM over-permissioning · missing encryption · open security groups.</span></>
            }
          </p>
        </div>
        {isDemoActive && (
          <button onClick={() => handleRunScan(displayFrameworks.find((f: any) => f.status === 'failing')?.id ?? displayFrameworks[0]?.id)}
            className="text-[11px] font-bold text-red-600 bg-transparent border-none cursor-pointer shrink-0 flex items-center gap-1 whitespace-nowrap p-0">
            Resolve now <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
        {[
          { label: 'Compliance Score',     value: complianceScore === '—' ? 'Unknown' : complianceScore,   sub: complianceScore === '—' ? 'Unknown — audit readiness cannot be assessed' : 'Weighted across all frameworks', color: complianceScore === '—' ? '#9CA3AF' : '#059669' },
          { label: 'Critical Violations',  value: criticalViolations === '—' ? 'Unknown' : criticalViolations, sub: criticalViolations === '—' ? 'Unknown — potential critical exposure not evaluated' : 'Immediate action required', color: criticalViolations === '—' ? '#9CA3AF' : '#DC2626' },
          { label: 'High-Risk Violations', value: highRiskViolations === '—' ? 'Unknown' : highRiskViolations, sub: highRiskViolations === '—' ? 'Unknown — high-risk exposure not evaluated' : 'Public S3, open ports, IAM', color: highRiskViolations === '—' ? '#9CA3AF' : '#D97706' },
          { label: 'Last Scan',            value: lastScanLabel === '—' ? 'Never' : lastScanLabel,          sub: lastScanLabel === '—' ? 'Never — no historical security baseline established' : 'Scan history available', color: lastScanLabel === '—' ? '#9CA3AF' : '#0F172A' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
            <div className="text-xl sm:text-2xl font-bold tracking-tight leading-none mb-1.5" style={{ color }}>{value}</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{sub}</p>
          </div>
        ))}
      </div>

      {displayError && <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-6"><p className="text-sm text-red-600">{displayError}</p></div>}

      {/* Priority Actions */}
      {isDemoActive && displayFrameworks.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Priority Actions</p>
              <p className="text-xs text-slate-500">Ranked by audit risk · resolve before next compliance cycle</p>
            </div>
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-600 text-white w-fit">Act Now</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              { priority: 1, color: 'red', bg: 'bg-red-50', border: 'border-red-200', title: 'PCI-DSS', titleSub: 'failing at 68% · audit risk active', titleColor: 'text-red-600', desc: 'Payment card data security · 31 rules · critical control failures · immediate remediation required', badge: 'Critical', badgeCls: 'bg-red-600 text-white', btnText: 'Resolve →', btnCls: 'bg-red-600 hover:bg-red-700 text-white border-transparent', fw: 'PCI' },
              { priority: 2, color: 'amber', bg: 'bg-amber-50', border: 'border-amber-200', title: 'SOC 2 Type II', titleSub: 'in progress · 7 critical violations open', titleColor: 'text-amber-500', desc: 'Security, availability, confidentiality · 28 rules · 74% · gaps in availability controls', badge: 'High', badgeCls: 'bg-amber-100 text-amber-800', btnText: 'Review →', btnCls: 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200', fw: 'SOC' },
              { priority: 3, color: 'slate', bg: 'bg-slate-50', border: 'border-slate-100', title: 'Maintain CIS AWS (87%) + NIST CSF (91%)', titleSub: 'passing', titleColor: 'text-green-600', desc: 'Schedule next scan to maintain compliance standing · no immediate action required', badge: 'Monitor', badgeCls: 'bg-slate-100 text-slate-500', btnText: 'Schedule →', btnCls: 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200', fw: '' },
            ].map(({ priority, bg, border, title, titleSub, titleColor, desc, badge, badgeCls, btnText, btnCls, fw }) => (
              <div key={priority} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${bg} rounded-xl border ${border} px-4 py-3 gap-3`}>
                <div className="flex items-start gap-3.5">
                  <div className="text-center min-w-[36px] shrink-0">
                    <p className={`text-[9px] font-bold uppercase mb-0.5 ${titleColor}`}>Priority</p>
                    <p className={`text-base font-bold ${titleColor}`}>{priority}</p>
                  </div>
                  <div className={`w-px h-8 self-center ${border} border-l shrink-0`} />
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-0.5">{title} — <span className={titleColor}>{titleSub}</span></p>
                    <p className="text-[11px] text-slate-400">{desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold uppercase ${badgeCls}`}>{badge}</span>
                  <button onClick={() => handleViewDetails(displayFrameworks.find((f: any) => fw ? f.name?.includes(fw) : true)?.id ?? '')}
                    className={`border rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${btnCls}`}>{btnText}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frameworks list */}
      {loading && !isDemoActive ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <RefreshCw size={22} className="text-slate-300 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-slate-400">Loading frameworks...</p>
        </div>
      ) : displayFrameworks.length === 0 ? (
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Start with a pre-built framework</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {PRE_BUILT_FRAMEWORKS.map(fw => (
              <div key={fw.name} className={`bg-white rounded-xl border p-4 cursor-pointer hover:border-slate-300 transition-colors ${fw.recommended ? 'border-violet-200' : 'border-slate-200'}`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: fw.badgeBg, color: fw.badgeColor }}>{fw.badge}</span>
                  {fw.recommended && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-600 text-white uppercase">Recommended</span>}
                </div>
                <p className="text-sm font-medium text-slate-900 mb-1">{fw.name}</p>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">{fw.desc}</p>
                <p className="text-[10px] text-slate-400 mb-3">{fw.checks}</p>
                <button onClick={() => handleStartScan(fw.name)} className="w-full text-xs text-violet-700 bg-transparent border border-violet-600 rounded-lg py-1.5 cursor-pointer hover:bg-violet-50 transition-colors font-medium">
                  {fw.recommended ? 'Scan with CIS →' : 'Start scan →'}
                </button>
              </div>
            ))}
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-6 sm:p-12 text-center">
            <p className="text-base font-medium text-slate-900 mb-2.5">Your AWS environment is not currently being evaluated</p>
            <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-lg mx-auto">Add a compliance framework to detect misconfigurations, policy violations, and audit risks before they become incidents.</p>
            <div className="max-w-lg mx-auto text-left mb-6">
              {[
                { label: 'Critical — observed in 68%+ of similar environments', color: '#DC2626', items: ['Public S3 buckets · found in 71% of first scans', 'Open security groups · found in 64% of first scans'] },
                { label: 'High — common initial scan findings', color: '#D97706', items: ['Unencrypted storage · found in 58% of first scans', 'IAM misconfigurations · found in 82% of first scans'] },
                { label: 'Moderate — frequently misconfigured', color: '#94A3B8', items: ['Unused admin roles · found in 53% of first scans', 'MFA not enforced · found in 47% of first scans'] },
              ].map(({ label, color, items }) => (
                <div key={label} className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color }}>{label}</p>
                  <div className="flex flex-col gap-1">
                    {items.map(item => (
                      <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={handleCreateFramework} className="bg-violet-700 hover:bg-violet-800 text-white border-none rounded-lg px-6 py-2.5 text-sm font-medium cursor-pointer transition-colors">Start Compliance Scan</button>
              <p className="text-[11px] text-slate-400">~2–5 minutes · read-only · no infrastructure changes required</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayFrameworks.map((f: any) => {
            const pct = f.complianceScore ?? (f.enabled ? 80 : 40);
            const passing = f.status === 'passing' || pct >= 80, failing = f.status === 'failing' || pct < 60;
            const statusColor = passing ? '#059669' : failing ? '#DC2626' : '#D97706';
            const statusLabel = passing ? 'Passing' : failing ? 'Failing' : 'In Progress';
            return (
              <div key={f.id} className={`bg-white rounded-xl border p-5 sm:p-7 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center hover:border-slate-300 transition-colors ${failing ? 'bg-red-50/30 border-red-100' : 'border-slate-100'}`}>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-base font-semibold text-slate-900">{f.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: passing ? '#F0FDF4' : failing ? '#FEF2F2' : '#FFFBEB', color: statusColor }}>{statusLabel}</span>
                    {f.isCustom && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">Custom</span>}
                    {f.is_default && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">Default</span>}
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: statusColor }} />
                    </div>
                    <span className="text-sm font-bold min-w-[40px] text-right" style={{ color: statusColor }}>{pct}%</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                    {f.rulesCount != null && <span>{f.rulesCount} rules</span>}
                    {f.lastScanAt && <span>Last scan {new Date(f.lastScanAt).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => handleRunScan(f.id)} className="flex items-center gap-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
                    <RefreshCw size={11} /> Run Scan
                  </button>
                  <button onClick={() => handleViewDetails(f.id)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap">
                    <FileText size={11} /> View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateFrameworkModal open={createModalOpen || editingFramework !== null} onClose={() => { setCreateModalOpen(false); setEditingFramework(null); }} onSubmit={editingFramework ? (data) => handleUpdate(editingFramework.id, data as Record<string, unknown>) : handleCreate} initialData={editingFramework || undefined} isEditing={editingFramework !== null} />
      <FrameworkDetailsModal open={detailsFramework !== null} onClose={() => setDetailsFramework(null)} framework={detailsFramework} />
      <ScanResultsModal open={scanResults !== null} onClose={() => setScanResults(null)} scanId={scanResults} />
    </div>
  );
}