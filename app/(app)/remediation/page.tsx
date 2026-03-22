'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock, Shield, CheckCircle2, XCircle, Play, RotateCcw,
  Clock, AlertTriangle, ChevronRight, X, Loader2, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { remediationService, RemediationWorkflow, WorkflowStatus } from '@/lib/services/remediation.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  stop_instance:             'Stop EC2 Instance',
  rightsize_instance:        'Rightsize EC2 Instance',
  delete_snapshot:           'Delete Snapshot',
  delete_unattached_volume:  'Delete Unattached Volume',
  enable_s3_lifecycle:       'Enable S3 Lifecycle Policy',
  downgrade_rds_instance:    'Downgrade RDS Instance',
  delete_unused_elasticip:   'Release Elastic IP',
};

const STATUS_STYLES: Record<WorkflowStatus, { label: string; bg: string; color: string }> = {
  pending_approval: { label: 'Pending Approval', bg: '#FEF3C7', color: '#D97706' },
  approved:         { label: 'Approved',          bg: '#D1FAE5', color: '#065F46' },
  rejected:         { label: 'Rejected',          bg: '#FEE2E2', color: '#991B1B' },
  executing:        { label: 'Executing…',        bg: '#EDE9FE', color: '#5B21B6' },
  completed:        { label: 'Completed',         bg: '#D1FAE5', color: '#065F46' },
  failed:           { label: 'Failed',            bg: '#FEE2E2', color: '#991B1B' },
  rolled_back:      { label: 'Rolled Back',       bg: '#F3F4F6', color: '#374151' },
};

