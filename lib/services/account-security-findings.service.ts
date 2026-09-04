import api, { handleApiResponse } from '../api';

export type AccountFindingCategory = 'networking' | 'iam';
export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AccountFindingDisposition = 'acknowledged' | 'dismissed' | 'accepted_risk';
export type DerivedFindingStatus = 'active' | 'resolved' | AccountFindingDisposition;

export interface SecurityGroupEvidence {
  schema_version: 1;
  security_group_id: string;
  security_group_name: string;
  vpc_id?: string;
  region: string;
  direction: 'ingress' | 'egress';
  protocol: string;
  from_port: number;
  to_port: number;
  ip_version: 'v4' | 'v6';
  cidr: string;
  detected_at: string;
}

export interface FrameworkMapping {
  framework: string;
  version: string;
  control: string;
  title: string;
  securityHubControlId: string;
}

export interface AccountSecurityFinding {
  id: string;
  organization_id: string;
  finding_key: string;
  category: AccountFindingCategory;
  severity: ComplianceSeverity;
  title: string;
  recommendation: string;
  resource_identifier: string;
  region: string | null;
  status: 'active' | 'resolved';
  detected_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  disposition: AccountFindingDisposition | null;
  disposition_actor_id: string | null;
  disposition_at: string | null;
  disposition_note: string | null;
  evidence: SecurityGroupEvidence | null;
  created_at: string;
  updated_at: string;
  /** Read-time projection — RESOLVED means AWS-verified absence, never a user disposition. */
  derived_status: DerivedFindingStatus;
  /** The one verified compliance-control mapping for this finding, if any applies. */
  framework_mapping: FrameworkMapping | null;
}

export interface AccountFindingStats {
  total: number;
  bySeverity: Record<ComplianceSeverity, number>;
  byCategory: Record<AccountFindingCategory, number>;
}

export const accountSecurityFindingsService = {
  /**
   * Get active account-level security findings (security groups, IAM)
   */
  getActive: async (params?: {
    category?: AccountFindingCategory;
    severity?: ComplianceSeverity;
    limit?: number;
  }): Promise<AccountSecurityFinding[]> => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();

    const response = await api.get(`/api/security/account-findings${qs ? `?${qs}` : ''}`);
    return handleApiResponse(response);
  },

  /**
   * Get active-finding counts by severity and category
   */
  getStats: async (): Promise<AccountFindingStats> => {
    const response = await api.get('/api/security/account-findings/stats');
    return handleApiResponse(response);
  },

  /**
   * Records that a user has seen this finding. Does not change AWS infrastructure
   * or the finding's system-owned observation status — only a later scan proving
   * absence can move it to "Verified Resolved."
   */
  acknowledge: async (id: string): Promise<AccountSecurityFinding> => {
    return dispositionRequest(id, 'acknowledge', undefined);
  },

  /** Requires a non-empty note justifying the dismissal. */
  dismiss: async (id: string, note: string): Promise<AccountSecurityFinding> => {
    return dispositionRequest(id, 'dismiss', note);
  },

  /** Requires a non-empty note justifying accepting the risk. */
  acceptRisk: async (id: string, note: string): Promise<AccountSecurityFinding> => {
    return dispositionRequest(id, 'accept-risk', note);
  },
};

async function dispositionRequest(
  id: string,
  action: 'acknowledge' | 'dismiss' | 'accept-risk',
  note: string | undefined
): Promise<AccountSecurityFinding> {
  try {
    const response = await api.post(`/api/security/account-findings/${id}/${action}`, note ? { note } : {});
    return handleApiResponse(response);
  } catch (error: any) {
    throw new Error(error.response?.data?.error || error.message || `Failed to ${action.replace('-', ' ')} finding`);
  }
}
