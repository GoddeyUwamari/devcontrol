'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Zap, Wrench, DollarSign, Server, ShieldCheck, Tag, CheckCircle, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/contexts/auth-context';
import { remediationService } from '@/lib/services/remediation.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import RecommendationDrawer from '@/components/cost-optimization/RecommendationDrawer';

// ── New AI cost optimization API helpers ──────────────────────────────────────
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
  const res = await fetch(`${COST_OPT_BASE}/scan`, {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to start scan');
  const data = await res.json();
  return data.scanId as string;
}

async function pollScanStatus(scanId: string): Promise<{ status: string; opportunityCount: number | null; totalSavings: number | null }> {
  const res = await fetch(`${COST_OPT_BASE}/status/${scanId}`, {
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to poll scan status');
  const data = await res.json();
  return {
    status: data.scan?.status ?? 'running',
    opportunityCount: data.scan?.opportunityCount ?? null,
    totalSavings: data.scan?.totalSavings ?? null,
  };
}

async function loadAIResults(): Promise<any[]> {
  const res = await fetch(`${COST_OPT_BASE}/results`, {
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

function mapAIResultToRec(r: any): any {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    type: 'rightsizing',
    service: r.resourceType || 'AWS',
    resource: r.resourceId || '',
    region: 'us-east-1',
    monthlySavings: parseFloat(r.monthlySavings) || 0,
    annualSavings: parseFloat(r.annualSavings) || 0,
    risk: r.riskLevel === 'Low' ? 'safe' : r.riskLevel === 'Medium' ? 'caution' : 'high',
    effort: 'low',
    estimatedTime: '~2 minutes',
    downtime: r.riskLevel === 'Low' ? 'Zero downtime' : 'Brief restart',
    status: r.status ?? 'pending',
    confidence: 90,
    impactLabel: r.impactLabel,
  };
}

// ── Scan progress stepper ─────────────────────────────────────────────────────
const SCAN_STEPS = [
  'Connecting to AWS',
  'Discovering resources',
  'Analyzing costs',
  'Generating recommendations',
] as const;

type ScanState = 'idle' | 'scanning' | 'complete';

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

  // ── AI scan state ────────────────────────────────────────────────────────────
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

  // Advance visual stepper independently of poll
  const startStepperAnimation = () => {
    setScanStep(0);
    let step = 0;
    const delays = [800, 2200, 4000]; // ms between steps
    stepRef.current = setInterval(() => {
      step++;
      if (step < SCAN_STEPS.length - 1) {
        setScanStep(step);
      } else {
        if (stepRef.current) clearInterval(stepRef.current);
      }
    }, delays[step] ?? 2000);
  };

  const handleAIScan = async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;

    // Clear stale intervals and previous results immediately
    stopPolling();
    setRecommendations([]);
    setSummary(null);
    setScanState('scanning');
    setScanStep(0);
    startStepperAnimation();

    let id: string;
    try {
      id = await startAIScan();
      setScanId(id);
    } catch (err: any) {
      stopPolling();
      setScanState('idle');
      isScanningRef.current = false;
      toast.error(err.message || 'Failed to start scan');
      return;
    }

    // Poll every 3 seconds
    pollRef.current = setInterval(async () => {
      try {
        const { status, opportunityCount, totalSavings } = await pollScanStatus(id);

        if (status === 'complete') {
          stopPolling();
          setScanStep(SCAN_STEPS.length - 1);

          // Brief pause so user sees the final step, then transition
          setTimeout(async () => {
            const raw = await loadAIResults();
            if (raw.length > 0) {
              const mapped = raw.map(mapAIResultToRec);
              setRecommendations(mapped as any);
              setSummary({
                totalRecommendations: mapped.length,
                totalMonthlySavings: mapped.reduce((s: number, r: any) => s + r.monthlySavings, 0),
                totalAnnualSavings: mapped.reduce((s: number, r: any) => s + r.annualSavings, 0),
              } as any);
            }
            setScanState('complete');
            isScanningRef.current = false;
            if (opportunityCount !== null) {
              toast.success(
                `Scan complete — ${opportunityCount} opportunit${opportunityCount !== 1 ? 'ies' : 'y'} found${totalSavings ? `, $${Number(totalSavings).toLocaleString()}/mo in savings` : ''}`,
                { duration: 6000 }
              );
            }
          }, 900);
        } else if (status === 'failed') {
          stopPolling();
          setScanState('idle');
          isScanningRef.current = false;
          toast.error('Scan failed. Please try again.');
        }
      } catch {
        // silently ignore transient poll errors
      }
    }, 3000);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  // Load existing results on mount so a returning user sees data immediately
  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadAIResults().then(raw => {
      if (raw && raw.length > 0) {
        const mapped = raw.map(mapAIResultToRec);
        setRecommendations(mapped);
        const totalSavings = mapped.reduce((s: number, r: any) => s + r.monthlySavings, 0);
        setSummary({
          totalRecommendations: mapped.length,
          totalMonthlySavings: totalSavings,
          totalAnnualSavings: totalSavings * 12,
        });
        setScanState('complete');
      } else {
        setScanState('idle');
      }
      setIsLoading(false);
    }).catch(() => {
      setScanState('idle');
      setIsLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowRiskModal(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const loadRecommendations = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const raw = await loadAIResults();
      const mapped = raw.map(mapAIResultToRec);
      setRecommendations(mapped);
      const totalSavings = mapped.reduce((s: number, r: any) => s + r.monthlySavings, 0);
      setSummary({
        totalRecommendations: mapped.length,
        totalMonthlySavings: totalSavings,
        totalAnnualSavings: totalSavings * 12,
      });
      setScanState(mapped.length > 0 ? 'complete' : 'idle');
    } catch (error: any) {
      setLoadError(error);
      setScanState('idle');
      console.error('Failed to load recommendations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Demo mode and connection/scan state
  const demoModeHook = useDemoMode();
  const salesDemoHook = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoModeHook || salesDemoHook;
  const demoMode = isDemoActive; // backward compat for modal
  const httpStatus: number | undefined = (loadError as any)?.response?.status;
  const isConnected: boolean = isDemoActive ? true : httpStatus !== 401 && httpStatus !== 403;
  const hasScanData: boolean = recommendations?.length > 0 || isDemoActive || scanState === 'complete';

  const DEMO_RECOMMENDATIONS = [
    {
      id: 'demo-1',
      title: 'RDS reserved instance pricing',
      description: 'Switch RDS instances from on-demand to 1-year reserved pricing. Instances have shown 100% utilization for 90 days.',
      type: 'reserved_instance', service: 'RDS', resource: 'rds-prod-01, rds-prod-02',
      region: 'us-east-1', monthlySavings: 890, annualSavings: 10680,
      risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime',
      status: 'pending', confidence: 97,
    },
    {
      id: 'demo-2',
      title: 'Idle RDS instances (3)',
      description: 'Terminate 3 RDS instances with <2% CPU utilization over 30 days. No active connections detected.',
      type: 'idle_resource', service: 'RDS', resource: 'rds-dev-01, rds-staging-02, rds-test-03',
      region: 'us-east-1, us-west-2', monthlySavings: 445, annualSavings: 5340,
      risk: 'safe', effort: 'low', estimatedTime: '5 minutes', downtime: 'Zero downtime',
      status: 'pending', confidence: 94,
    },
    {
      id: 'demo-3',
      title: 'Underloaded EC2 instances (5)',
      description: 'Downsize 5 EC2 instances from t3.large to t3.medium. Average CPU utilization is 12% over 60 days.',
      type: 'rightsizing', service: 'EC2', resource: 'ec2-worker-01, ec2-worker-02',
      region: 'us-east-1', monthlySavings: 362, annualSavings: 4344,
      risk: 'caution', effort: 'medium', estimatedTime: '8 minutes', downtime: 'Brief restart per instance',
      status: 'pending', confidence: 91,
    },
    {
      id: 'demo-4',
      title: 'Unused elastic IPs',
      description: 'Release unused Elastic IPs that are generating idle charges with no associated instances.',
      type: 'idle_resource', service: 'EC2', resource: 'eip-01, eip-02',
      region: 'us-east-1, eu-west-1', monthlySavings: 73, annualSavings: 876,
      risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime',
      status: 'pending', confidence: 99,
    },
    {
      id: 'demo-5',
      title: 'Oversized Lambda functions',
      description: 'Reduce memory allocation for Lambda functions running below 30% of provisioned memory.',
      type: 'rightsizing', service: 'Lambda', resource: 'fn-api-handler, fn-image-processor',
      region: 'us-east-1', monthlySavings: 48, annualSavings: 576,
      risk: 'safe', effort: 'low', estimatedTime: '3 minutes', downtime: 'Zero downtime',
      status: 'pending', confidence: 88,
    },
    {
      id: 'demo-6',
      title: 'Idle NAT gateway',
      description: 'Remove idle NAT gateway processing less than 5GB of traffic per month.',
      type: 'idle_resource', service: 'VPC', resource: 'nat-01a',
      region: 'us-east-1', monthlySavings: 38, annualSavings: 456,
      risk: 'caution', effort: 'low', estimatedTime: '5 minutes', downtime: 'Brief network interruption',
      status: 'pending', confidence: 85,
    },
    {
      id: 'demo-7',
      title: 'S3 incomplete multipart uploads',
      description: 'Add lifecycle rules to abort incomplete multipart uploads older than 7 days.',
      type: 'storage_optimization', service: 'S3', resource: 's3-assets, s3-backups',
      region: 'us-east-1', monthlySavings: 12, annualSavings: 144,
      risk: 'safe', effort: 'low', estimatedTime: '2 minutes', downtime: 'Zero downtime',
      status: 'pending', confidence: 99,
    },
  ];

  const displayRecs = isDemoActive
    ? DEMO_RECOMMENDATIONS.map((r: any) => ({ ...r, status: demoStatusOverrides[r.id] ?? r.status }))
    : (recommendations || []);

  // Client-side filter so rows disappear immediately after approve/dismiss
  // without waiting for a server round-trip
  const filteredDisplayRecs = filter === ''
    ? displayRecs
    : displayRecs.filter((r: any) => {
        if (filter === 'pending')  return r.status === 'pending';
        if (filter === 'approved' || filter === 'applied') return r.status === 'applied' || r.status === 'approved';
        return true;
      });

  const totalOpportunities = isDemoActive
    ? DEMO_RECOMMENDATIONS.length
    : displayRecs.filter((r: any) =>
        r.status !== 'ignored' &&
        r.status !== 'dismissed'
      ).length;
  const monthlySavings = isDemoActive ? 1697 : Math.round(summary?.totalMonthlySavings ?? 0);
  const annualSavings = isDemoActive ? 20364 : Math.round(summary?.totalAnnualSavings ?? 0);
  const zeroRiskCount = displayRecs.filter((r: any) => r.risk === 'safe' && r.status === 'pending').length;

  // ── AI-powered approve / ignore ───────────────────────────────────────────────
  const aiApprove = async (id: string) => {
    if (actionInProgress.has(id)) return;
    if (isDemoActive) {
      setDemoStatusOverrides(prev => ({ ...prev, [id]: 'applied' }));
      toast.success('Recommendation approved');
      return;
    }
    setActionInProgress(prev => new Set([...prev, id]));
    try {
      const res = await fetch(`${COST_OPT_BASE}/apply/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to approve');
      setRecommendations(prev => prev.map((r: any) => r.id === id ? { ...r, status: 'applied' } : r) as any);
      toast.success('Recommendation approved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    } finally {
      setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const aiIgnore = async (id: string) => {
    if (actionInProgress.has(id)) return;
    if (isDemoActive) {
      setDemoStatusOverrides(prev => ({ ...prev, [id]: 'ignored' }));
      toast.success('Recommendation dismissed');
      return;
    }
    setActionInProgress(prev => new Set([...prev, id]));
    try {
      const res = await fetch(`${COST_OPT_BASE}/ignore/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to dismiss');
      setRecommendations(prev => prev.map((r: any) => r.id === id ? { ...r, status: 'ignored' } : r) as any);
      toast.success('Recommendation dismissed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to dismiss');
    } finally {
      setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleApproveAllClick = () => setShowRiskModal(true);

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
        await Promise.all(
          pendingLowRisk.map((r: any) =>
            fetch(`${COST_OPT_BASE}/apply/${r.id}`, {
              method: 'POST',
              credentials: 'include',
              headers: getAuthHeaders(),
            })
          )
        );
        const approvedIds = new Set(pendingLowRisk.map((r: any) => r.id));
        setRecommendations(prev =>
          prev.map((r: any) => approvedIds.has(r.id) ? { ...r, status: 'applied' } : r) as any
        );
      }
      setShowRiskModal(false);
      toast.success(`${pendingLowRisk.length} change${pendingLowRisk.length !== 1 ? 's' : ''} approved`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve all');
    } finally {
      setApprovingAll(false);
    }
  };

  const handleRunScan = () => { if (scanState !== 'scanning') handleAIScan(); };
  const handleApprove = (id: string) => aiApprove(id);
  const handleDismiss = (id: string) => aiIgnore(id);

  const handleRestore = (id: string) => {
    if (isDemoActive) {
      setDemoStatusOverrides(prev => ({ ...prev, [id]: 'pending' }));
      toast.success('Recommendation restored');
      return;
    }
    setRecommendations(prev =>
      prev.map((r: any) => r.id === id ? { ...r, status: 'pending' } : r)
    );
    toast.success('Recommendation restored');
  };

  const handleCreateWorkflow = async (rec: any) => {
    setCreatingWorkflowFor(rec.id);
    try {
      const actionTypeMap: Record<string, string> = {
        rightsizing:          'rightsize_instance',
        idle_resource:        'stop_instance',
        storage_optimization: 'enable_s3_lifecycle',
        reserved_instance:    'stop_instance',
      };
      await remediationService.create({
        recommendationId: rec.id,
        resourceId: rec.resource?.split(',')[0]?.trim() || rec.id,
        resourceType: rec.service?.toLowerCase() || 'ec2',
        actionType: (actionTypeMap[rec.type] || 'stop_instance') as any,
        actionParams: { region: 'us-east-1' },
        estimatedSavings: rec.monthlySavings || 0,
        riskLevel: rec.risk === 'safe' ? 'low' : rec.risk === 'caution' ? 'medium' : 'high',
      });
      toast.success('Remediation workflow created');
      router.push('/remediation');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create workflow');
    } finally {
      setCreatingWorkflowFor(null);
    }
  };

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* RISK ASSESSMENT MODAL */}
      {showRiskModal && (
        <div
          onClick={() => setShowRiskModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '24px',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '20px',
              maxWidth: '560px', width: '100%',
              maxHeight: '80vh',
              boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
              position: 'relative',
              display: 'flex', flexDirection: 'column',
            }}>

            {/* ── Fixed header ─────────────────────────────────────────── */}
            <div style={{ padding: '32px 40px 20px', flexShrink: 0 }}>
              {/* X close button */}
              <button
                onClick={() => setShowRiskModal(false)}
                style={{
                  position: 'absolute', top: '16px', right: '16px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#94A3B8', padding: '4px', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <X size={18} />
              </button>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                Review Changes Before Approving
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                {displayRecs.filter((r: any) => r.status === 'pending').length} changes identified · <span style={{ color: '#059669', fontWeight: 600 }}>${monthlySavings.toLocaleString()}/mo savings</span> · Est. {demoMode ? '15 minutes' : 'varies'} total
              </p>
            </div>

            {/* ── Scrollable change list ────────────────────────────────── */}
            <div style={{ overflowY: 'auto', padding: '4px 40px 20px', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(demoMode ? DEMO_RECOMMENDATIONS : displayRecs.filter((r: any) => r.status === 'pending')).map((rec: any) => (
                  <div key={rec.id} style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    background: rec.risk === 'safe' ? '#F0FDF4' : '#FFFBEB',
                    border: `1px solid ${rec.risk === 'safe' ? '#BBF7D0' : '#FDE68A'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px' }}>{rec.risk === 'safe' ? '✅' : '⚠️'}</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{rec.title}</span>
                      </div>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#059669', flexShrink: 0 }}>
                        ${rec.monthlySavings.toLocaleString()}/mo
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', paddingLeft: '22px' }}>
                      <span style={{ fontSize: '0.75rem', color: rec.risk === 'safe' ? '#059669' : '#D97706', fontWeight: 500 }}>
                        {rec.downtime}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>·</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{rec.estimatedTime}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>·</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', fontFamily: 'monospace' }}>{rec.resource?.split(',')[0]}{rec.resource?.includes(',') ? '...' : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Fixed footer ─────────────────────────────────────────── */}
            <div style={{ padding: '16px 40px 32px', flexShrink: 0, borderTop: '1px solid #F1F5F9' }}>
              {/* Risk summary */}
              <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Overall Risk</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#D97706', margin: 0 }}>Low · 3 zero-risk, 1 requires brief restart</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Annual Impact</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#059669', margin: 0 }}>${annualSavings.toLocaleString()}</p>
                </div>
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowRiskModal(false)}
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, color: '#475569', background: '#fff', border: '1px solid #E2E8F0', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={handleConfirmApproveAll}
                  disabled={approvingAll}
                  style={{ flex: 2, padding: '12px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, color: '#fff', background: approvingAll ? '#A78BFA' : '#7C3AED', border: 'none', cursor: approvingAll ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {approvingAll ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Approving...</> : 'Approve All Changes →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LOADING STATE ────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '2px solid #EDE9FE', borderBottomColor: '#7C3AED', animation: 'spin 0.75s linear infinite' }} />
        </div>

      ) : !isConnected ? (
      /* ── STATE 1: NOT CONNECTED ─────────────────────────────────── */
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                Find hidden AWS costs in minutes
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                Connect your AWS account to uncover wasted spend, over-provisioned resources, and cost risks — before they hit your bill.
              </p>
            </div>
            <button style={{ background: '#534AB7', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Connect AWS &amp; scan for waste
            </button>
          </div>

          <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '48px 40px' }}>
            <p style={{ fontSize: '20px', fontWeight: 500, color: '#0F172A', margin: '0 0 12px' }}>
              Your AWS account isn&apos;t connected yet
            </p>
            <p style={{ fontSize: '14px', color: '#475569', maxWidth: '520px', lineHeight: 1.6, margin: '0 0 28px' }}>
              Most teams discover 20–40% in wasted cloud spend within their first scan. Connect your account to see exactly where your money is going.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxWidth: '560px', marginBottom: '28px' }}>
              {([
                { Icon: DollarSign, title: 'Hidden costs by service',    sub: 'EC2, RDS, S3 broken down' },
                { Icon: Server,     title: 'Idle & orphaned resources',  sub: 'Draining your bill silently' },
                { Icon: ShieldCheck,title: 'Safe optimizations',         sub: 'Apply instantly, zero risk' },
                { Icon: Tag,        title: 'Cost by team & environment', sub: 'Prod, staging, by owner' },
              ] as const).map(({ Icon, title, sub }) => (
                <div key={title} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '20px', height: '20px', background: '#EEEDFE', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={11} color="#534AB7" />
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{title}</p>
                    <p style={{ fontSize: '11px', color: '#64748B', margin: 0 }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <button style={{ background: '#534AB7', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '10px 24px', borderRadius: '6px', border: 'none', cursor: 'pointer', display: 'block', marginBottom: '16px' }}>
              Connect AWS &amp; scan for waste
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {(['Read-only access — no changes made', 'First insights in under 2 minutes', 'Avg savings: 20–40% of AWS spend'] as const).map((text, i) => (
                <span key={text} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {i > 0 && <span style={{ color: '#94A3B8', fontSize: '11px', margin: '0 2px' }}>·</span>}
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#3B6D11', display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', color: '#64748B' }}>{text}</span>
                </span>
              ))}
            </div>
          </div>
        </>

      ) : !hasScanData ? (
        /* ── STATE 2: CONNECTED, NO SCAN YET ────────────────────────── */
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                AWS Cost Optimization, Powered by Real Usage Data
              </h1>
              <p style={{ fontSize: '0.9375rem', color: '#475569', margin: 0, lineHeight: 1.6, maxWidth: '640px' }}>
                Discover savings opportunities across compute, storage, and networking with actionable recommendations.
              </p>
            </div>
            <button
              onClick={handleAIScan}
              disabled={scanState === 'scanning'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: scanState === 'scanning' ? '#6D64C8' : '#534AB7',
                color: '#fff', fontSize: '14px', fontWeight: 600,
                padding: '11px 22px', borderRadius: '8px', border: 'none',
                cursor: scanState === 'scanning' ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}>
              {scanState === 'scanning'
                ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</>
                : 'Run Cost Optimization Scan →'}
            </button>
          </div>

          {/* KPI Cards — outcome-driven placeholders */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            <div style={{ background: '#fff', borderRadius: '0 12px 12px 0', padding: '28px 32px', border: '1px solid #E2E8F0', borderLeft: '2px solid #534AB7' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>Monthly Savings</p>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.3, marginBottom: '6px' }}>Unlock potential savings</div>
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>Run scan to estimate</p>
            </div>
            {([
              { label: 'Annual Projection',   heading: 'Estimate yearly impact',        sub: 'Based on usage patterns' },
              { label: 'Total Opportunities', heading: 'Discover optimization actions', sub: 'Across all services' },
              { label: 'Zero-Risk Changes',   heading: 'Safe optimizations available',  sub: 'No downtime required' },
            ] as const).map(({ label, heading, sub }) => (
              <div key={label} style={{ background: '#fff', borderRadius: '12px', padding: '28px 32px', border: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>{label}</p>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.3, marginBottom: '6px' }}>{heading}</div>
                <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* AWS Connected banner + what we scan for */}
          <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '16px', overflow: 'hidden', marginBottom: '20px' }}>

            {/* Top: connected + CTA */}
            <div style={{ padding: '36px 40px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '32px' }}>
                <div style={{ flex: 1 }}>
                  {/* Connected indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22C55E', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#16A34A' }}>AWS account connected</span>
                  </div>

                  {/* Urgency line */}
                  <p style={{ fontSize: '14px', color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>
                    Most AWS accounts have <strong style={{ color: '#0F172A' }}>20–40% in unused or overprovisioned resources.</strong>
                  </p>

                  {/* CTA button */}
                  <button
                    onClick={handleAIScan}
                    disabled={scanState === 'scanning'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      background: scanState === 'scanning' ? '#6D64C8' : '#534AB7',
                      color: '#fff', fontSize: '14px', fontWeight: 600,
                      padding: '12px 24px', borderRadius: '8px', border: 'none',
                      cursor: scanState === 'scanning' ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s',
                    }}>
                    {scanState === 'scanning' ? (
                      <>
                        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                        Scanning your infrastructure...
                      </>
                    ) : (
                      'Run Cost Optimization Scan →'
                    )}
                  </button>

                  {/* Subtext */}
                  {scanState !== 'scanning' && (
                    <p style={{ fontSize: '12px', color: '#94A3B8', margin: '10px 0 0' }}>
                      Takes ~2 minutes · No changes applied automatically
                    </p>
                  )}

                  {/* Progress stepper */}
                  {scanState === 'scanning' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
                      {SCAN_STEPS.map((step, i) => {
                        const isDone = i < scanStep;
                        const isActive = i === scanStep;
                        return (
                          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {i > 0 && (
                              <div style={{
                                width: '20px', height: '1px',
                                background: isDone ? '#22C55E' : '#E2E8F0',
                              }} />
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              {isDone ? (
                                <CheckCircle size={13} color="#22C55E" />
                              ) : isActive ? (
                                <Loader2 size={13} color="#534AB7" style={{ animation: 'spin 1s linear infinite' }} />
                              ) : (
                                <div style={{ width: '13px', height: '13px', borderRadius: '50%', border: '1.5px solid #CBD5E1' }} />
                              )}
                              <span style={{
                                fontSize: '12px',
                                fontWeight: isActive ? 600 : 400,
                                color: isDone ? '#22C55E' : isActive ? '#0F172A' : '#94A3B8',
                              }}>
                                {step}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Right: stat trio */}
                <div style={{ display: 'flex', gap: '16px', flexShrink: 0 }}>
                  {([
                    { value: '20–40%', label: 'Avg savings found' },
                    { value: '~2 min', label: 'To first insight' },
                    { value: 'Zero',   label: 'Risk to infra' },
                  ] as const).map(({ value, label }) => (
                    <div key={label} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '12px 18px', textAlign: 'center' }}>
                      <p style={{ fontSize: '18px', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{value}</p>
                      <p style={{ fontSize: '10px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom: What we scan for */}
            <div style={{ padding: '24px 40px', background: '#FAFAFA' }}>
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>
                We scan for
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 32px' }}>
                {([
                  'Idle and underutilized EC2 instances',
                  'Overprovisioned RDS and ElastiCache',
                  'Unused EBS volumes and snapshots',
                  'Savings plan and reserved instance opportunities',
                  'Data transfer inefficiencies',
                  'Orphaned load balancers and unused IPs',
                ] as const).map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#534AB7', flexShrink: 0, marginTop: '7px' }} />
                    <span style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>

      ) : (
        /* ── STATE 3: ACTIVE / DEMO ──────────────────────────────────── */
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                AWS Cost Optimization, Powered by Real Usage Data
              </h1>
              <p style={{ fontSize: '0.9375rem', color: '#475569', margin: 0, lineHeight: 1.6, maxWidth: '640px' }}>
                Discover savings opportunities across compute, storage, and networking with actionable recommendations.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
              <button onClick={handleRunScan} disabled={scanState === 'scanning'} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: scanState === 'scanning' ? 'not-allowed' : 'pointer', opacity: scanState === 'scanning' ? 0.5 : 1 }}>
                <RefreshCw size={15} /> ↺ Run new scan
              </button>
              <button
                onClick={handleApproveAllClick}
                disabled={approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0 ? '#A78BFA' : '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0 ? 'not-allowed' : 'pointer', opacity: approvingAll || displayRecs.filter((r: any) => r.status === 'pending').length === 0 ? 0.6 : 1 }}>
                {approvingAll ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Approving...</> : <><Zap size={15} /> Approve {zeroRiskCount} zero-risk change{zeroRiskCount !== 1 ? 's' : ''} →</>}
              </button>
            </div>
          </div>

          {/* Decision banner */}
          {zeroRiskCount > 0 && (
            <div style={{
              background: '#fff',
              border: '1px solid #E2E8F0',
              borderLeft: '4px solid #059669',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '32px', height: '32px',
                  borderRadius: '8px',
                  background: '#F0FDF4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <CheckCircle size={15} style={{ color: '#059669' }} />
                </div>
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 2px' }}>
                    {zeroRiskCount} zero-risk change{zeroRiskCount !== 1 ? 's' : ''}{' '}ready — no downtime required
                  </p>
                  <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>
                    Approve now to save ${monthlySavings.toLocaleString()}/mo · fully reversible · takes ~{zeroRiskCount * 2} minutes
                  </p>
                </div>
              </div>
              <button
                onClick={handleApproveAllClick}
                disabled={approvingAll}
                style={{
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '9px 18px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: approvingAll ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Approve {zeroRiskCount} changes →
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0', borderTop: '3px solid #059669' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Monthly Savings</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>${monthlySavings.toLocaleString()}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>AI-identified waste</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Annual Projection</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>${annualSavings.toLocaleString()}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>${Math.round(annualSavings / 1000)}k/year if all applied</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Total Opportunities</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{totalOpportunities}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>{displayRecs.filter((r: any) => r.status === 'pending').length} pending · {zeroRiskCount} zero-risk</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Zero-Risk Changes</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{zeroRiskCount}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>No downtime · fully reversible</p>
            </div>
          </div>

          {/* Filter Tabs */}
          {(() => {
            const pendingCount = displayRecs.filter((r: any) => r.status === 'pending').length;
            const approvedCount = displayRecs.filter((r: any) => r.status === 'applied' || r.status === 'approved').length;
            const tabLabels: Record<string, string> = {
              pending: `Pending (${pendingCount})`,
              approved: `Approved (${approvedCount})`,
              applied: 'Applied',
              all: `All (${displayRecs.length})`,
            };
            return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {(['pending', 'approved', 'applied', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setFilter(f === 'all' ? '' : f); setShowAll(false); }}
                  style={{
                    padding: '7px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: (f === 'all' ? filter === '' : filter === f) ? '#fff' : 'transparent',
                    color: (f === 'all' ? filter === '' : filter === f) ? '#0F172A' : '#64748B',
                    boxShadow: (f === 'all' ? filter === '' : filter === f) ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  {tabLabels[f]}
                </button>
              ))}
            </div>
            {filteredDisplayRecs.length > 0 && (
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
                {filteredDisplayRecs.length} recommendation{filteredDisplayRecs.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
            );
          })()}

          {/* Recommendations */}
          {isLoading && !isDemoActive ? (
            <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
              <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Scanning for opportunities...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(showAll ? filteredDisplayRecs : filteredDisplayRecs.slice(0, 5)).map((rec: any, index: number) => {
                const isSafe = rec.risk === 'safe';
                const isCaution = rec.risk === 'caution';
                const riskLabel = isSafe ? 'Zero risk' : isCaution ? 'Low risk' : 'Med risk';
                const riskStyle = isSafe
                  ? { background: '#EAF3DE', color: '#27500A', border: '0.5px solid #639922' }
                  : isCaution
                  ? { background: '#FAEEDA', color: '#633806', border: '0.5px solid #BA7517' }
                  : { background: '#FCEBEB', color: '#791F1F', border: '0.5px solid #F09595' };

                const isTopPriority =
                  index === 0 &&
                  (filter === 'pending' || filter === '') &&
                  rec.status === 'pending';

                const compressedDesc = (() => {
                  const d = rec.description ?? '';
                  const first = d.split(/\.\s+/)[0];
                  return first.length > 100
                    ? first.slice(0, 97) + '...'
                    : first + (first.endsWith('.') ? '' : '.');
                })();

                const isDismissed = rec.status === 'ignored' || rec.status === 'dismissed';

                return (
                  <div key={rec.id}
                    onClick={() => { if (!isDismissed) setSelectedRecommendation(rec); }}
                    style={{
                      background: isDismissed ? '#F8FAFC' : '#fff',
                      borderRadius: '14px',
                      padding: '24px 28px',
                      border: isDismissed ? '0.5px solid #F1F5F9' : isTopPriority ? '2px solid #E2E8F0' : '0.5px solid #e5e7eb',
                      opacity: isDismissed ? 0.5 : 1,
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: '24px',
                      alignItems: 'start',
                      cursor: isDismissed ? 'default' : 'pointer',
                    }}
                    onMouseEnter={e => {
                      if (!isDismissed) {
                        (e.currentTarget as HTMLDivElement).style.borderColor = '#7C3AED';
                        (e.currentTarget as HTMLDivElement).style.background = '#FAFBFF';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isDismissed) {
                        (e.currentTarget as HTMLDivElement).style.borderColor = isTopPriority ? '#E2E8F0' : '#e5e7eb';
                        (e.currentTarget as HTMLDivElement).style.background = '#fff';
                      }
                    }}>

                    <div>
                      {isTopPriority && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '12px',
                          paddingBottom: '12px',
                          borderBottom: '1px solid #F1F5F9',
                        }}>
                          <span style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            color: '#059669',
                            background: '#F0FDF4',
                            padding: '2px 8px',
                            borderRadius: '100px',
                            letterSpacing: '0.05em',
                          }}>
                            HIGHEST SAVINGS
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                            #1 of {filteredDisplayRecs.length} — act on this first
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{rec.title}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', ...riskStyle }}>
                          {riskLabel}
                        </span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F1F5F9', color: '#475569' }}>
                          {rec.service}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 10px', lineHeight: 1.5 }}>
                        {compressedDesc}
                      </p>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {rec.estimatedTime && <span style={{ color: '#7C3AED', cursor: 'pointer' }} onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline'; (e.target as HTMLElement).style.color = '#5B21B6'; }} onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none'; (e.target as HTMLElement).style.color = '#7C3AED'; }}>⏱ {rec.estimatedTime}</span>}
                        {rec.downtime && <><span style={{ color: '#CBD5E1' }}>·</span><span style={{ color: '#7C3AED', cursor: 'pointer' }} onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline'; (e.target as HTMLElement).style.color = '#5B21B6'; }} onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none'; (e.target as HTMLElement).style.color = '#7C3AED'; }}>{rec.downtime}</span></>}
                        {rec.region && <><span style={{ color: '#CBD5E1' }}>·</span><span style={{ color: '#7C3AED', cursor: 'pointer', fontFamily: 'monospace' }} onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline'; (e.target as HTMLElement).style.color = '#5B21B6'; }} onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none'; (e.target as HTMLElement).style.color = '#7C3AED'; }}>{rec.region}</span></>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669', margin: 0, letterSpacing: '-0.02em' }}>
                          ${rec.monthlySavings?.toLocaleString()}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>/mo</span>
                        </p>
                        <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                          ${(rec.monthlySavings * 12)?.toLocaleString()}/yr
                        </p>
                      </div>

                      {rec.confidence && (
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontSize: '0.7rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Confidence</p>
                          <p style={{ fontSize: '0.875rem', fontWeight: 700, color: rec.confidence >= 90 ? '#27500A' : '#633806', margin: 0 }}>{rec.confidence}%</p>
                        </div>
                      )}

                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {rec.status === 'applied' || rec.status === 'approved' ? (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#16A34A', background: '#F0FDF4', padding: '4px 10px', borderRadius: '4px', border: '1px solid #BBF7D0' }}>
                            ✓ Approved
                          </span>
                        ) : rec.status === 'ignored' ? (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: '6px',
                          }}>
                            <span style={{
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              color: '#94A3B8',
                              background: '#F1F5F9',
                              padding: '3px 10px',
                              borderRadius: '100px',
                              letterSpacing: '0.05em',
                            }}>
                              DISMISSED
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleRestore(rec.id);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                fontSize: '0.72rem',
                                color: '#7C3AED',
                                cursor: 'pointer',
                                padding: '2px 0',
                                fontWeight: 500,
                              }}
                            >
                              Restore →
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => isSafe ? handleApprove(rec.id) : setSelectedRecommendation(rec)}
                              disabled={actionInProgress.has(rec.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', background: isSafe ? '#059669' : 'transparent', color: isSafe ? '#fff' : '#7C3AED', padding: '6px 14px', borderRadius: '7px', fontSize: '0.78rem', fontWeight: 700, border: isSafe ? 'none' : '1px solid #7C3AED', cursor: actionInProgress.has(rec.id) ? 'not-allowed' : 'pointer', opacity: actionInProgress.has(rec.id) ? 0.6 : 1, transition: 'background 0.15s, color 0.15s' }}
                              onMouseEnter={e => { if (!actionInProgress.has(rec.id)) { const el = e.currentTarget; el.style.background = isSafe ? '#047857' : '#F5F3FF'; } }}
                              onMouseLeave={e => { const el = e.currentTarget; el.style.background = isSafe ? '#059669' : 'transparent'; }}>
                              {actionInProgress.has(rec.id) ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                              {isSafe ? 'Approve' : 'Review'}
                            </button>
                            {isEnterprise && (
                              <button
                                onClick={() => handleCreateWorkflow(rec)}
                                disabled={creatingWorkflowFor === rec.id}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F5F3FF', color: '#7C3AED', padding: '6px 14px', borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600, border: '1px solid #DDD6FE', cursor: 'pointer', opacity: creatingWorkflowFor === rec.id ? 0.6 : 1 }}>
                                <Wrench size={11} /> Workflow
                              </button>
                            )}
                            <button
                              onClick={() => handleDismiss(rec.id)}
                              disabled={actionInProgress.has(rec.id)}
                              style={{ background: 'transparent', color: '#6B7280', padding: '6px 12px', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 500, border: '1px solid #D1D5DB', cursor: actionInProgress.has(rec.id) ? 'not-allowed' : 'pointer', opacity: actionInProgress.has(rec.id) ? 0.6 : 1, transition: 'background 0.15s' }}
                              onMouseEnter={e => { if (!actionInProgress.has(rec.id)) e.currentTarget.style.background = '#F9FAFB'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Show more / show less toggle */}
              {filteredDisplayRecs.length > 5 && (
                <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '16px', textAlign: 'center' }}>
                  {!showAll && (
                    <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '0 0 10px' }}>
                      Showing 5 of {filteredDisplayRecs.length} recommendations
                    </p>
                  )}
                  <button
                    onClick={() => setShowAll(v => !v)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#64748B', padding: '4px 12px' }}>
                    {showAll
                      ? 'Show less ↑'
                      : `Show all ${filteredDisplayRecs.length} recommendations ↓`}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Detail drawer */}
      <RecommendationDrawer
        recommendation={selectedRecommendation}
        onClose={() => setSelectedRecommendation(null)}
        onApprove={(id) => {
          setRecommendations((prev: any[]) => prev.map((r: any) => r.id === id ? { ...r, status: 'approved' } : r));
          setSelectedRecommendation(null);
          toast.success('Recommendation approved');
        }}
        onDismiss={(id) => {
          setRecommendations((prev: any[]) => prev.map((r: any) => r.id === id ? { ...r, status: 'ignored' } : r));
          setSelectedRecommendation(null);
          toast.success('Recommendation dismissed');
        }}
      />

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

    </div>
  );
}
