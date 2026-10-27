'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, Plus, RefreshCw, FileText, Info, Lock } from 'lucide-react';
import { useComplianceFrameworks } from '@/lib/hooks/useComplianceFrameworks';
import { useSecurityHub } from '@/lib/hooks/useSecurityHub';
import { useSoc2Readiness } from '@/lib/hooks/useSoc2Readiness';
import { useCurrentRole } from '@/lib/hooks/use-current-role';
import { useAuth } from '@/lib/contexts/auth-context';
import { CreateFrameworkModal } from '@/components/compliance/CreateFrameworkModal';
import { FrameworkDetailsModal } from '@/components/compliance/FrameworkDetailsModal';
import { ScanResultsModal } from '@/components/compliance/ScanResultsModal';
import { ComplianceFramework, complianceFrameworksService, type CreateFrameworkRequest } from '@/lib/services/compliance-frameworks.service';
import { useToast } from '@/components/ui/use-toast';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { EVALUATION_COPY, SEE_PLANS, START_PROBLEM_TEXT } from '@/lib/compliance/evaluation';
import { FRAMEWORK_SCANS_LIMIT, useFrameworkEvaluations, type FrameworkResults } from '@/lib/compliance/useFrameworkEvaluations';
import { useNowEachLocalDay } from '../../services/useNowEachLocalDay';
import { COMPLIANCE_COPY, MEMBER_ROLES, describeCompliance, describeSecurityHub, type Loadable } from './complianceModel';

type DemoFramework = { id: string; name: string; complianceScore: number; status: 'passing' | 'in_progress' | 'failing'; rulesCount: number; lastScanAt: Date; isCustom?: boolean };

// SOC 2 is deliberately NOT included here -- it has its own real evidence/customer
// system (Phase 1-3), so its demo card below is sourced from the demo-aware
// useSoc2Readiness() hook (lib/demo-data/soc2-demo-data.ts), never a fabricated
// complianceScore/status pair like the generic Security Hub-backed frameworks below.
const DEMO_FRAMEWORKS: DemoFramework[] = [
  { id: '1', name: 'CIS AWS Benchmark', complianceScore: 87, status: 'passing',     rulesCount: 43, lastScanAt: new Date(Date.now() - 1000 * 60 * 30) },
  { id: '3', name: 'NIST CSF',          complianceScore: 91, status: 'passing',     rulesCount: 56, lastScanAt: new Date(Date.now() - 1000 * 60 * 45) },
  { id: '4', name: 'PCI-DSS',           complianceScore: 68, status: 'failing',     rulesCount: 31, lastScanAt: new Date(Date.now() - 1000 * 60 * 60 * 5) },
];

/**
 * Static framework standards shown on the page. None of these four are
 * wired to a real scanner (see CreateFrameworkModal / compliance-frameworks
 * routes — every "scan" action for these leads to the generic custom
 * framework flow), so their action must stay non-functional and each must
 * be attributed to the system that would actually evaluate it.
 */
const FRAMEWORK_STANDARDS: Array<{
  key: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
  name: string;
  desc: string;
  // 'security_hub' means the framework has a real Security Hub-backed evaluation path
  // (CIS/PCI/NIST). 'soc2_evidence' means the framework has a real, separate technical
  // + customer evidence backend (Phase 1-3) — never label this 'security_hub', since
  // SOC 2 is deliberately not implemented as a Security Hub framework (see
  // backend/src/config/soc2CriteriaConfig.ts's own docblock). 'not_implemented' is kept
  // as a type option for a genuinely unimplemented future framework, but no current
  // entry uses it.
  attribution: 'security_hub' | 'not_implemented' | 'soc2_evidence';
}> = [
  { key: 'cis', badge: 'CIS AWS', badgeBg: '#EEEDFE', badgeColor: '#3C3489', name: 'CIS AWS Foundations', desc: 'Industry-standard security configuration guidelines for AWS infrastructure.', attribution: 'security_hub' },
  { key: 'soc2', badge: 'SOC 2', badgeBg: '#E1F5EE', badgeColor: '#085041', name: 'SOC 2 Readiness', desc: 'Technical and customer-provided supporting evidence for SOC 2 criteria — not a certification or Type II audit.', attribution: 'soc2_evidence' },
  { key: 'nist', badge: 'NIST 800-53', badgeBg: '#E6F1FB', badgeColor: '#0C447C', name: 'NIST 800-53 Rev. 5', desc: 'Security and privacy controls framework for federal information systems and organizations — coverage reflects AWS Security Hub’s interpretation of NIST SP 800-53 Rev. 5, limited to a DevControl-verified technical subset.', attribution: 'security_hub' },
  { key: 'pci', badge: 'PCI-DSS', badgeBg: '#FAEEDA', badgeColor: '#633806', name: 'PCI DSS v4.0.1', desc: 'Payment card industry data security standards for handling cardholder data — Compliance Readiness based on partial AWS/Security Hub evidence, not certification.', attribution: 'security_hub' },
];

