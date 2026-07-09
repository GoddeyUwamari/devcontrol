import api, { handleApiResponse } from '../api';

export type AccountFindingCategory = 'networking' | 'iam';
export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';

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
  created_at: string;
  updated_at: string;
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
};
