import api from '@/lib/api';

export type ActionType =
  | 'stop_instance'
  | 'rightsize_instance'
  | 'delete_snapshot'
  | 'delete_unattached_volume'
  | 'enable_s3_lifecycle'
  | 'downgrade_rds_instance'
  | 'delete_unused_elasticip';

export type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface RemediationWorkflow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  resource_id: string;
  resource_type: string;
  action_type: ActionType;
  action_params: Record<string, any>;
  estimated_savings: number;
  risk_level: 'low' | 'medium' | 'high';
  status: WorkflowStatus;
  approved_by: string | null;
  approved_by_email: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  executed_by: string | null;
  executed_by_email: string | null;
  executed_by_name: string | null;
  executed_at: string | null;
  completed_at: string | null;
  execution_log: string | null;
  rollback_available: boolean;
  rollback_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
  auditLog?: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  workflow_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_by_name: string | null;
  changed_at: string;
  ip_address: string | null;
  note: string | null;
}

export interface CreateWorkflowPayload {
  recommendationId?: string;
  resourceId: string;
  resourceType: string;
  actionType: ActionType;
  actionParams: Record<string, any>;
  estimatedSavings: number;
  riskLevel: 'low' | 'medium' | 'high';
}

const BASE = '/api/remediation';

export const remediationService = {
  async list(status?: string): Promise<RemediationWorkflow[]> {
    const url = status ? `${BASE}?status=${status}` : BASE;
    const res = await api.get<{ success: boolean; data: RemediationWorkflow[] }>(url);
    return res.data.data;
  },

  async get(id: string): Promise<RemediationWorkflow> {
    const res = await api.get<{ success: boolean; data: RemediationWorkflow }>(`${BASE}/${id}`);
    return res.data.data;
  },

  async create(payload: CreateWorkflowPayload): Promise<RemediationWorkflow> {
    const res = await api.post<{ success: boolean; data: RemediationWorkflow }>(BASE, payload);
    return res.data.data;
  },

  async approve(id: string): Promise<RemediationWorkflow> {
    const res = await api.post<{ success: boolean; data: RemediationWorkflow }>(`${BASE}/${id}/approve`, {});
    return res.data.data;
  },

  async reject(id: string, reason: string): Promise<RemediationWorkflow> {
    const res = await api.post<{ success: boolean; data: RemediationWorkflow }>(`${BASE}/${id}/reject`, { reason });
    return res.data.data;
  },

  async execute(id: string): Promise<RemediationWorkflow> {
    const res = await api.post<{ success: boolean; data: RemediationWorkflow }>(`${BASE}/${id}/execute`, {});
    return res.data.data;
  },

  async rollback(id: string): Promise<RemediationWorkflow> {
    const res = await api.post<{ success: boolean; data: RemediationWorkflow }>(`${BASE}/${id}/rollback`, {});
    return res.data.data;
  },
};
