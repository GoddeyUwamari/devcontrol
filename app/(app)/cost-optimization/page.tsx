'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Zap, Wrench, DollarSign, Server, ShieldCheck, Tag, CheckCircle, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/contexts/auth-context';
import { remediationService } from '@/lib/services/remediation.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import RecommendationDrawer from '@/components/cost-optimization/RecommendationDrawer';

const COST_OPT_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization`;

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function startAIScan(): Promise<string> {
  const res = await fetch(`${COST_OPT_BASE}/scan`, { method: 'POST', credentials: 'include', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to start scan');
  const data = await res.json();
  return data.scanId as string;
}

async function pollScanStatus(scanId: string) {
  const res = await fetch(`${COST_OPT_BASE}/status/${scanId}`, { credentials: 'include', headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Failed to poll scan status');
  const data = await res.json();
  return { status: data.scan?.status ?? 'running', opportunityCount: data.scan?.opportunityCount ?? null, totalSavings: data.scan?.totalSavings ?? null };
}

async function loadAIResults(): Promise<any[]> {
  const res = await fetch(`${COST_OPT_BASE}/results`, { credentials: 'include', headers: getAuthHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

function mapAIResultToRec(r: any): any {
  return {
    id: r.id, title: r.title, description: r.description || '',
    type: 'rightsizing', service: r.resourceType || 'AWS', resource: r.resourceId || '',
    region: 'us-east-1', monthlySavings: parseFloat(r.monthlySavings) || 0,
    annualSavings: parseFloat(r.annualSavings) || 0,
    risk: r.riskLevel === 'Low' ? 'safe' : r.riskLevel === 'Medium' ? 'caution' : 'high',
    effort: 'low', estimatedTime: '~2 minutes',
    downtime: r.riskLevel === 'Low' ? 'Zero downtime' : 'Brief restart',
    status: r.status ?? 'pending', confidence: 90, impactLabel: r.impactLabel,
  };
}

const SCAN_STEPS = ['Connecting to AWS', 'Discovering resources', 'Analyzing costs', 'Generating recommendations'] as const;
type ScanState = 'idle' | 'scanning' | 'complete';

const DEMO_RECOMMENDATIONS = [
  { id: 'demo-1', title: 'RDS reserved instance pricing', description: 'Switch RDS instances from on-demand to 1-year reserved pricing. Instances have shown 100% utilization for 90 days.', type: 'reserved_instance', service: 'RDS', resource: 'rds-prod-01, rds-prod-02', region: 'us-east-1', monthlySavings: 890, annualSavings: 10680, risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime', status: 'pending', confidence: 97 },
  { id: 'demo-2', title: 'Idle RDS instances (3)', description: 'Terminate 3 RDS instances with <2% CPU utilization over 30 days. No active connections detected.', type: 'idle_resource', service: 'RDS', resource: 'rds-dev-01, rds-staging-02, rds-test-03', region: 'us-east-1, us-west-2', monthlySavings: 445, annualSavings: 5340, risk: 'safe', effort: 'low', estimatedTime: '5 minutes', downtime: 'Zero downtime', status: 'pending', confidence: 94 },
  { id: 'demo-3', title: 'Underloaded EC2 instances (5)', description: 'Downsize 5 EC2 instances from t3.large to t3.medium. Average CPU utilization is 12% over 60 days.', type: 'rightsizing', service: 'EC2', resource: 'ec2-worker-01, ec2-worker-02', region: 'us-east-1', monthlySavings: 362, annualSavings: 4344, risk: 'caution', effort: 'medium', estimatedTime: '8 minutes', downtime: 'Brief restart per instance', status: 'pending', confidence: 91 },
  { id: 'demo-4', title: 'Unused elastic IPs', description: 'Release unused Elastic IPs that are generating idle charges with no associated instances.', type: 'idle_resource', service: 'EC2', resource: 'eip-01, eip-02', region: 'us-east-1, eu-west-1', monthlySavings: 73, annualSavings: 876, risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime', status: 'pending', confidence: 99 },
  { id: 'demo-5', title: 'Oversized Lambda functions', description: 'Reduce memory allocation for Lambda functions running below 30% of provisioned memory.', type: 'rightsizing', service: 'Lambda', resource: 'fn-api-handler, fn-image-processor', region: 'us-east-1', monthlySavings: 48, annualSavings: 576, risk: 'safe', effort: 'low', estimatedTime: '3 minutes', downtime: 'Zero downtime', status: 'pending', confidence: 88 },
  { id: 'demo-6', title: 'Idle NAT gateway', description: 'Remove idle NAT gateway processing less than 5GB of traffic per month.', type: 'idle_resource', service: 'VPC', resource: 'nat-01a', region: 'us-east-1', monthlySavings: 38, annualSavings: 456, risk: 'caution', effort: 'low', estimatedTime: '5 minutes', downtime: 'Brief network interruption', status: 'pending', confidence: 85 },
  { id: 'demo-7', title: 'S3 incomplete multipart uploads', description: 'Add lifecycle rules to abort incomplete multipart uploads older than 7 days.', type: 'storage_optimization', service: 'S3', resource: 's3-assets, s3-backups', region: 'us-east-1', monthlySavings: 12, annualSavings: 144, risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime', status: 'pending', confidence: 99 },
];

export default function CostOptimizationPage() {
  const router = useRouter();
  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === 'enterprise';
  const [creatingWorkflowFor, setCreatingWorkflowFor] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [loadError, setLoadError] = useState<any>(null);
  const [actionInProgress, setActionInProgress] = useState<Set<string>>(new Set());
  const [demoStatusOverrides, setDemoStatusOverrides] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<any | null>(null);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanStep, setScanStep] = useState(0);
  const [scanId, setScanId] = useState<string | null>(null);
  const isScanningRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }
  };

  const startStepperAnimation = () => {
    setScanStep(0);
    let step = 0;
    const delays = [800, 2200, 4000];
    stepRef.current = setInterval(() => {
      step++;
      if (step < SCAN_STEPS.length - 1) setScanStep(step);
      else if (stepRef.current) clearInterval(stepRef.current);
    }, delays[step] ?? 2000);
  };

  const handleAIScan = async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    stopPolling();
    setRecommendations([]); setSummary(null); setScanState('scanning'); setScanStep(0);
    startStepperAnimation();
    let id: string;
    try {
      id = await startAIScan(); setScanId(id);
    } catch (err: any) {
      stopPolling(); setScanState('idle'); isScanningRef.current = false;
      toast.error(err.message || 'Failed to start scan'); return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const { status, opportunityCount, totalSavings } = await pollScanStatus(id);
        if (status === 'complete') {
          stopPolling(); setScanStep(SCAN_STEPS.length - 1);
          setTimeout(async () => {
            const raw = await loadAIResults();
            if (raw.length > 0) {
              const mapped = raw.map(mapAIResultToRec);
              setRecommendations(mapped);
              setSummary({ totalRecommendations: mapped.length, totalMonthlySavings: mapped.reduce((s: number, r: any) => s + r.monthlySavings, 0), totalAnnualSavings: mapped.reduce((s: number, r: any) => s + r.annualSavings, 0) });
            }
            setScanState('complete'); isScanningRef.current = false;
            if (opportunityCount !== null) toast.success(`Scan complete — ${opportunityCount} opportunit${opportunityCount !== 1 ? 'ies' : 'y'} found${totalSavings ? `, $${Number(totalSavings).toLocaleString()}/mo in savings` : ''}`, { duration: 6000 });
          }, 900);
        } else if (status === 'failed') {
          stopPolling(); setScanState('idle'); isScanningRef.current = false;
          toast.error('Scan failed. Please try again.');
        }
      } catch { /* silently ignore */ }
    }, 3000);
  };

  useEffect(() => { return () => stopPolling(); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadAIResults().then(raw => {
      if (raw && raw.length > 0) {
        const mapped = raw.map(mapAIResultToRec);
        setRecommendations(mapped);
        const totalSavings = mapped.reduce((s: number, r: any) => s + r.monthlySavings, 0);
        setSummary({ totalRecommendations: mapped.length, totalMonthlySavings: totalSavings, totalAnnualSavings: totalSavings * 12 });
        setScanState('complete');
      } else { setScanState('idle'); }
      setIsLoading(false);
    }).catch(() => { setScanState('idle'); setIsLoading(false); });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowRiskModal(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const demoModeHook = useDemoMode();
  const salesDemoHook = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoModeHook || salesDemoHook;
  const demoMode = isDemoActive;
  const httpStatus: number | undefined = (loadError as any)?.response?.status;
  const isConnected: boolean = isDemoActive ? true : httpStatus !== 401 && httpStatus !== 403;
  const hasScanData: boolean = recommendations?.length > 0 || isDemoActive || scanState === 'complete';

  const displayRecs = isDemoActive
    ? DEMO_RECOMMENDATIONS.map((r: any) => ({ ...r, status: demoStatusOverrides[r.id] ?? r.status }))
    : (recommendations || []);

  const filteredDisplayRecs = filter === ''
    ? displayRecs
    : displayRecs.filter((r: any) => {
        if (filter === 'pending') return r.status === 'pending';
        if (filter === 'approved' || filter === 'applied') return r.status === 'applied' || r.status === 'approved';
        return true;
      });

  const totalOpportunities = isDemoActive ? DEMO_RECOMMENDATIONS.length : displayRecs.filter((r: any) => r.status !== 'ignored' && r.status !== 'dismissed').length;
  const monthlySavings = isDemoActive ? 1697 : Math.round(summary?.totalMonthlySavings ?? 0);
  const annualSavings = isDemoActive ? 20364 : Math.round(summary?.totalAnnualSavings ?? 0);
  const zeroRiskCount = displayRecs.filter((r: any) => r.risk === 'safe' && r.status === 'pending').length;

  const aiApprove = async (id: string) => {
    if (actionInProgress.has(id)) return;
    if (isDemoActive) { setDemoStatusOverrides(prev => ({ ...prev, [id]: 'applied' })); toast.success('Recommendation approved'); return; }
    setActionInProgress(prev => new Set([...prev, id]));
    try {
      const res = await fetch(`${COST_OPT_BASE}/apply/${id}`, { method: 'POST', credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to approve');
      setRecommendations(prev => prev.map((r: any) => r.id === id ? { ...r, status: 'applied' } : r));
      toast.success('Recommendation approved');
    } catch (err: any) { toast.error(err.message || 'Failed to approve'); }
    finally { setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const aiIgnore = async (id: string) => {
    if (actionInProgress.has(id)) return;
    if (isDemoActive) { setDemoStatusOverrides(prev => ({ ...prev, [id]: 'ignored' })); toast.success('Recommendation dismissed'); return; }
    setActionInProgress(prev => new Set([...prev, id]));
    try {
      const res = await fetch(`${COST_OPT_BASE}/ignore/${id}`, { method: 'POST', credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to dismiss');
      setRecommendations(prev => prev.map((r: any) => r.id === id ? { ...r, status: 'ignored' } : r));
      toast.success('Recommendation dismissed');
    } catch (err: any) { toast.error(err.message || 'Failed to dismiss'); }
    finally { setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleConfirmApproveAll = async () => {
    const pendingLowRisk = displayRecs.filter((r: any) => r.status === 'pending' && r.risk === 'safe');
    if (pendingLowRisk.length === 0) { setShowRiskModal(false); return; }
    setApprovingAll(true);
    try {
      if (isDemoActive) {
        const overrides: Record<string, string> = {};
        pendingLowRisk.forEach((r: any) => { overrides[r.id] = 'applied'; });
        setDemoStatusOverrides(prev => ({ ...prev, ...overrides }));
      } else {
        await Promise.all(pendingLowRisk.map((r: any) => fetch(`${COST_OPT_BASE}/apply/${r.id}`, { method: 'POST', credentials: 'include', headers: getAuthHeaders() })));
        const approvedIds = new Set(pendingLowRisk.map((r: any) => r.id));
        setRecommendations(prev => prev.map((r: any) => approvedIds.has(r.id) ? { ...r, status: 'applied' } : r));
      }
      setShowRiskModal(false);
      toast.success(`${pendingLowRisk.length} change${pendingLowRisk.length !== 1 ? 's' : ''} approved`);
    } catch (err: any) { toast.error(err.message || 'Failed to approve all'); }
    finally { setApprovingAll(false); }
  };

  const handleRestore = (id: string) => {
    if (isDemoActive) { setDemoStatusOverrides(prev => ({ ...prev, [id]: 'pending' })); toast.success('Recommendation restored'); return; }
    setRecommendations(prev => prev.map((r: any) => r.id === id ? { ...r, status: 'pending' } : r));
    toast.success('Recommendation restored');
  };

  const handleCreateWorkflow = async (rec: any) => {
    setCreatingWorkflowFor(rec.id);
    try {
      const actionTypeMap: Record<string, string> = { rightsizing: 'rightsize_instance', idle_resource: 'stop_instance', storage_optimization: 'enable_s3_lifecycle', reserved_instance: 'stop_instance' };
      await remediationService.create({ recommendationId: rec.id, resourceId: rec.resource?.split(',')[0]?.trim() || rec.id, resourceType: rec.service?.toLowerCase() || 'ec2', actionType: (actionTypeMap[rec.type] || 'stop_instance') as any, actionParams: { region: 'us-east-1' }, estimatedSavings: rec.monthlySavings || 0, riskLevel: rec.risk === 'safe' ? 'low' : rec.risk === 'caution' ? 'medium' : 'high' });
      toast.success('Remediation workflow created');
      router.push('/remediation');
    } catch (err: any) { toast.error(err?.message || 'Failed to create workflow'); }
    finally { setCreatingWorkflowFor(null); }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── RISK MODAL ── */}
      {showRiskModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-end sm:items-center justify-center z-[1000] p-0 sm:p-6" onClick={() => setShowRiskModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 sm:p-8 pb-4 shrink-0 relative">
              <button onClick={() => setShowRiskModal(false)} className="absolute top-4 right-4 bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
              <h2 className="text-lg font-bold text-slate-900 mb-2 tracking-tight">Review Changes Before Approving</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                {displayRecs.filter((r: any) => r.status === 'pending').length} changes · <span className="text-green-600 font-semibold">${monthlySavings.toLocaleString()}/mo savings</span> · Est. {demoMode ? '15 minutes' : 'varies'} total
              </p>
            </div>
            <div className="overflow-y-auto px-6 sm:px-8 pb-4 flex-1">
              <div className="flex flex-col gap-2.5">
                {(demoMode ? DEMO_RECOMMENDATIONS : displayRecs.filter((r: any) => r.status === 'pending')).map((rec: any) => (
                  <div key={rec.id} className={`p-3.5 rounded-xl border ${rec.risk === 'safe' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{rec.risk === 'safe' ? '✅' : '⚠️'}</span>
                        <span className="text-sm font-semibold text-slate-900">{rec.title}</span>
                      </div>
                      <span className="text-sm font-bold text-green-600 shrink-0">${rec.monthlySavings.toLocaleString()}/mo</span>
                    </div>
                    <div className="flex flex-wrap gap-3 pl-6">
                      <span className={`text-xs font-medium ${rec.risk === 'safe' ? 'text-green-600' : 'text-amber-600'}`}>{rec.downtime}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{rec.estimatedTime}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500 font-mono">{rec.resource?.split(',')[0]}{rec.resource?.includes(',') ? '...' : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6 sm:p-8 pt-4 shrink-0 border-t border-slate-100">
              <div className="bg-slate-50 rounded-xl p-4 mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Overall Risk</p>
                  <p className="text-sm font-semibold text-amber-500 m-0">Low · 3 zero-risk, 1 requires brief restart</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Annual Impact</p>
                  <p className="text-sm font-bold text-green-600 m-0">${annualSavings.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowRiskModal(false)} className="flex-1 py-3 rounded-xl text-sm font-semibold text-slate-600 bg-white border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={handleConfirmApproveAll} disabled={approvingAll} className={`flex-[2] py-3 rounded-xl text-sm font-semibold text-white border-none flex items-center justify-center gap-2 transition-colors ${approvingAll ? 'bg-violet-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
                  {approvingAll ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Approving...</> : 'Approve All Changes →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 rounded-full border-2 border-violet-100 border-b-violet-600" style={{ animation: 'spin 0.75s linear infinite' }} />
        </div>

      ) : !isConnected ? (
        /* ── STATE 1: NOT CONNECTED ── */
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Find hidden AWS costs in minutes</h1>
              <p className="text-sm text-slate-500 leading-relaxed">Connect your AWS account to uncover wasted spend, over-provisioned resources, and cost risks.</p>
            </div>
            <button className="bg-violet-700 hover:bg-violet-800 text-white px-5 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer whitespace-nowrap transition-colors">
              Connect AWS &amp; scan for waste
            </button>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-6 sm:p-12">
            <p className="text-lg font-medium text-slate-900 mb-3">Your AWS account isn&apos;t connected yet</p>
            <p className="text-sm text-slate-500 max-w-lg leading-relaxed mb-7">Most teams discover 20–40% in wasted cloud spend within their first scan.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg mb-7">
              {([
                { Icon: DollarSign, title: 'Hidden costs by service', sub: 'EC2, RDS, S3 broken down' },
                { Icon: Server, title: 'Idle & orphaned resources', sub: 'Draining your bill silently' },
                { Icon: ShieldCheck, title: 'Safe optimizations', sub: 'Apply instantly, zero risk' },
                { Icon: Tag, title: 'Cost by team & environment', sub: 'Prod, staging, by owner' },
              ] as const).map(({ Icon, title, sub }) => (
                <div key={title} className="bg-slate-50 rounded-xl p-3.5 flex gap-2.5 items-start">
                  <div className="w-5 h-5 bg-violet-100 rounded flex items-center justify-center shrink-0">
                    <Icon size={11} className="text-violet-700" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-900 mb-0.5">{title}</p>
                    <p className="text-[11px] text-slate-500 m-0">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold px-6 py-2.5 rounded-lg border-none cursor-pointer mb-4 transition-colors">
              Connect AWS &amp; scan for waste
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {['Read-only access — no changes made', 'First insights in under 2 minutes', 'Avg savings: 20–40% of AWS spend'].map((text, i) => (
                <span key={text} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  {i > 0 && <span className="text-slate-300">·</span>}
                  <span className="w-1.5 h-1.5 rounded-full bg-green-600 inline-block shrink-0" />
                  {text}
                </span>
              ))}
            </div>
          </div>
        </>

      ) : !hasScanData ? (
        /* ── STATE 2: CONNECTED, NO SCAN ── */
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">AWS Cost Optimization, Powered by Real Usage Data</h1>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xl">Discover savings opportunities across compute, storage, and networking.</p>
            </div>
            <button onClick={handleAIScan} disabled={scanState === 'scanning'} className={`inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-lg border-none whitespace-nowrap transition-colors ${scanState === 'scanning' ? 'bg-violet-500 cursor-not-allowed' : 'bg-violet-700 hover:bg-violet-800 cursor-pointer'}`}>
              {scanState === 'scanning' ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</> : 'Run Cost Optimization Scan →'}
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
            <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200 border-l-[3px] border-l-violet-500">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Monthly Savings</p>
              <div className="text-base font-semibold text-slate-900 mb-1.5">Unlock potential savings</div>
              <p className="text-xs text-slate-400 m-0">Run scan to estimate</p>
            </div>
            {([
              { label: 'Annual Projection', heading: 'Estimate yearly impact', sub: 'Based on usage patterns' },
              { label: 'Total Opportunities', heading: 'Discover optimization actions', sub: 'Across all services' },
              { label: 'Zero-Risk Changes', heading: 'Safe optimizations available', sub: 'No downtime required' },
            ] as const).map(({ label, heading, sub }) => (
              <div key={label} className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                <div className="text-base font-semibold text-slate-900 mb-1.5">{heading}</div>
                <p className="text-xs text-slate-400 m-0">{sub}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden mb-5">
            <div className="p-6 sm:p-10 border-b border-slate-100">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="text-sm font-semibold text-green-600">AWS account connected</span>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed mb-6">
                    Most AWS accounts have <strong className="text-slate-900">20–40% in unused or overprovisioned resources.</strong>
                  </p>
                  <button onClick={handleAIScan} disabled={scanState === 'scanning'} className={`inline-flex items-center gap-2 text-white text-sm font-semibold px-6 py-3 rounded-lg border-none transition-colors ${scanState === 'scanning' ? 'bg-violet-500 cursor-not-allowed' : 'bg-violet-700 hover:bg-violet-800 cursor-pointer'}`}>
                    {scanState === 'scanning' ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Scanning your infrastructure...</> : 'Run Cost Optimization Scan →'}
                  </button>
                  {scanState !== 'scanning' && <p className="text-xs text-slate-400 mt-2.5">Takes ~2 minutes · No changes applied automatically</p>}
                  {scanState === 'scanning' && (
                    <div className="flex flex-wrap items-center gap-2 mt-5">
                      {SCAN_STEPS.map((step, i) => {
                        const isDone = i < scanStep, isActive = i === scanStep;
                        return (
                          <div key={step} className="flex items-center gap-2">
                            {i > 0 && <div className={`w-5 h-px ${isDone ? 'bg-green-500' : 'bg-slate-200'}`} />}
                            <div className="flex items-center gap-1.5">
                              {isDone ? <CheckCircle size={13} className="text-green-500" /> : isActive ? <Loader2 size={13} className="text-violet-600" style={{ animation: 'spin 1s linear infinite' }} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                              <span className={`text-xs ${isDone ? 'text-green-500 font-medium' : isActive ? 'text-slate-900 font-semibold' : 'text-slate-400'}`}>{step}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex gap-3 shrink-0">
                  {([{ value: '20–40%', label: 'Avg savings found' }, { value: '~2 min', label: 'To first insight' }, { value: 'Zero', label: 'Risk to infra' }] as const).map(({ value, label }) => (
                    <div key={label} className="bg-slate-50 rounded-xl px-4 py-3 text-center">
                      <p className="text-lg font-semibold text-slate-900 mb-0.5">{value}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest m-0">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 sm:p-10 bg-slate-50">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3.5">We scan for</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {['Idle and underutilized EC2 instances', 'Overprovisioned RDS and ElastiCache', 'Unused EBS volumes and snapshots', 'Savings plan and reserved instance opportunities', 'Data transfer inefficiencies', 'Orphaned load balancers and unused IPs'].map(item => (
                  <div key={item} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0 mt-1.5" />
                    <span className="text-xs text-slate-500 leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>

      ) : (
        /* ── STATE 3: ACTIVE / DEMO ── */
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">AWS Cost Optimization, Powered by Real Usage Data</h1>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xl">Discover savings opportunities across compute, storage, and networking.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => { if (scanState !== 'scanning') handleAIScan(); }} disabled={scanState === 'scanning'} className={`flex items-center gap-2 bg-white text-slate-500 px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-200 transition-colors whitespace-nowrap ${scanState === 'scanning' ? 'cursor-not-allowed opacity-50' : 'hover:border-slate-300 cursor-pointer'}`}>
                <RefreshCw size={14} /> ↺ Run new scan
              </button>
              <button onClick={() => setShowRiskModal(true)} disabled={approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0} className={`flex items-center gap-2 text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-none transition-colors whitespace-nowrap ${approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0 ? 'bg-violet-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
                {approvingAll ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Approving...</> : <><Zap size={14} /> Approve {zeroRiskCount} zero-risk change{zeroRiskCount !== 1 ? 's' : ''} →</>}
              </button>
            </div>
          </div>

          {zeroRiskCount > 0 && (
            <div className="bg-white border border-slate-200 border-l-[4px] border-l-green-500 rounded-xl p-4 sm:p-5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                  <CheckCircle size={15} className="text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 mb-0.5">{zeroRiskCount} zero-risk change{zeroRiskCount !== 1 ? 's' : ''} ready — no downtime required</p>
                  <p className="text-xs text-slate-500 m-0">Approve now to save ${monthlySavings.toLocaleString()}/mo · fully reversible · takes ~{zeroRiskCount * 2} minutes</p>
                </div>
              </div>
              <button onClick={() => setShowRiskModal(true)} disabled={approvingAll} className="bg-green-600 hover:bg-green-700 text-white border-none rounded-lg px-4 py-2.5 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 transition-colors">
                Approve {zeroRiskCount} changes →
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
            {[
              { label: 'Monthly Savings', value: `$${monthlySavings.toLocaleString()}`, sub: 'AI-identified waste', color: 'text-green-600', borderTop: 'border-t-[3px] border-t-green-500' },
              { label: 'Annual Projection', value: `$${annualSavings.toLocaleString()}`, sub: `$${Math.round(annualSavings / 1000)}k/year if all applied`, color: 'text-green-600', borderTop: '' },
              { label: 'Total Opportunities', value: totalOpportunities, sub: `${displayRecs.filter((r: any) => r.status === 'pending').length} pending · ${zeroRiskCount} zero-risk`, color: 'text-slate-900', borderTop: '' },
              { label: 'Zero-Risk Changes', value: zeroRiskCount, sub: 'No downtime · fully reversible', color: 'text-slate-900', borderTop: '' },
            ].map(({ label, value, sub, color, borderTop }) => (
              <div key={label} className={`bg-white rounded-xl p-4 sm:p-8 border border-slate-200 ${borderTop}`}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${color}`}>{value}</div>
                <p className="text-xs text-slate-500 m-0">{sub}</p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          {(() => {
            const pendingCount = displayRecs.filter((r: any) => r.status === 'pending').length;
            const approvedCount = displayRecs.filter((r: any) => r.status === 'applied' || r.status === 'approved').length;
            const tabLabels: Record<string, string> = { pending: `Pending (${pendingCount})`, approved: `Approved (${approvedCount})`, applied: 'Applied', all: `All (${displayRecs.length})` };
            return (
              <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
                <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5 overflow-x-auto">
                  {(['pending', 'approved', 'applied', 'all'] as const).map(f => (
                    <button key={f} onClick={() => { setFilter(f === 'all' ? '' : f); setShowAll(false); }}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold border-none cursor-pointer transition-all whitespace-nowrap ${(f === 'all' ? filter === '' : filter === f) ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>
                      {tabLabels[f]}
                    </button>
                  ))}
                </div>
                {filteredDisplayRecs.length > 0 && <p className="text-xs text-slate-400 m-0">{filteredDisplayRecs.length} recommendation{filteredDisplayRecs.length !== 1 ? 's' : ''}</p>}
              </div>
            );
          })()}

          {/* Recommendations list */}
          <div className="flex flex-col gap-3">
            {(showAll ? filteredDisplayRecs : filteredDisplayRecs.slice(0, 5)).map((rec: any, index: number) => {
              const isSafe = rec.risk === 'safe', isCaution = rec.risk === 'caution';
              const riskLabel = isSafe ? 'Zero risk' : isCaution ? 'Low risk' : 'Med risk';
              const riskClass = isSafe ? 'bg-green-50 text-green-800 border border-green-200' : isCaution ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-red-50 text-red-800 border border-red-200';
              const isTopPriority = index === 0 && (filter === 'pending' || filter === '') && rec.status === 'pending';
              const isDismissed = rec.status === 'ignored' || rec.status === 'dismissed';
              const compressedDesc = (() => { const d = rec.description ?? ''; const first = d.split(/\.\s+/)[0]; return first.length > 100 ? first.slice(0, 97) + '...' : first + (first.endsWith('.') ? '' : '.'); })();

              return (
                <div key={rec.id}
                  onClick={() => { if (!isDismissed) setSelectedRecommendation(rec); }}
                  className={`bg-white rounded-xl p-5 sm:p-7 border transition-colors ${isDismissed ? 'opacity-50 border-slate-100 cursor-default' : isTopPriority ? 'border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50/30 cursor-pointer' : 'border border-slate-200 hover:border-violet-400 hover:bg-violet-50/30 cursor-pointer'}`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 sm:gap-6 items-start">
                    <div>
                      {isTopPriority && (
                        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">HIGHEST SAVINGS</span>
                          <span className="text-xs text-slate-400">#1 of {filteredDisplayRecs.length} — act on this first</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-slate-900">{rec.title}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${riskClass}`}>{riskLabel}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{rec.service}</span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed mb-2.5">{compressedDesc}</p>
                      <div className="flex flex-wrap gap-2 text-xs text-violet-600">
                        {rec.estimatedTime && <span>⏱ {rec.estimatedTime}</span>}
                        {rec.downtime && <><span className="text-slate-300">·</span><span>{rec.downtime}</span></>}
                        {rec.region && <><span className="text-slate-300">·</span><span className="font-mono">{rec.region}</span></>}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 sm:gap-3">
                      <div className="text-right">
                        <p className="text-xl sm:text-2xl font-bold text-green-600 m-0">${rec.monthlySavings?.toLocaleString()}<span className="text-sm font-medium">/mo</span></p>
                        <p className="text-xs text-slate-400 mt-0.5">${(rec.monthlySavings * 12)?.toLocaleString()}/yr</p>
                      </div>
                      <div className="flex gap-2 flex-wrap justify-end" onClick={e => e.stopPropagation()}>
                        {rec.status === 'applied' || rec.status === 'approved' ? (
                          <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">✓ Approved</span>
                        ) : rec.status === 'ignored' ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full uppercase tracking-wide">Dismissed</span>
                            <button onClick={e => { e.stopPropagation(); handleRestore(rec.id); }} className="bg-transparent border-none text-xs text-violet-600 cursor-pointer font-medium hover:text-violet-800">Restore →</button>
                          </div>
                        ) : (
                          <>
                            <button onClick={() => isSafe ? aiApprove(rec.id) : setSelectedRecommendation(rec)} disabled={actionInProgress.has(rec.id)} className={`flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${isSafe ? 'bg-green-600 hover:bg-green-700 text-white border-transparent' : 'bg-transparent text-violet-600 border-violet-500 hover:bg-violet-50'} ${actionInProgress.has(rec.id) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                              {actionInProgress.has(rec.id) ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                              {isSafe ? 'Approve' : 'Review'}
                            </button>
                            {isEnterprise && (
                              <button onClick={() => handleCreateWorkflow(rec)} disabled={creatingWorkflowFor === rec.id} className="flex items-center gap-1 bg-violet-50 text-violet-600 px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-violet-200 cursor-pointer hover:bg-violet-100 transition-colors">
                                <Wrench size={10} /> Workflow
                              </button>
                            )}
                            <button onClick={() => aiIgnore(rec.id)} disabled={actionInProgress.has(rec.id)} className={`bg-transparent text-slate-500 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-colors ${actionInProgress.has(rec.id) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>Dismiss</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredDisplayRecs.length > 5 && (
              <div className="border-t border-slate-100 pt-4 text-center">
                {!showAll && <p className="text-xs text-slate-400 mb-2.5">Showing 5 of {filteredDisplayRecs.length} recommendations</p>}
                <button onClick={() => setShowAll(v => !v)} className="bg-transparent border-none cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-1 transition-colors">
                  {showAll ? 'Show less ↑' : `Show all ${filteredDisplayRecs.length} recommendations ↓`}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <RecommendationDrawer
        recommendation={selectedRecommendation}
        onClose={() => setSelectedRecommendation(null)}
        onApprove={(id) => { setRecommendations((prev: any[]) => prev.map((r: any) => r.id === id ? { ...r, status: 'approved' } : r)); setSelectedRecommendation(null); toast.success('Recommendation approved'); }}
        onDismiss={(id) => { setRecommendations((prev: any[]) => prev.map((r: any) => r.id === id ? { ...r, status: 'ignored' } : r)); setSelectedRecommendation(null); toast.success('Recommendation dismissed'); }}
      />
    </div>
  );
}