/** Demo and sales demo: the sample page, unchanged (no real data is read for its numbers). */
function DemoCompliancePage() {
  const { frameworks, loading, createFramework, updateFramework, executeScan } = useComplianceFrameworks();
  const { data: soc2Criteria, isLoading: soc2Loading, error: soc2QueryError } = useSoc2Readiness();
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

  const handleExecuteScan = async (frameworkId: string) => {
    try { await executeScan(frameworkId); toast({ title: 'Scan initiated' }); }
    catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to execute scan' }); }
  };

  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  const isDemoActive = demoMode || salesDemoMode;
  const displayFrameworks: any[] = DEMO_FRAMEWORKS;
  const displayError: string | null = null;

  const handleCreateFramework = () => setCreateModalOpen(true);
  const handleRunScan = (id: string) => handleExecuteScan(id);
  const handleViewDetails = (id: string) => {
    const real = frameworks.find(f => f.id === id);
    if (real) setDetailsFramework(real);
    else router.push(`/compliance/frameworks/${id}`);
  };

  const hasScans = true;
  const complianceScore: string = Math.round(DEMO_FRAMEWORKS.reduce((sum, f) => sum + f.complianceScore, 0) / DEMO_FRAMEWORKS.length) + '%';
  const criticalViolations = 7 as number | string;
  const highRiskViolations = 23 as number | string;
  const lastScanLabel: string = '30 min ago';

  // The demo SOC 2 card reads the same demo-aware useSoc2Readiness() as the real card.
  const soc2EvaluatedCount = soc2Criteria?.filter((c) => c.evaluated).length ?? 0;
  const soc2Total = soc2Criteria?.length ?? 6;
  const soc2Subtext = soc2Loading
    ? 'Loading…'
    : soc2QueryError
      ? 'Unable to load SOC 2 readiness'
      : `${soc2EvaluatedCount} of ${soc2Total} criteria evaluated`;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-1.5')}>Compliance Intelligence</h1>
          <p className={PAGE_SUBTITLE_CLASS}>Detect compliance gaps and misconfigurations across your AWS environment — before they become audit failures.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {displayFrameworks.length === 0 && !isDemoActive ? (
            <button onClick={handleCreateFramework} className="flex items-center gap-1.5 bg-white text-ink-muted border border-slate-200 rounded-lg px-4 py-2.5 text-label cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
              <Plus size={12} /> Add Framework
            </button>
          ) : (
            <button onClick={() => handleRunScan(displayFrameworks[0].id)}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-4 py-2.5 text-label cursor-pointer transition-colors whitespace-nowrap">
              <RefreshCw size={12} /> Run Baseline Scan
            </button>
          )}
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
                <span className="absolute inset-0 flex items-center justify-center text-label" style={{ color: isDemoActive ? '#D97706' : '#94A3B8' }}>{isDemoActive ? '80%' : 'N/A'}</span>
              </div>
              <div>
                <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">Compliance Score</p>
                <p className="text-ui font-semibold text-slate-900 mb-0.5">{isDemoActive ? 'Partially Compliant' : 'Risk Visibility: Not Established'}</p>
                <p className="text-meta text-ink-muted">{isDemoActive ? '4 frameworks active · 1 failing · last scan 30 min ago' : 'Run a baseline scan to establish compliance posture'}</p>
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />

            {/* Primary risk */}
            <div>
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1.5">{isDemoActive ? 'Primary Risk' : 'Compliance Posture'}</p>
              <div className="flex flex-col gap-0.5">
                {isDemoActive ? (
                  <>
                    <p className="text-meta text-ink-danger font-semibold">● PCI-DSS failing at 68% — audit risk active</p>
                    <p className="text-meta text-ink-warning font-medium">● SOC 2 sample evidence available — see Compliance → SOC 2 Readiness</p>
                    <p className="text-meta text-ink-success font-medium">● CIS (87%) and NIST (91%) passing</p>
                  </>
                ) : (
                  <p className="text-meta text-ink-muted font-medium">Run a baseline scan to see your compliance posture</p>
                )}
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />

            {/* Recommended action */}
            <div>
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">Recommended Action</p>
              <p className="text-ui font-semibold text-slate-900 mb-0.5">{isDemoActive ? 'Resolve PCI-DSS critical controls' : 'Run CIS AWS baseline scan'}</p>
              <p className="text-meta text-ink-muted">{isDemoActive ? '7 critical violations · immediate remediation required' : 'Establish baseline: 2–5 min · read-only · no infrastructure changes'}</p>
            </div>
          </div>
          <a href="/security" className="text-label text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap shrink-0">
            Security overview <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </div>
      </div>

      {/* Decision Intelligence (demo mode only — no real data source for these claims outside demo) */}
      {isDemoActive && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-4 flex items-start gap-3.5">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Shield size={12} className="text-white" /></div>
          <div className="flex-1">
            <p className="text-label text-violet-600 uppercase tracking-[0.04em] mb-1">Decision Intelligence</p>
            <p className="text-ui text-slate-700 leading-relaxed">
              <strong className="text-ink-danger">PCI-DSS is failing at 68%</strong> — payment card data security standards not met. Audit risk is active. Sample SOC 2 technical and customer-provided evidence is available for review — not a certification or Type II audit. CIS AWS (87%) and NIST CSF (91%) are passing.<span className="block mt-1 text-meta text-ink-muted">Recommended: resolve PCI-DSS critical controls before next audit cycle · review SOC 2 sample evidence.</span>
            </p>
          </div>
          <button onClick={() => handleRunScan(displayFrameworks.find((f: any) => f.status === 'failing')?.id ?? displayFrameworks[0]?.id)}
            className="text-label text-ink-danger bg-transparent border-none cursor-pointer shrink-0 flex items-center gap-1 whitespace-nowrap p-0">
            Resolve now <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
      )}

      {/* KPI cards */}
      {(hasScans || isDemoActive) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
          {[
            { label: 'Compliance Score',     value: complianceScore === '—' ? 'Unknown' : complianceScore,   sub: complianceScore === '—' ? 'Unknown — audit readiness cannot be assessed' : 'Weighted across all frameworks', tone: complianceScore === '—' ? 'text-ink-muted' : 'text-ink-success' },
            { label: 'Critical Violations',  value: criticalViolations === '—' ? 'Unknown' : criticalViolations, sub: criticalViolations === '—' ? 'Unknown — potential critical exposure not evaluated' : 'Immediate action required', tone: criticalViolations === '—' ? 'text-ink-muted' : 'text-ink-danger' },
            { label: 'High-Risk Violations', value: highRiskViolations === '—' ? 'Unknown' : highRiskViolations, sub: highRiskViolations === '—' ? 'Unknown — high-risk exposure not evaluated' : 'Public S3, open ports, IAM', tone: highRiskViolations === '—' ? 'text-ink-muted' : 'text-ink-warning' },
            { label: 'Last Scan',            value: lastScanLabel === '—' ? 'Never' : lastScanLabel,          sub: lastScanLabel === '—' ? 'Never — no historical security baseline established' : 'Scan history available', tone: lastScanLabel === '—' ? 'text-ink-muted' : 'text-slate-900' },
          ].map(({ label, value, sub, tone }) => (
            <div key={label} className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-3">{label}</p>
              <div className={`text-section sm:text-kpi tabular-nums leading-none mb-1.5 ${tone}`}>{value}</div>
              <p className="text-meta text-ink-muted leading-relaxed">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {displayError && <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-6"><p className="text-ui text-ink-danger">{displayError}</p></div>}

      {/* Priority Actions */}
      {isDemoActive && displayFrameworks.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">Priority Actions</p>
              <p className="text-meta text-ink-muted">Ranked by audit risk · resolve before next compliance cycle</p>
            </div>
            <span className="inline-flex px-2 py-0.5 rounded text-label uppercase bg-red-600 text-white w-fit">Act Now</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              { priority: 1, color: 'red', bg: 'bg-red-50', border: 'border-red-200', title: 'PCI-DSS', titleSub: 'failing at 68% · audit risk active', titleColor: 'text-ink-danger', desc: 'Payment card data security · 31 rules · critical control failures · immediate remediation required', badge: 'Critical', badgeCls: 'bg-red-600 text-white', btnText: 'Resolve →', btnCls: 'bg-red-600 hover:bg-red-700 text-white border-transparent', fw: 'PCI' },
              // SOC 2's own route is fixed (/compliance/frameworks/soc2, not a generic
              // displayFrameworks id) and its copy must never claim a score, "Type II",
              // or an "in progress" audit -- see the real SOC2 card's own truthful
              // 'Technical + customer evidence' framing this mirrors.
              { priority: 2, color: 'amber', bg: 'bg-amber-50', border: 'border-amber-200', title: 'SOC 2 Readiness', titleSub: 'sample evidence available', titleColor: 'text-ink-warning', desc: 'Technical + customer-provided evidence — sample data for demonstration, not a certification or Type II audit.', badge: 'High', badgeCls: 'bg-amber-100 text-amber-800', btnText: 'Review →', btnCls: 'bg-white hover:bg-slate-50 text-ink-muted border-slate-200', href: '/compliance/frameworks/soc2' },
              { priority: 3, color: 'slate', bg: 'bg-slate-50', border: 'border-slate-100', title: 'Maintain CIS AWS (87%) + NIST CSF (91%)', titleSub: 'passing', titleColor: 'text-ink-success', desc: 'Schedule next scan to maintain compliance standing · no immediate action required', badge: 'Monitor', badgeCls: 'bg-slate-100 text-ink-muted', btnText: 'Schedule →', btnCls: 'bg-white hover:bg-slate-50 text-ink-muted border-slate-200', fw: '' },
            ].map(({ priority, bg, border, title, titleSub, titleColor, desc, badge, badgeCls, btnText, btnCls, fw, href }) => (
              <div key={priority} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${bg} rounded-xl border ${border} px-4 py-3 gap-3`}>
                <div className="flex items-start gap-3.5">
                  <div className="text-center min-w-[36px] shrink-0">
                    <p className={`text-label uppercase mb-0.5 ${titleColor}`}>Priority</p>
                    <p className={`text-card-title tabular-nums ${titleColor}`}>{priority}</p>
                  </div>
                  <div className={`w-px h-8 self-center ${border} border-l shrink-0`} />
                  <div>
                    <p className="text-ui font-semibold text-slate-900 mb-0.5">{title} — <span className={titleColor}>{titleSub}</span></p>
                    <p className="text-meta text-ink-muted">{desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <span className={`inline-flex px-2 py-0.5 rounded text-label uppercase ${badgeCls}`}>{badge}</span>
                  <button onClick={() => href ? router.push(href) : handleViewDetails(displayFrameworks.find((f: any) => fw ? f.name?.includes(fw) : true)?.id ?? '')}
                    className={`border rounded-lg px-3 py-1.5 text-label cursor-pointer transition-colors ${btnCls}`}>{btnText}</button>
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
          <p className="text-ui text-ink-muted">Loading frameworks...</p>
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
                    <span className="text-ui font-semibold text-slate-900">{f.name}</span>
                    <span className="text-label px-2 py-0.5 rounded-full" style={{ background: passing ? '#F0FDF4' : failing ? '#FEF2F2' : '#FFFBEB', color: statusColor }}>{statusLabel}</span>
                    {f.isCustom && <span className="text-label px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">Custom</span>}
                    {f.is_default && <span className="text-label px-2 py-0.5 rounded-full bg-blue-50 text-ink-info">Default</span>}
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: statusColor }} />
                    </div>
                    <span className="text-ui font-semibold tabular-nums min-w-[40px] text-right" style={{ color: statusColor }}>{pct}%</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-meta text-ink-muted">
                    {f.rulesCount != null && <span>{f.rulesCount} rules</span>}
                    {f.lastScanAt && <span>Last scan {new Date(f.lastScanAt).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => handleRunScan(f.id)} className="flex items-center gap-1.5 bg-white text-ink-muted border border-slate-200 rounded-lg px-3.5 py-2 text-label cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
                    <RefreshCw size={11} /> Run Scan
                  </button>
                  <button onClick={() => handleViewDetails(f.id)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-3.5 py-2 text-label cursor-pointer transition-colors whitespace-nowrap">
                    <FileText size={11} /> View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SOC 2 Readiness -- deliberately its own card, not part of displayFrameworks'
          generic progress-bar template above: SOC 2 has a real, separate technical +
          customer evidence system (Phase 1-3) with no composite score, so it must
          never render a percentage/progress-bar/pass-fail badge like the Security
          Hub-backed frameworks do. soc2Subtext is sourced from the same demo-aware
          useSoc2Readiness() the real card below uses -- "sample data" is a fact about
          the source (this page is in demo mode), not a fabricated narrative. */}
      <div className="bg-white rounded-xl border border-slate-100 p-5 sm:p-7 mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center hover:border-slate-300 transition-colors">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-ui font-semibold text-slate-900">SOC 2 Readiness</span>
            <span className="text-label px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">Sample data</span>
          </div>
          <p className="text-meta text-ink-muted leading-relaxed mb-2">Technical and customer-provided supporting evidence for SOC 2 criteria — not a certification or Type II audit.</p>
          <p className="text-meta text-ink-muted">{soc2Subtext}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/compliance/frameworks/soc2')}
          className="text-label text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-3.5 py-2 cursor-pointer hover:bg-violet-100 transition-colors whitespace-nowrap"
        >
          View Readiness →
        </button>
      </div>

      <CreateFrameworkModal open={createModalOpen || editingFramework !== null} onClose={() => { setCreateModalOpen(false); setEditingFramework(null); }} onSubmit={editingFramework ? (data) => handleUpdate(editingFramework.id, data as Record<string, unknown>) : handleCreate} initialData={editingFramework || undefined} isEditing={editingFramework !== null} />
      <FrameworkDetailsModal open={detailsFramework !== null} onClose={() => setDetailsFramework(null)} framework={detailsFramework} />
      <ScanResultsModal open={scanResults !== null} onClose={() => setScanResults(null)} scanId={scanResults} />
    </div>
  );
}

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status;

/** D7: a 402 is the Enterprise plan; any other failure (500, network) is an error; neither is ever an empty state. */
function resultsOf(q: { data?: FrameworkResults; isError: boolean; error: unknown }): Loadable<FrameworkResults> {
  if (q.data !== undefined) return { status: 'ready', data: q.data };
  if (!q.isError) return { status: 'loading' };
  return statusOf(q.error) === 402 ? { status: 'plan' } : { status: 'error' };
}

const ACTION = 'flex items-center gap-1.5 bg-white text-ink-muted border border-slate-200 rounded-lg px-3.5 py-2 text-label cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:bg-slate-100';
const REASON = 'text-meta text-ink-muted';
const PLAN_LINK = 'text-label text-violet-600 no-underline hover:underline';

/**
 * Real mode (Security V2 F3b). Frameworks and runs come from the shared useFrameworkEvaluations (the Security
 * page's reads, polling and in-place starts); every number, state and date from complianceModel.
 */
function ComplianceResultsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { organization } = useAuth();
  const orgId = organization?.id ?? null;
  const role = useCurrentRole();
  const now = useNowEachLocalDay(true);
  const { query, evaluation, overlay } = useFrameworkEvaluations(['compliance', orgId, 'frameworks', FRAMEWORK_SCANS_LIMIT], !!orgId, now);
  const { capability: shCapability, cis, pci, nist, error: shError, syncing: shSyncing, triggerSync: triggerSecurityHubSync } = useSecurityHub();
  const { data: soc2Criteria, isLoading: soc2Loading, error: soc2QueryError } = useSoc2Readiness();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailsFramework, setDetailsFramework] = useState<ComplianceFramework | null>(null);
  const [scanResults, setScanResults] = useState<string | null>(null);

  // Q2: the server's floors (requireMember; requireAdmin for the Security Hub sync). A role not read yet fails closed.
  const canMember = role !== null && MEMBER_ROLES.includes(role);
  const isViewer = role !== null && !canMember;
  const canSync = role !== null && !isViewer;

  const handleCreate = async (data: Record<string, unknown>) => {
    try {
      await complianceFrameworksService.createFramework(data as unknown as CreateFrameworkRequest);
      setCreateModalOpen(false);
      toast({ title: 'Framework created', description: 'Your compliance framework has been created successfully.' });
      await query.refetch();
    } catch (err: unknown) { toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create framework' }); }
  };

  // --- Security Hub capability / per-standard evaluation state (D3) -----
  // Three facts, never collapsed: Security Hub capability (has DevControl proven it can call the API), whether
  // each standard is enabled in the connected account, and the per-control result. A standard leaves the
  // "Not yet available" placeholder only once a real, evaluated backend result exists.
  const cisEvaluated = !!cis && cis.capabilityStatus === 'ENABLED' && cis.standardEnabled === true;
  const pciEvaluated = !!pci && pci.capabilityStatus === 'ENABLED' && pci.standardEnabled === true;
  const nistEvaluated = !!nist && nist.capabilityStatus === 'ENABLED' && nist.standardEnabled === true;
  // A failed read with nothing known is "Couldn't check"; a failed sync keeps the state that was read.
  const shInput = { failed: !!shError && shCapability === null, capability: shCapability, evaluated: { cis: cisEvaluated, pci: pciEvaluated, nist: nistEvaluated } };
  const sh = describeSecurityHub(shInput);
  const shNeverSynced = sh.state === 'never_synced';

  function frameworkSubtext(standardEnabled: boolean | null | undefined, standardLabel: string): string {
    switch (sh.state) {
      case 'never_synced': return 'Security Hub is not currently connected to DevControl';
      case 'not_granted': return 'Security Hub permission not granted';
      case 'not_available': return 'Security Hub is not enabled for this AWS account';
      case 'error': return 'Security Hub check failed — try again';
      default: return standardEnabled === false
        ? `Security Hub is connected, but the ${standardLabel} standard is not enabled`
        : 'Evaluated by AWS Security Hub';
    }
  }

  const cisSubtext = frameworkSubtext(cis?.standardEnabled, 'CIS');
  const pciSubtext = frameworkSubtext(pci?.standardEnabled, 'PCI DSS v4.0.1');
  const nistSubtext = frameworkSubtext(nist?.standardEnabled, 'NIST 800-53 Rev. 5');

  // --- SOC 2 Readiness card state ---------------------------------------
  // A real, separate technical + customer evidence backend, not a Security Hub framework.
  const soc2EvaluatedCount = soc2Criteria?.filter((c) => c.evaluated).length ?? 0;
  const soc2Total = soc2Criteria?.length ?? 6;
  const soc2Subtext = soc2Loading
    ? 'Loading…'
    : soc2QueryError
      ? 'Unable to load SOC 2 readiness'
      : `${soc2EvaluatedCount} of ${soc2Total} criteria evaluated`;

  const results = resultsOf(query);
  const view = describeCompliance(results, shInput, now, overlay);
  const frameworks = results.status === 'ready' ? results.data.frameworks : [];
  const kpiCards = [view.tiles.score, view.tiles.critical, view.tiles.high, view.tiles.frameworks];

  /** A start control's reason: the viewer's first, else why the last start didn't happen. */
  const startReason = (frameworkId: string): string | null => {
    if (isViewer) return EVALUATION_COPY.viewerCantStart;
    const problem = evaluation.problems[frameworkId];
    return problem ? START_PROBLEM_TEXT[problem] : null;
  };

  /** A start control (row, banner or history), disabled while its start is in flight (D5) and for viewers (Q2). */
  const startControl = (frameworkId: string, label: string, idPrefix: string) => {
    const busy = evaluation.starting.has(frameworkId);
    const reason = startReason(frameworkId);
    const reasonId = `${idPrefix}-reason-${frameworkId}`;
    const problem = evaluation.problems[frameworkId];
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => evaluation.start(frameworkId)}
          disabled={!canMember || busy}
          aria-busy={busy || undefined}
          aria-describedby={reason ? reasonId : undefined}
          className={ACTION}
        >
          <RefreshCw size={11} /> {label}
        </button>
        {reason && <p id={reasonId} role={problem && !isViewer ? 'alert' : undefined} className={REASON}>{reason}</p>}
        {!isViewer && problem === 'plan' && <Link href={SEE_PLANS.href} className={PLAN_LINK}>{SEE_PLANS.label}</Link>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-1.5')}>Compliance</h1>
          <p className={PAGE_SUBTITLE_CLASS}>Track your compliance posture across industry standards and frameworks.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
          <button
            onClick={() => setCreateModalOpen(true)}
            disabled={!canMember}
            aria-describedby={isViewer ? 'add-framework-reason' : undefined}
            className="flex items-center gap-1.5 bg-white text-ink-muted border border-slate-200 rounded-lg px-4 py-2.5 text-label cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <Plus size={12} /> Add Framework
          </button>
          {isViewer && <p id="add-framework-reason" className={REASON}>{COMPLIANCE_COPY.viewerCantAddFrameworks}</p>}
        </div>
      </div>

      {/* AWS Security Hub attribution banner */}
      <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3.5 mb-4 flex items-start gap-2.5">
        <Info size={14} className="text-violet-600 mt-0.5 shrink-0" />
        <p className="text-meta text-violet-900 leading-relaxed">
          {shNeverSynced ? (
            <>
              <strong>CIS, PCI DSS v4.0.1, and NIST SP 800-53 Rev. 5</strong> can be evaluated through AWS Security Hub once it&apos;s connected and synchronized — it is not currently connected to DevControl. NIST coverage reflects AWS Security Hub&apos;s own interpretation of the NIST SP 800-53 Rev. 5 guidelines, limited to a DevControl-verified technical subset — not a certification. <strong>SOC 2</strong> readiness — technical evidence DevControl observes plus supporting evidence your organization provides, not a full Type II audit or certification — is available separately.
            </>
          ) : (
            <>
              <strong>CIS, PCI DSS v4.0.1, and NIST SP 800-53 Rev. 5</strong> can be evaluated through AWS Security Hub ({sh.pill.toLowerCase()}) — PCI DSS v4.0.1 and NIST SP 800-53 Rev. 5 coverage each reflect only the AWS/Security Hub evidence DevControl currently supports and are partial, not a certification or full-compliance claim. <strong>SOC 2</strong> readiness — technical evidence DevControl observes plus supporting evidence your organization provides, not a full Type II audit or certification — is available separately.
            </>
          )}
        </p>
      </div>

      {/* D7: a failed read is said so, never shown as an empty page. */}
      {view.status === 'error' && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-4"><p className="text-ui text-ink-danger">{COMPLIANCE_COPY.loadFailed}</p></div>
      )}

      {/* D2 / Q4: the out-of-date banner. */}
      {view.banner && (
        <div data-testid="compliance-stale-banner" className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5 mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <p className="text-meta text-ink-body leading-relaxed">{view.banner.text}</p>
          {view.banner.kind === 'one'
            ? startControl(view.banner.frameworkId, COMPLIANCE_COPY.reEvaluateNow, 'stale-banner')
            : <a href="#evaluation-history" className={PLAN_LINK}>{COMPLIANCE_COPY.review}</a>}
        </div>
      )}

      {/* KPI strip; below Enterprise, the plan (D7: the existing Enterprise upsell, never "Not yet evaluated"). */}
      {view.status === 'plan' ? (
        <div data-testid="compliance-plan" className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-6 flex flex-col gap-1.5">
          <p className="text-ui text-ink-body">{EVALUATION_COPY.enterprisePlan}</p>
          <Link href={SEE_PLANS.href} className={PLAN_LINK}>{SEE_PLANS.label}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
          {kpiCards.map(({ label, value, sub, note }) => (
            <div key={label} data-testid="compliance-tile" className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-3">{label}</p>
              <div className={`text-section sm:text-kpi tabular-nums leading-none mb-1.5 ${value === '—' ? 'text-ink-muted' : 'text-slate-900'}`}>{value}</div>
              <p className="text-meta text-ink-muted leading-relaxed">{sub}</p>
              {note && <p className="text-meta text-ink-muted leading-relaxed">{note}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Your Custom Frameworks: each starts its evaluation in place through the shared start hook (D5). */}
      {frameworks.length > 0 && (
        <>
          <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-4">Your Custom Frameworks</p>
          <div className="flex flex-col gap-3 mb-6">
            {frameworks.map((f) => (
              <div key={f.id} data-testid="compliance-custom-framework" className="bg-white rounded-xl border border-slate-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-ui font-semibold text-slate-900">{f.name}</span>
                    <span className="text-label px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">Custom</span>
                    {f.is_default && <span className="text-label px-2 py-0.5 rounded-full bg-blue-50 text-ink-info">Default</span>}
                  </div>
                  {f.description && <p className="text-meta text-ink-muted">{f.description}</p>}
                </div>
                <div className="flex gap-2 flex-wrap items-start shrink-0">
                  {startControl(f.id, COMPLIANCE_COPY.runScan, 'custom-framework')}
                  <button
                    onClick={() => setDetailsFramework(f)}
                    className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-3.5 py-2 text-label cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <FileText size={11} /> View / Manage Rules
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Compliance Frameworks */}
      <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-4">Compliance Frameworks</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {FRAMEWORK_STANDARDS.map((fw) => {
          const isCis = fw.key === 'cis';
          const isPci = fw.key === 'pci';
          const isNist = fw.key === 'nist';
          const isSoc2 = fw.key === 'soc2';
          const evaluated = isCis ? cisEvaluated : isPci ? pciEvaluated : isNist ? nistEvaluated : false;
          const readiness = isCis ? cis : isPci ? pci : isNist ? nist : null;
          const additionalEvidenceCount = readiness?.controls.filter((c) => c.mappingType === 'ADDITIONAL_EVIDENCE').length ?? 0;
          const notEstablishableCount = readiness?.coverage.notEstablishable ?? 0;
          return (
            <div key={fw.key} data-testid={`standard-${fw.key}`} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-label font-medium px-2 py-0.5 rounded" style={{ background: fw.badgeBg, color: fw.badgeColor }}>{fw.badge}</span>
                {/* Q6: only while Security Hub isn't enabled. */}
                {sh.needsSecurityHub && fw.attribution === 'security_hub' && (
                  <span className="text-label px-2 py-0.5 rounded-full bg-slate-100 text-ink-muted">{COMPLIANCE_COPY.needsSecurityHub}</span>
                )}
              </div>
              <p className="text-ui font-semibold text-slate-900 mb-1">{fw.name}</p>
              <p className="text-meta text-ink-muted leading-relaxed mb-2">{fw.desc}</p>
              <p className="text-label text-slate-600 mb-0.5">
                {fw.attribution === 'security_hub' ? 'Security Hub-backed' : fw.attribution === 'soc2_evidence' ? 'Technical + customer evidence' : 'Not yet implemented'}
              </p>
              <p className="text-meta text-ink-muted mb-3">
                {isCis ? cisSubtext : isPci ? pciSubtext : isNist ? nistSubtext : isSoc2 ? soc2Subtext : 'Future capability — supporting evidence and readiness, not a complete Type II audit'}
              </p>
              {isSoc2 ? (
                <button
                  type="button"
                  onClick={() => router.push('/compliance/frameworks/soc2')}
                  className="w-full text-label text-violet-600 bg-violet-50 border border-violet-200 rounded-lg py-1.5 cursor-pointer hover:bg-violet-100 transition-colors"
                >
                  View Readiness →
                </button>
              ) : evaluated && readiness ? (
                <div className="text-meta text-slate-600 leading-relaxed" data-testid={isCis ? 'cis-coverage' : isPci ? 'pci-coverage' : 'nist-coverage'}>
                  <span className="font-semibold text-ink-success">{readiness.coverage.passed} passed</span>
                  {' · '}
                  <span className="font-semibold text-ink-danger">{readiness.coverage.failed} failed</span>
                  {' · '}
                  <span>{readiness.coverage.unknown} unknown</span>
                  {' · '}
                  <span>{readiness.coverage.notEvaluated} not evaluated</span>
                  {notEstablishableCount > 0 && <span>{' · '}{notEstablishableCount} not establishable</span>}
                  <span className="text-ink-muted"> / {readiness.coverage.totalControls} mapped</span>
                  {isPci && (
                    <p className="text-meta text-ink-muted mt-1.5 leading-relaxed">
                      Partial coverage — supported AWS evidence only, not a full PCI DSS v4.0.1 assessment.
                      {additionalEvidenceCount > 0 && ` ${additionalEvidenceCount} of these are supporting evidence only (not a direct technical match).`}
                    </p>
                  )}
                  {isNist && (
                    <p className="text-meta text-ink-muted mt-1.5 leading-relaxed">
                      Coverage reflects AWS Security Hub&apos;s own interpretation of NIST SP 800-53 Rev. 5, limited to a DevControl-verified subset of AWS&apos;s ~297-control catalog — not a certification, audit, or full NIST 800-53 assessment. Manual and non-technical requirements are not evaluated.
                      {additionalEvidenceCount > 0 && ` ${additionalEvidenceCount} of these are supporting evidence only (not a direct technical match).`}
                    </p>
                  )}
                </div>
              ) : (
                <button type="button" disabled aria-disabled="true" className="w-full text-label text-ink-muted bg-slate-50 border border-slate-200 rounded-lg py-1.5 font-medium cursor-not-allowed">
                  🔒 Not yet available
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* AWS Security Hub informational panel */}
      <div data-testid="security-hub-card" className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <p className="text-label text-violet-600 uppercase tracking-[0.04em] mb-1.5">AWS Security Hub</p>
            <p className="text-ui font-semibold text-slate-900 mb-2">
              {(() => {
                // Composed rather than hand-written per combination (2^3 branches for three frameworks); only
                // CIS/PCI/NIST are ever named, matching FRAMEWORK_STANDARDS' 'security_hub' attribution.
                const evaluatedNames: string[] = [];
                if (cisEvaluated) evaluatedNames.push('CIS AWS Foundations');
                if (pciEvaluated) evaluatedNames.push('PCI DSS v4.0.1 Compliance Readiness');
                if (nistEvaluated) evaluatedNames.push('NIST SP 800-53 Rev. 5 Compliance Readiness');
                const pendingNames: string[] = [];
                if (!cisEvaluated) pendingNames.push('CIS');
                if (!pciEvaluated) pendingNames.push('PCI DSS v4.0.1');
                if (!nistEvaluated) pendingNames.push('NIST SP 800-53 Rev. 5');

                const joinNames = (names: string[]) =>
                  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

                if (evaluatedNames.length === 3) {
                  return `${joinNames(evaluatedNames)} are evaluated through AWS Security Hub.`;
                }
                if (evaluatedNames.length > 0) {
                  return `${joinNames(evaluatedNames)} ${evaluatedNames.length > 1 ? 'are' : 'is'} evaluated through AWS Security Hub. ${joinNames(pendingNames)} can also be evaluated through AWS Security Hub.`;
                }
                return `${joinNames(pendingNames)} can be evaluated through AWS Security Hub once it is connected and synchronized.`;
              })()}
            </p>
            {/* D3 / Q5: the state's own text in the body; the general description otherwise. */}
            <p data-testid="security-hub-body" className="text-meta text-ink-muted leading-relaxed max-w-xl">
              {sh.body ?? 'AWS Security Hub continuously evaluates supported security standards and provides findings that can be used to understand your compliance posture.'}
            </p>
          </div>
          <div className="flex flex-row sm:flex-col items-start sm:items-end gap-2 shrink-0">
            <span data-testid="security-hub-pill" className="inline-flex items-center gap-1 text-label px-2.5 py-1 rounded-full bg-slate-100 text-ink-muted uppercase tracking-[0.04em] whitespace-nowrap">
              <Lock size={10} /> {sh.pill}
            </span>
            <button
              type="button"
              onClick={() => triggerSecurityHubSync()}
              disabled={shSyncing || !canSync}
              aria-describedby={isViewer ? 'security-hub-sync-reason' : undefined}
              className="flex items-center gap-1.5 bg-white text-violet-600 border border-violet-200 rounded-lg px-3 py-1.5 text-label cursor-pointer hover:bg-violet-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <RefreshCw size={11} className={shSyncing ? 'animate-spin' : ''} /> {shSyncing ? 'Syncing…' : 'Sync Security Hub'}
            </button>
            {isViewer && <p id="security-hub-sync-reason" className={REASON}>{COMPLIANCE_COPY.viewerCantSyncSecurityHub}</p>}
            <a href="/docs" className="text-label text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap">
              Learn more <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
          </div>
        </div>
      </div>

      {/* Evaluation history (D4): every run, failed ones included. Not shown below Enterprise or after a failed read. */}
      {(view.status === 'loading' || view.status === 'ready') && (
        <>
          <p id="evaluation-history" className="text-label text-ink-muted uppercase tracking-[0.04em] mb-4">Active Evaluations</p>
          {view.status === 'loading' ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 mb-6">
              <RefreshCw size={22} className="text-slate-300 mx-auto mb-3 animate-spin" />
              <p className="text-ui text-ink-muted">Loading evaluations...</p>
            </div>
          ) : view.history.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-8 sm:p-12 text-center mb-6">
              <p className="text-ui font-semibold text-slate-900 mb-2">No active compliance evaluations</p>
              <p className="text-meta text-ink-muted">Start an evaluation when a supported framework becomes available.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 mb-6">
              {view.history.map((row) => (
                <div key={row.id} data-testid="evaluation-history-row" data-status={row.status} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-ui text-slate-900">{row.text}</p>
                    {row.note && <p className="text-meta text-ink-muted">{row.note}</p>}
                  </div>
                  {row.canReEvaluate && startControl(row.frameworkId, COMPLIANCE_COPY.reEvaluateNow, `history-${row.id}`)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Security / read-only footer messaging */}
      <p className="text-meta text-ink-muted text-center">
        DevControl evaluations use secure, read-only access by default — optional remediation actions require separate, explicit permission and your approval.
      </p>

      <CreateFrameworkModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} onSubmit={(data) => handleCreate(data as Record<string, unknown>)} isEditing={false} />
      <FrameworkDetailsModal open={detailsFramework !== null} onClose={() => setDetailsFramework(null)} framework={detailsFramework} />
      <ScanResultsModal open={scanResults !== null} onClose={() => setScanResults(null)} scanId={scanResults} />
    </div>
  );
}

export default function ComplianceFrameworksPage() {
  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  return demoMode || salesDemoMode ? <DemoCompliancePage /> : <ComplianceResultsPage />;
}