const RISK_STYLES = {
  low:    { bg: '#D1FAE5', color: '#065F46' },
  medium: { bg: '#FEF3C7', color: '#92400E' },
  high:   { bg: '#FEE2E2', color: '#991B1B' },
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const s = STATUS_STYLES[status] || { label: status, bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: s.bg, color: s.color, letterSpacing: '0.03em' }}>
      {s.label}
    </span>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function WorkflowDetailPanel({
  workflow,
  onClose,
  onApprove,
  onReject,
  onExecute,
  onRollback,
  isActing,
}: {
  workflow: RemediationWorkflow;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
  onRollback: () => void;
  isActing: boolean;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);

  const isHighRisk = workflow.risk_level === 'high';
  const risk = RISK_STYLES[workflow.risk_level] || RISK_STYLES.medium;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        position: 'relative', width: 520, maxWidth: '95vw', height: '100%',
        background: '#fff', boxShadow: '-4px 0 40px rgba(0,0,0,0.12)',
        overflowY: 'auto', padding: '32px 32px 64px',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 4 }}>
              Remediation Workflow
            </p>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#111827', margin: 0 }}>
              {ACTION_LABELS[workflow.action_type] || workflow.action_type}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X style={{ width: 18, height: 18, color: '#9CA3AF' }} />
          </button>
        </div>

        {/* Status + Risk */}
        <div style={{ display: 'flex', gap: 8 }}>
          <StatusBadge status={workflow.status} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: risk.bg, color: risk.color }}>
            {workflow.risk_level.charAt(0).toUpperCase() + workflow.risk_level.slice(1)} Risk
          </span>
          {workflow.rollback_available && (
            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: '#EDE9FE', color: '#5B21B6' }}>
              Rollback Available
            </span>
          )}
        </div>

        {/* High-risk warning */}
        {isHighRisk && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: '0.82rem', color: '#991B1B', margin: 0, lineHeight: 1.6 }}>
              <strong>High-Risk Action.</strong> This modifies live AWS infrastructure and cannot be undone without a rollback snapshot. Verify the resource ID and confirm business impact before executing.
            </p>
          </div>
        )}

        {/* Details grid */}
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '20px 24px' }}>
          {[
            ['Resource ID', <code key="r" style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{workflow.resource_id}</code>],
            ['Resource Type', workflow.resource_type.toUpperCase()],
            ['Estimated Savings', `$${Number(workflow.estimated_savings).toFixed(2)}/mo`],
            ['Action Params', Object.keys(workflow.action_params).length > 0 ?
              <code key="ap" style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                {JSON.stringify(workflow.action_params, null, 2)}
              </code> : '—'
            ],
            ['Requested', fmt(workflow.created_at)],
            ['Approved', workflow.approved_at ? `${fmt(workflow.approved_at)} by ${workflow.approved_by_email || workflow.approved_by}` : '—'],
            ['Executed', workflow.executed_at ? `${fmt(workflow.executed_at)} by ${workflow.executed_by_email || workflow.executed_by}` : '—'],
            ['Completed', fmt(workflow.completed_at)],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', width: 120, flexShrink: 0, paddingTop: 2 }}>
                {label}
              </span>
              <span style={{ fontSize: '0.875rem', color: '#374151' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Execution log */}
        {workflow.execution_log && (
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 8 }}>
              Execution Log
            </p>
            <pre style={{ fontSize: '0.75rem', background: '#111827', color: '#D1D5DB', borderRadius: 8, padding: '16px', overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
              {workflow.execution_log}
            </pre>
          </div>
        )}

        {/* Audit trail */}
        {workflow.auditLog && workflow.auditLog.length > 0 && (
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 12 }}>
              Audit Trail
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {workflow.auditLog.map((entry, i) => (
                <div key={entry.id} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7C3AED', flexShrink: 0, marginTop: 4 }} />
                    {i < workflow.auditLog!.length - 1 && (
                      <div style={{ width: 1, flex: 1, background: '#E5E7EB', margin: '4px 0' }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 16 }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151', margin: '0 0 2px' }}>
                      {entry.note || `Status → ${entry.new_status}`}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: 0 }}>
                      {fmt(entry.changed_at)}{entry.changed_by_email ? ` · ${entry.changed_by_email}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rejection reason */}
        {workflow.status === 'rejected' && workflow.rejection_reason && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#991B1B', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rejection Reason</p>
            <p style={{ fontSize: '0.875rem', color: '#7F1D1D', margin: 0 }}>{workflow.rejection_reason}</p>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Pending approval → approve / reject */}
          {workflow.status === 'pending_approval' && (
            <>
              {showRejectInput ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.875rem', boxSizing: 'border-box' }}
                    placeholder="Rejection reason…"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setShowRejectInput(false)}
                      style={{ flex: 1, padding: '9px', border: '1px solid #E5E7EB', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={onReject}
                      disabled={!rejectReason.trim() || isActing}
                      style={{ flex: 2, padding: '9px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', opacity: (!rejectReason.trim() || isActing) ? 0.6 : 1 }}
                    >
                      Confirm Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    style={{ flex: 1, padding: '10px', border: '1px solid #FCA5A5', borderRadius: 8, background: '#fff', color: '#DC2626', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Reject
                  </button>
                  <button
                    onClick={onApprove}
                    disabled={isActing}
                    style={{ flex: 2, padding: '10px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isActing ? 0.7 : 1 }}
                  >
                    {isActing ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 style={{ width: 14, height: 14 }} />}
                    Approve
                  </button>
                </div>
              )}
            </>
          )}

          {/* Approved → execute */}
          {workflow.status === 'approved' && (
            <>
              {isHighRisk && !confirmExecute ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 16px' }}>
                    <p style={{ fontSize: '0.82rem', color: '#92400E', margin: 0 }}>
                      This is a high-risk action. Check the box below to confirm you understand the impact.
                    </p>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>
                    <input type="checkbox" onChange={(e) => setConfirmExecute(e.target.checked)} />
                    I understand this modifies live infrastructure
                  </label>
                </div>
              ) : null}
              <button
                onClick={onExecute}
                disabled={isActing || (isHighRisk && !confirmExecute)}
                style={{
                  padding: '11px', background: '#7C3AED', color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: (isActing || (isHighRisk && !confirmExecute)) ? 0.6 : 1,
                }}
              >
                {isActing
                  ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Executing…</>
                  : <><Play style={{ width: 14, height: 14 }} /> Execute on AWS</>
                }
              </button>
            </>
          )}

          {/* Completed + rollback available → rollback */}
          {workflow.status === 'completed' && workflow.rollback_available && (
            <button
              onClick={onRollback}
              disabled={isActing}
              style={{ padding: '10px', border: '1px solid #E5E7EB', background: '#fff', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <RotateCcw style={{ width: 14, height: 14 }} />
              Rollback
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabFilter = 'all' | 'pending_approval' | 'approved' | 'completed' | 'failed';

export default function RemediationPage() {
  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === 'enterprise';
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabFilter>('all');
  const [selected, setSelected] = useState<RemediationWorkflow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const queryKey = ['remediation', tab];
  const { data: workflows = [], isLoading, refetch } = useQuery<RemediationWorkflow[]>({
    queryKey,
    queryFn: () => remediationService.list(tab === 'all' ? undefined : tab),
    enabled: isEnterprise,
    refetchInterval: 10000, // poll while executing
  });

  // Fetch full workflow (with audit log) when panel opens
  const { data: detail } = useQuery<RemediationWorkflow>({
    queryKey: ['remediation-detail', selected?.id],
    queryFn: () => remediationService.get(selected!.id),
    enabled: !!selected,
  });

  const panelWorkflow = detail ?? selected;

  const mutate = (fn: () => Promise<RemediationWorkflow>) => async () => {
    if (!panelWorkflow) return;
    setActingId(panelWorkflow.id);
    try {
      const updated = await fn();
      qc.invalidateQueries({ queryKey: ['remediation'] });
      qc.invalidateQueries({ queryKey: ['remediation-detail', updated.id] });
      setSelected(updated);
    } catch (err: any) {
      console.error('[Remediation] action error:', err);
    } finally {
      setActingId(null);
    }
  };

  const handleApprove = mutate(() => remediationService.approve(panelWorkflow!.id));
  const handleReject  = mutate(() => remediationService.reject(panelWorkflow!.id, rejectReason));
  const handleExecute = mutate(() => remediationService.execute(panelWorkflow!.id));
  const handleRollback = mutate(() => remediationService.rollback(panelWorkflow!.id));

  // KPI counts
  const pending   = workflows.filter((w) => w.status === 'pending_approval').length;
  const approved  = workflows.filter((w) => w.status === 'approved').length;
  const completed = workflows.filter((w) => w.status === 'completed').length;
  const savings   = workflows
    .filter((w) => w.status === 'completed')
    .reduce((s, w) => s + Number(w.estimated_savings), 0);

  const TABS: { key: TabFilter; label: string }[] = [
    { key: 'all',              label: 'All' },
    { key: 'pending_approval', label: 'Pending' },
    { key: 'approved',         label: 'Approved' },
    { key: 'completed',        label: 'Completed' },
    { key: 'failed',           label: 'Failed' },
  ];

  // ── Non-enterprise locked state ──────────────────────────────────────────
  if (!isEnterprise) {
    return (
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '40px 56px 64px', background: '#F9FAFB', minHeight: '100vh' }}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C3AED', marginBottom: 6 }}>DevOps</p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: 0 }}>Auto-Remediation Workflows</h1>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '80px 40px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Lock style={{ width: 24, height: 24, color: '#9CA3AF' }} />
          </div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#111827', marginBottom: 10 }}>Enterprise Feature</h2>
          <p style={{ color: '#6B7280', fontSize: '0.9rem', maxWidth: 460, margin: '0 auto 28px', lineHeight: 1.7 }}>
            Auto-Remediation Workflows let your team create, review, approve, and execute infrastructure fixes — with full audit trails and rollback support.
          </p>
          <a href="/settings/billing?upgrade=enterprise" style={{ display: 'inline-block', background: '#7C3AED', color: '#fff', padding: '10px 28px', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            Upgrade to Enterprise
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '40px 56px 64px', background: '#F9FAFB', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C3AED', marginBottom: 6 }}>DevOps · Enterprise</p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>Auto-Remediation Workflows</h1>
          <p style={{ fontSize: '0.875rem', color: '#6B7280', margin: 0 }}>
            Approval-based infrastructure remediation. Every AWS action requires explicit human approval.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E5E7EB', color: '#374151', padding: '9px 16px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer' }}
        >
          <RefreshCw style={{ width: 14, height: 14 }} />
          Refresh
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 28 }}>
        {[
          { label: 'Pending Approval', value: pending,   color: '#D97706', icon: <Clock style={{ width: 18, height: 18, color: '#D97706' }} /> },
          { label: 'Approved',         value: approved,  color: '#16A34A', icon: <CheckCircle2 style={{ width: 18, height: 18, color: '#16A34A' }} /> },
          { label: 'Completed',        value: completed, color: '#111827', icon: <Shield style={{ width: 18, height: 18, color: '#7C3AED' }} /> },
          { label: 'Savings Recovered', value: `$${savings.toFixed(0)}/mo`, color: '#16A34A', icon: null },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '24px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              {icon}
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color, letterSpacing: '-0.03em' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 4, gap: 2 }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '7px 18px', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600,
                border: 'none', cursor: 'pointer',
                background: tab === key ? '#fff' : 'transparent',
                color: tab === key ? '#111827' : '#6B7280',
                boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.78rem', color: '#9CA3AF', margin: 0 }}>
          {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Workflows table */}
      {isLoading ? (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <Loader2 style={{ width: 24, height: 24, color: '#9CA3AF', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: '#6B7280', fontSize: '0.875rem', margin: 0 }}>Loading workflows…</p>
        </div>
      ) : workflows.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '64px 40px', textAlign: 'center' }}>
          <Shield style={{ width: 40, height: 40, color: '#E5E7EB', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>No workflows yet</p>
          <p style={{ fontSize: '0.875rem', color: '#9CA3AF', margin: 0 }}>
            Create remediation workflows from the Cost Optimization page.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 90px 110px 130px 120px 40px', gap: 16, padding: '12px 24px', borderBottom: '1px solid #F3F4F6', background: '#F9FAFB' }}>
            {['Resource', 'Action', 'Risk', 'Est. Savings', 'Status', 'Requested', ''].map((h) => (
              <span key={h} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {workflows.map((wf) => {
            const risk = RISK_STYLES[wf.risk_level] || RISK_STYLES.medium;
            const isExecuting = wf.status === 'executing';
            return (
              <div
                key={wf.id}
                onClick={() => setSelected(wf)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 1.2fr 90px 110px 130px 120px 40px',
                  gap: 16, padding: '16px 24px', borderBottom: '1px solid #F9FAFB',
                  cursor: 'pointer', alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#F9FAFB'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
              >
                <div>
                  <code style={{ fontSize: '0.8rem', color: '#374151', fontFamily: 'monospace' }}>{wf.resource_id}</code>
                  <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: '2px 0 0', textTransform: 'uppercase' }}>{wf.resource_type}</p>
                </div>
                <span style={{ fontSize: '0.82rem', color: '#374151' }}>{ACTION_LABELS[wf.action_type] || wf.action_type}</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: 100, background: risk.bg, color: risk.color, textAlign: 'center' }}>
                  {wf.risk_level.charAt(0).toUpperCase() + wf.risk_level.slice(1)}
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#16A34A' }}>
                  ${Number(wf.estimated_savings).toFixed(0)}/mo
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isExecuting && <Loader2 style={{ width: 12, height: 12, color: '#7C3AED', animation: 'spin 1s linear infinite' }} />}
                  <StatusBadge status={wf.status} />
                </div>
                <span style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>{fmt(wf.created_at)}</span>
                <ChevronRight style={{ width: 16, height: 16, color: '#D1D5DB' }} />
              </div>
            );
          })}
        </div>
      )}

      {/* Detail panel */}
      {panelWorkflow && (
        <WorkflowDetailPanel
          workflow={panelWorkflow}
          onClose={() => { setSelected(null); qc.removeQueries({ queryKey: ['remediation-detail'] }); }}
          onApprove={handleApprove}
          onReject={handleReject}
          onExecute={handleExecute}
          onRollback={handleRollback}
          isActing={actingId === panelWorkflow.id}
        />
      )}
    </div>
  );
}
