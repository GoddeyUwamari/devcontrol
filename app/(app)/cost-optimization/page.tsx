'use client';

import { useState, useEffect } from 'react';
import { optimizationService } from '@/lib/services/optimization.service';
import {
  OptimizationRecommendation,
  OptimizationSummary,
} from '@/types/optimization.types';
import { RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { demoModeService } from '@/lib/services/demo-mode.service';

export default function CostOptimizationPage() {
  const [recommendations, setRecommendations] = useState<OptimizationRecommendation[]>([]);
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);
  const [, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);

  useEffect(() => {
    loadRecommendations();
  }, [filter]);

  const loadRecommendations = async () => {
    setIsLoading(true);
    try {
      const data = await optimizationService.getRecommendations(filter);
      setRecommendations(data.recommendations);
      setSummary(data.summary);
    } catch (error: any) {
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

  // Demo fallback data
  const demoMode = demoModeService.isEnabled();

  const DEMO_RECOMMENDATIONS = [
    {
      id: 'demo-1',
      title: 'RDS Reserved Instance Pricing',
      description: 'Switch 2 RDS instances from on-demand to 1-year reserved pricing. Instances have shown 100% utilization for 90 days.',
      type: 'reserved_instance',
      service: 'RDS',
      resource: 'rds-prod-01, rds-prod-02',
      monthlySavings: 890,
      annualSavings: 10680,
      risk: 'safe',
      effort: 'low',
      estimatedTime: '2 minutes',
      downtime: 'Zero downtime',
      status: 'pending',
      confidence: 98,
    },
    {
      id: 'demo-2',
      title: 'Idle RDS Instances',
      description: 'Terminate 3 RDS instances with less than 2% CPU utilization over the past 30 days. No active connections detected.',
      type: 'idle_resource',
      service: 'RDS',
      resource: 'rds-dev-01, rds-staging-02, rds-test-03',
      monthlySavings: 445,
      annualSavings: 5340,
      risk: 'safe',
      effort: 'low',
      estimatedTime: '5 minutes',
      downtime: 'Zero downtime',
      status: 'pending',
      confidence: 95,
    },
    {
      id: 'demo-3',
      title: 'Underloaded EC2 Instances',
      description: 'Downsize 4 EC2 instances from t3.large to t3.medium. Average CPU utilization is 12% over 60 days.',
      type: 'rightsizing',
      service: 'EC2',
      resource: 'ec2-worker-01, ec2-worker-02, ec2-worker-03, ec2-worker-04',
      monthlySavings: 362,
      annualSavings: 4344,
      risk: 'caution',
      effort: 'medium',
      estimatedTime: '8 minutes',
      downtime: 'Brief restart required per instance',
      status: 'pending',
      confidence: 87,
    },
    {
      id: 'demo-4',
      title: 'Enable S3 Intelligent-Tiering',
      description: 'Enable S3 Intelligent-Tiering on 3 buckets with infrequent access patterns. Automatically moves data to cheaper storage tiers.',
      type: 'storage_optimization',
      service: 'S3',
      resource: 's3-assets, s3-backups, s3-logs',
      monthlySavings: 225,
      annualSavings: 2700,
      risk: 'safe',
      effort: 'low',
      estimatedTime: '3 minutes',
      downtime: 'Zero downtime',
      status: 'pending',
      confidence: 92,
    },
  ];

  const displayRecs = demoMode ? DEMO_RECOMMENDATIONS : (recommendations || []);
  const totalOpportunities = demoMode ? 4 : (summary?.totalRecommendations ?? 0);
  const monthlySavings = demoMode ? 1922 : (summary?.totalMonthlySavings ?? 0);
  const annualSavings = demoMode ? 23064 : (summary?.totalAnnualSavings ?? 0);
  const zeroRiskCount = demoMode ? 3 : displayRecs.filter((r: any) => r.risk === 'safe').length;

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

      {/* PAGE HEADER */}
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
          <button
            onClick={handleRunScan}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <RefreshCw size={15} /> Run New Scan
          </button>
          <button
            onClick={handleApproveAllClick}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <Zap size={15} /> Approve All Changes
          </button>
        </div>
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Opportunities', value: totalOpportunities,                        sub: 'Ready to action',         valueColor: '#0F172A' },
          { label: 'Monthly Savings',     value: `$${monthlySavings.toLocaleString()}`,     sub: 'AI-identified waste',     valueColor: '#059669' },
          { label: 'Annual Projection',   value: `$${annualSavings.toLocaleString()}`,      sub: 'At current run rate',     valueColor: '#059669' },
          { label: 'Zero-Risk Changes',   value: zeroRiskCount,                             sub: 'Safe to apply now',       valueColor: '#059669' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.25rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* FILTER TABS */}
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
        <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
          {displayRecs.length} recommendation{displayRecs.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* RECOMMENDATIONS LIST */}
      {isLoading && !demoMode ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Scanning for opportunities...</p>
        </div>
      ) : displayRecs.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Zap size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No recommendations found</p>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
            Run a scan to discover savings opportunities across your AWS infrastructure.
          </p>
          <button
            onClick={handleRunScan}
            style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            Run First Scan
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {displayRecs.map((rec: any) => {
            const riskColor = rec.risk === 'safe' ? '#059669' : rec.risk === 'caution' ? '#D97706' : '#DC2626';
            const riskBg    = rec.risk === 'safe' ? '#F0FDF4' : rec.risk === 'caution' ? '#FFFBEB' : '#FEF2F2';
            const riskLabel = rec.risk === 'safe' ? 'Zero Risk' : rec.risk === 'caution' ? 'Low Risk' : 'Review Required';
            return (
              <div key={rec.id} style={{ background: '#fff', borderRadius: '14px', padding: '24px 28px', border: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'start' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#E2E8F0'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9'; }}>

                <div>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{rec.title}</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: riskBg, color: riskColor }}>
                      {riskLabel}
                    </span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F1F5F9', color: '#475569' }}>
                      {rec.service}
                    </span>
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
                    {rec.description}
                  </p>

                  {/* Meta row */}
                  <div style={{ display: 'flex', gap: '20px', fontSize: '0.75rem', color: '#64748B' }}>
                    {rec.estimatedTime && <span>⏱ {rec.estimatedTime}</span>}
                    {rec.downtime && <span>· {rec.downtime}</span>}
                    {rec.confidence && <span>· {rec.confidence}% confidence</span>}
                    {rec.resource && <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>· {rec.resource?.split(',')[0]}{rec.resource?.includes(',') ? ', ...' : ''}</span>}
                  </div>
                </div>

                {/* Right side — savings + actions */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669', margin: 0, letterSpacing: '-0.02em' }}>
                      ${rec.monthlySavings?.toLocaleString()}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>/mo</span>
                    </p>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: '2px 0 0' }}>
                      ${(rec.monthlySavings * 12)?.toLocaleString()}/yr
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleApprove(rec.id)}
                      style={{ background: '#7C3AED', color: '#fff', padding: '7px 16px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                      Approve
                    </button>
                    <button
                      onClick={() => handleDismiss(rec.id)}
                      style={{ background: 'none', color: '#475569', padding: '7px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
