'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { optimizationService } from '@/lib/services/optimization.service';
import {
  OptimizationRecommendation,
  OptimizationSummary,
} from '@/types/optimization.types';
import { RefreshCw, Zap, Wrench, DollarSign, Server, ShieldCheck, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/contexts/auth-context';
import { remediationService } from '@/lib/services/remediation.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

export default function CostOptimizationPage() {
  const router = useRouter();
  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === 'enterprise';
  const [creatingWorkflowFor, setCreatingWorkflowFor] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<OptimizationRecommendation[]>([]);
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);
  const [, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [loadError, setLoadError] = useState<any>(null);

  useEffect(() => {
    loadRecommendations();
  }, [filter]);

  const loadRecommendations = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await optimizationService.getRecommendations(filter);
      setRecommendations(data.recommendations);
      setSummary(data.summary);
    } catch (error: any) {
      setLoadError(error);
      console.error('Failed to load recommendations:', error);
      toast.error('Failed to load recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  const runScan = async () => {
    setIsScanning(true);
    try {
      const data = await optimizationService.scan();
      setRecommendations(data.recommendations);
      setSummary(data.summary);
      toast.success(
        `Found ${data.recommendations.length} optimization opportunities! Potential savings: $${data.summary.totalMonthlySavings.toFixed(2)}/month`,
        { duration: 5000 }
      );
    } catch (error: any) {
      console.error('Scan failed:', error);
      toast.error(error.message || 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const updateStatus = async (id: string, status: 'approved' | 'applied' | 'dismissed') => {
    try {
      await optimizationService.updateStatus(id, status);
      toast.success(`Recommendation ${status}`);
      loadRecommendations();
    } catch (error: any) {
      console.error('Failed to update status:', error);
      toast.error('Failed to update status');
    }
  };

  // Demo mode and connection/scan state
  const demoModeHook = useDemoMode();
  const salesDemoHook = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoModeHook || salesDemoHook;
  const demoMode = isDemoActive; // backward compat for modal
  const httpStatus: number | undefined = (loadError as any)?.response?.status;
  const isConnected: boolean = isDemoActive ? true : httpStatus !== 401 && httpStatus !== 403;
  const hasScanData: boolean = recommendations?.length > 0 || isDemoActive;

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

  const displayRecs = isDemoActive ? DEMO_RECOMMENDATIONS : (recommendations || []);
  const totalOpportunities = isDemoActive ? 7 : (summary?.totalRecommendations ?? 0);
  const monthlySavings = isDemoActive ? 1697 : (summary?.totalMonthlySavings ?? 0);
  const annualSavings = isDemoActive ? 20364 : (summary?.totalAnnualSavings ?? 0);
  const zeroRiskCount = isDemoActive ? 4 : displayRecs.filter((r: any) => r.risk === 'safe').length;

  const handleApproveAllClick = () => setShowRiskModal(true);

  const handleConfirmApproveAll = async () => {
    setApprovingAll(true);
    try {
      setShowRiskModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setApprovingAll(false);
    }
  };

  const handleRunScan = () => runScan();
  const handleApprove = (id: string) => updateStatus(id, 'approved');
  const handleDismiss = (id: string) => updateStatus(id, 'dismissed');

  const handleCreateWorkflow = async (rec: any) => {
    setCreatingWorkflowFor(rec.id);
    try {
      // Map recommendation type to action type
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '24px',
        }}>
          <div style={{
            background: '#fff', borderRadius: '20px', padding: '40px',
            maxWidth: '560px', width: '100%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          }}>
            {/* Modal header */}
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                Review Changes Before Approving
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                {displayRecs.filter((r: any) => r.status === 'pending').length} changes identified · <span style={{ color: '#059669', fontWeight: 600 }}>${monthlySavings.toLocaleString()}/mo savings</span> · Est. {demoMode ? '15 minutes' : 'varies'} total
              </p>
            </div>

            {/* Change list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
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

            {/* Overall risk summary */}
            <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px 16px', marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Overall Risk</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#D97706', margin: 0 }}>Low · 3 zero-risk, 1 requires brief restart</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Annual Impact</p>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#059669', margin: 0 }}>${annualSavings.toLocaleString()}</p>
              </div>
            </div>

            {/* Modal actions */}
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
                {approvingAll ? <><RefreshCw size={14} /> Applying...</> : 'Approve All Changes →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STATE 1: NOT CONNECTED ─────────────────────────────────── */}
      {!isConnected ? (
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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                Cost Optimization
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                AI-powered savings recommendations for your AWS infrastructure
              </p>
            </div>
            <button onClick={handleRunScan} style={{ background: '#534AB7', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Run your first scan →
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            <div style={{ background: '#fff', borderRadius: '0 12px 12px 0', padding: '32px', border: '1px solid #E2E8F0', borderLeft: '2px solid #534AB7' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Monthly Savings</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>—</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>Run a scan to unlock</p>
            </div>
            {([
              { label: 'Annual Projection',   sub: 'If all applied' },
              { label: 'Total Opportunities', sub: 'Pending first scan' },
              { label: 'Zero-Risk Changes',   sub: 'Safe to apply now' },
            ] as const).map(({ label, sub }) => (
              <div key={label} style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
                <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>—</div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>{sub}</p>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '32px' }}>
            <div>
              <p style={{ fontSize: '16px', fontWeight: 500, color: '#0F172A', margin: '0 0 6px' }}>Your AWS account is connected</p>
              <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, margin: '0 0 16px', maxWidth: '420px' }}>
                Run your first scan to discover savings opportunities across all your AWS resources. Most teams find savings within the first 2 minutes.
              </p>
              <button onClick={handleRunScan} style={{ background: '#534AB7', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '10px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>
                Run your first scan →
              </button>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexShrink: 0 }}>
              {([
                { value: '20–40%', label: 'Avg savings found' },
                { value: '<2 min', label: 'First insights' },
                { value: 'Zero',  label: 'Risk to infra' },
              ] as const).map(({ value, label }) => (
                <div key={label} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 16px', textAlign: 'center' }}>
                  <p style={{ fontSize: '18px', fontWeight: 500, color: '#0F172A', margin: '0 0 2px' }}>{value}</p>
                  <p style={{ fontSize: '10px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </>

      ) : (
        /* ── STATE 3: ACTIVE / DEMO ──────────────────────────────────── */
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                Cost Optimization
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                AI-powered savings recommendations for your AWS infrastructure
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleRunScan} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
                <RefreshCw size={15} /> ↺ Run new scan
              </button>
              <button
                onClick={handleApproveAllClick}
                disabled={displayRecs.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: displayRecs.length === 0 ? '#A78BFA' : '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: displayRecs.length === 0 ? 'not-allowed' : 'pointer', opacity: displayRecs.length === 0 ? 0.6 : 1 }}>
                <Zap size={15} /> ⚡ Approve all changes
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            <div style={{ background: '#fff', borderRadius: '0 12px 12px 0', padding: '32px', border: '1px solid #E2E8F0', borderLeft: '2px solid #534AB7' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Monthly Savings</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#3B6D11', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>${monthlySavings.toLocaleString()}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>AI-identified waste</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Annual Projection</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#3B6D11', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>${annualSavings.toLocaleString()}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>If all recommendations applied</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Total Opportunities</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{totalOpportunities}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>Ready to action</p>
            </div>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Zero-Risk Changes</p>
              <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{zeroRiskCount}</div>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>Safe to apply now</p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {(['pending', 'approved', 'applied', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f === 'all' ? '' : f)}
                  style={{
                    padding: '7px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
                    background: (f === 'all' ? filter === '' : filter === f) ? '#fff' : 'transparent',
                    color: (f === 'all' ? filter === '' : filter === f) ? '#0F172A' : '#64748B',
                    boxShadow: (f === 'all' ? filter === '' : filter === f) ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {displayRecs.length > 0 && (
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
                {displayRecs.length} recommendation{displayRecs.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Recommendations */}
          {isLoading && !isDemoActive ? (
            <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
              <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Scanning for opportunities...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {displayRecs.map((rec: any) => {
                const isSafe = rec.risk === 'safe';
                const isCaution = rec.risk === 'caution';
                const riskLabel = isSafe ? 'Zero risk' : isCaution ? 'Low risk' : 'Med risk';
                const riskStyle = isSafe
                  ? { background: '#EAF3DE', color: '#27500A', border: '0.5px solid #639922' }
                  : isCaution
                  ? { background: '#FAEEDA', color: '#633806', border: '0.5px solid #BA7517' }
                  : { background: '#FCEBEB', color: '#791F1F', border: '0.5px solid #F09595' };

                return (
                  <div key={rec.id}
                    style={{ background: '#fff', borderRadius: '14px', padding: '24px 28px', border: '0.5px solid #e5e7eb', display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'start' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#7C3AED'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb'; }}>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{rec.title}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', ...riskStyle }}>
                          {riskLabel}
                        </span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F1F5F9', color: '#475569' }}>
                          {rec.service}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
                        {rec.description}
                      </p>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem', color: '#64748B', flexWrap: 'wrap' }}>
                        {rec.estimatedTime && <span>⏱ {rec.estimatedTime}</span>}
                        {rec.downtime && <span>· {rec.downtime}</span>}
                        {rec.region && <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>· {rec.region}</span>}
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

                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => isSafe ? handleApprove(rec.id) : undefined}
                          style={{ background: '#EEEDFE', color: '#534AB7', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                          {isSafe ? 'Approve' : 'Review'}
                        </button>
                        {isEnterprise && (
                          <button
                            onClick={() => handleCreateWorkflow(rec)}
                            disabled={creatingWorkflowFor === rec.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F5F3FF', color: '#7C3AED', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, border: '1px solid #DDD6FE', cursor: 'pointer', opacity: creatingWorkflowFor === rec.id ? 0.6 : 1 }}>
                            <Wrench size={11} /> Workflow
                          </button>
                        )}
                        <button
                          onClick={() => handleDismiss(rec.id)}
                          style={{ background: 'none', color: '#475569', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

    </div>
  );
}
