'use client';

import { useState, useCallback } from 'react';
import { Shield, RefreshCw, Download, CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { usePlan } from '@/lib/hooks/use-plan';
import { demoModeService } from '@/lib/services/demo-mode.service';
import { complianceEngineService, ControlFramework, ControlResult, FrameworkScanResult } from '@/lib/services/compliance-engine.service';
import { useEffect } from 'react';

function ScoreCircle({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#059669' : score >= 60 ? '#D97706' : '#DC2626';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={10} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={10} strokeDasharray={circumference} strokeDashoffset={progress} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold" style={{ fontSize: size > 100 ? '1.5rem' : '1rem', color, lineHeight: 1 }}>{score}%</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pass') return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600"><CheckCircle2 size={10} /> PASS</span>;
  if (status === 'not_applicable') return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-500"><MinusCircle size={10} /> N/A</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600"><XCircle size={10} /> FAIL</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { critical: 'bg-red-50 text-red-600', high: 'bg-orange-50 text-orange-700', medium: 'bg-amber-50 text-amber-600', low: 'bg-green-50 text-green-600' };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${map[severity] || map.low}`}>{severity}</span>;
}

function ControlRow({ ctrl }: { ctrl: ControlResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} className={`cursor-pointer transition-colors ${expanded ? 'bg-violet-50/30' : 'hover:bg-slate-50'}`}>
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
            <span className="text-xs font-bold text-slate-500 font-mono">{ctrl.controlId}</span>
          </div>
        </td>
        <td className="px-4 py-3 align-middle"><span className="text-[10px] text-slate-400 font-medium">{ctrl.category}</span></td>
        <td className="px-4 py-3 align-middle"><span className="text-sm font-semibold text-slate-900">{ctrl.name}</span></td>
        <td className="px-4 py-3 align-middle"><SeverityBadge severity={ctrl.severity} /></td>
        <td className="px-4 py-3 align-middle"><StatusBadge status={ctrl.status} /></td>
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[50px]">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ctrl.score}%`, background: ctrl.score >= 80 ? '#059669' : ctrl.score >= 60 ? '#D97706' : '#DC2626' }} />
            </div>
            <span className="text-xs font-bold text-slate-900 min-w-[34px] text-right">{ctrl.score}%</span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-6 py-5 pl-12 border-b border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">Description</p>
                <p className="text-sm text-slate-500 leading-relaxed">{ctrl.description}</p>
                {ctrl.evidence?.details && (
                  <div className="mt-3 bg-white border border-slate-200 rounded-lg px-3.5 py-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Evidence</p>
                    <p className="text-xs text-slate-700 leading-relaxed">{ctrl.evidence.details}</p>
                    {ctrl.evidence.totalResources != null && (
                      <div className="flex gap-4 mt-2">
                        {ctrl.evidence.passingCount != null && <span className="text-xs text-green-600 font-semibold">✓ {ctrl.evidence.passingCount} passing</span>}
                        {ctrl.evidence.failingCount != null && ctrl.evidence.failingCount > 0 && <span className="text-xs text-red-600 font-semibold">✗ {ctrl.evidence.failingCount} failing</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {ctrl.status === 'fail' && (
                <div>
                  <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-1.5">Remediation Steps</p>
                  <p className="text-sm text-slate-500 leading-relaxed">{ctrl.remediationGuidance}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function CompliancePage() {
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
      setLoading(true); setError(null);
      const results = await complianceEngineService.getAllResults();
      setSoc2Result(results.soc2); setHipaaResult(results.hipaa);
    } catch (err: any) {
      const msg: string = err.message ?? '';
      const isSuppressed = msg.includes('402') || msg.includes('Subscription') || msg.includes('404') || msg.toLowerCase().includes('not found');
      if (!isSuppressed) setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const handleRunScan = async () => {
    try {
      setScanning(true); setError(null);
      const results = await complianceEngineService.runAllScans();
      setSoc2Result(results.soc2); setHipaaResult(results.hipaa);
    } catch (err: any) { setError(err.message); }
    finally { setScanning(false); }
  };

  const handleDownloadReport = async () => {
    try {
      setDownloading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const url = complianceEngineService.getReportUrl(activeFramework);
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Failed to download report');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = href;
      a.download = `${activeFramework === 'soc2' ? 'SOC2' : 'HIPAA'}-compliance-report-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click(); URL.revokeObjectURL(href);
    } catch (err: any) { setError(err.message); }
    finally { setDownloading(false); }
  };

  const filteredControls = activeResult?.controlResults?.filter(ctrl => filterStatus === 'all' ? true : filterStatus === 'pass' ? ctrl.status === 'pass' || ctrl.status === 'not_applicable' : ctrl.status === 'fail') ?? [];
  const totalControls = (soc2Result?.controlsTotal ?? 0) + (hipaaResult?.controlsTotal ?? 0);
  const totalPassed   = (soc2Result?.controlsPassed ?? 0) + (hipaaResult?.controlsPassed ?? 0);
  const totalFailed   = (soc2Result?.controlsFailed ?? 0) + (hipaaResult?.controlsFailed ?? 0);
  const combinedScore = totalControls > 0 ? Math.round((totalPassed / totalControls) * 100) : 0;
  const hasResults = soc2Result !== null || hipaaResult !== null;
  const isDemoActive = demoModeService.isEnabled();
  const displayError = isDemoActive ? null : error;

  if (!isEnterprise) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Security</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Compliance Frameworks</h1>
          <p className="text-gray-500 text-sm mt-1.5">SOC 2, HIPAA, and CIS compliance scanning.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Enterprise Feature</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            Compliance scanning is available on the Enterprise plan. Upgrade to run SOC 2, HIPAA, and CIS scans.
          </p>
          <a href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
            Upgrade to Enterprise
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">Compliance Engine</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">SOC 2 &amp; HIPAA Compliance</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Named-control pass/fail audit reports — ready for your auditors.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasResults && (
            <button onClick={handleDownloadReport} disabled={downloading || !activeResult}
              className={`flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors whitespace-nowrap ${downloading ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 cursor-pointer'}`}>
              <Download size={13} /> {downloading ? 'Downloading…' : 'Download PDF'}
            </button>
          )}
          <button onClick={handleRunScan} disabled={scanning}
            className={`flex items-center gap-1.5 bg-violet-600 text-white border-none rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${scanning ? 'cursor-not-allowed opacity-70' : 'hover:bg-violet-700 cursor-pointer'}`}>
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      {displayError && <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-6"><p className="text-sm text-red-600">{displayError}</p></div>}

      {loading && (
        <div className="bg-white rounded-2xl p-16 text-center border border-slate-100">
          <RefreshCw size={22} className="text-slate-300 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-slate-400">Loading compliance data…</p>
        </div>
      )}

      {!loading && !hasResults && !displayError && (
        <div className="bg-white rounded-2xl p-8 sm:p-16 text-center border border-slate-100 mb-7">
          <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5"><Shield size={26} className="text-violet-600" /></div>
          <h3 className="text-lg font-bold text-slate-900 mb-2.5">No scans yet</h3>
          <p className="text-sm text-slate-500 leading-relaxed mb-7 max-w-sm mx-auto">Run your first compliance scan to generate SOC 2 Type II and HIPAA control results.</p>
          <button onClick={handleRunScan} disabled={scanning}
            className={`bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-7 py-3 text-sm font-semibold transition-colors ${scanning ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
            {scanning ? 'Scanning…' : 'Run First Scan'}
          </button>
        </div>
      )}

      {!loading && hasResults && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
            {[
              { label: 'Overall Score',    value: `${combinedScore}%`, sub: 'Weighted across both frameworks', color: combinedScore >= 80 ? '#059669' : combinedScore >= 60 ? '#D97706' : '#DC2626' },
              { label: 'Controls Passing', value: totalPassed,  sub: 'Across SOC 2 + HIPAA', color: '#059669' },
              { label: 'Controls Failing', value: totalFailed,  sub: 'Require remediation',  color: totalFailed > 0 ? '#DC2626' : '#059669' },
              { label: 'Total Controls',   value: totalControls, sub: '12 SOC 2 · 12 HIPAA', color: '#0F172A' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                <div className="text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-1.5" style={{ color }}>{value}</div>
                <p className="text-xs text-slate-400">{sub}</p>
              </div>
            ))}
          </div>

          {/* Score circles */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-8 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-7">
              <h2 className="text-base font-bold text-slate-900">Framework Overview</h2>
              {activeResult?.scannedAt && <p className="text-xs text-slate-400">Last scan: {new Date(activeResult.scannedAt).toLocaleString()}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16">
              {[
                { fw: 'soc2' as ControlFramework, result: soc2Result, name: 'SOC 2 Type II' },
                { fw: 'hipaa' as ControlFramework, result: hipaaResult, name: 'HIPAA Security Rule' },
              ].map(({ fw, result, name }, i) => (
                <div key={fw} className="flex items-center gap-8 sm:gap-16">
                  {i > 0 && <div className="hidden sm:block w-px h-28 bg-slate-200" />}
                  <button onClick={() => setActiveFramework(fw)}
                    className={`flex flex-col items-center gap-4 rounded-2xl px-6 py-5 transition-all cursor-pointer border-2 ${activeFramework === fw ? 'bg-violet-50 border-violet-600' : 'bg-transparent border-transparent hover:bg-slate-50'}`}>
                    <ScoreCircle score={result?.overallScore ?? 0} size={120} />
                    <div className="text-center">
                      <p className="text-base font-bold text-slate-900 mb-1">{name}</p>
                      <p className="text-xs text-slate-400">{result?.controlsPassed ?? 0}/{result?.controlsTotal ?? 0} controls passing</p>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Controls table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-slate-900">{activeFramework === 'soc2' ? 'SOC 2 Type II' : 'HIPAA Security Rule'} Controls</h2>
                <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{activeResult?.controlsTotal ?? 0} controls</span>
              </div>
              <div className="flex gap-1 bg-slate-50 rounded-lg p-0.5">
                {(['all', 'pass', 'fail'] as const).map(f => (
                  <button key={f} onClick={() => setFilterStatus(f)}
                    className={`px-3.5 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer transition-all ${filterStatus === f ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>
                    {f === 'all' ? `All (${activeResult?.controlsTotal ?? 0})` : f === 'pass' ? `Pass (${activeResult?.controlsPassed ?? 0})` : `Fail (${activeResult?.controlsFailed ?? 0})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Control ID', 'Category', 'Control Name', 'Severity', 'Status', 'Score'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredControls.map((ctrl, i) => (
                    <tr key={ctrl.id} className={i < filteredControls.length - 1 ? 'border-b border-slate-50' : ''}>
                      <td colSpan={6} className="p-0">
                        <table className="w-full border-collapse"><tbody><ControlRow ctrl={ctrl} /></tbody></table>
                      </td>
                    </tr>
                  ))}
                  {filteredControls.length === 0 && (
                    <tr><td colSpan={6} className="p-10 text-center text-sm text-slate-400">No controls match the selected filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}