// Authentication: uses the shared `api` Axios client from lib/api.ts, whose request
// interceptor injects `Authorization: Bearer <accessToken>` -- the same mechanism
// security-hub.service.ts and every other authenticated frontend service use. The
// backend's authenticateToken middleware only ever reads the Authorization header,
// never cookies, so this service must not rely on a bespoke or cookie-credentialed
// request mechanism (raw fetch + credentials:'include', as this file previously did,
// sends no Authorization header at all and 401s against the real backend).
import { api } from '@/lib/api';
import axios from 'axios';

export interface ComplianceFramework {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  framework_type: 'built_in' | 'custom';
  enabled: boolean;
  is_default: boolean;
  standard_name: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
}

// V1 rule vocabulary only. 'relationship_check' (never implemented by the
// backend evaluator) and 'custom_script' (removed as a Phase 1 security
// foundation requirement -- it executed customer-authored JavaScript via an
// unsandboxed `new Function(...)` server-side) are deliberately excluded.
export type ComplianceRuleType = 'property_check' | 'tag_required' | 'tag_pattern' | 'metadata_check';

export interface ComplianceFrameworkRule {
  id: string;
  framework_id: string;
  rule_code: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'encryption' | 'backups' | 'public_access' | 'tagging' | 'iam' | 'networking' | 'custom';
  rule_type: ComplianceRuleType;
  conditions: Record<string, any>;
  resource_types: string[];
  recommendation: string;
  remediation_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ComplianceScan {
  id: string;
  organization_id: string;
  framework_id: string;
  scan_type: 'manual' | 'scheduled' | 'continuous';
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_resources: number;
  compliant_resources: number;
  non_compliant_resources: number;
  compliance_score: number | null;
  critical_issues: number;
  high_issues: number;
  medium_issues: number;
  low_issues: number;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface ComplianceScanFinding {
  id: string;
  resource_id: string;
  resource_arn: string;
  resource_type: string;
  resource_name: string | null;
  status: 'pass' | 'fail' | 'error' | 'skip';
  severity: string;
  category: string;
  issue: string | null;
  recommendation: string | null;
  remediated: boolean;
}

export interface CreateFrameworkRequest {
  name: string;
  description?: string;
  // 'built_in' is not accepted through this API -- customer-authored
  // frameworks are always custom. See checkFrameworkBrandingViolation in
  // backend/src/controllers/compliance-frameworks.controller.ts.
  framework_type?: 'custom';
  is_default?: boolean;
}

export interface CreateRuleRequest {
  rule_code: string;
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'encryption' | 'backups' | 'public_access' | 'tagging' | 'iam' | 'networking' | 'custom';
  rule_type: ComplianceRuleType;
  conditions: Record<string, any>;
  resource_types?: string[];
  recommendation: string;
  remediation_url?: string;
  enabled?: boolean;
}

/**
 * Adapts an Axios failure into an Error whose `message` is the backend's own `error`
 * string -- preserving this service's pre-existing error contract
 * (`error.error || fallbackMessage`) exactly, just sourced from `error.response.data`
 * instead of a manually-parsed fetch Response body. Anything without a usable string
 * message (network failure, non-JSON body, non-Axios error) gets the fallback.
 */
function toComplianceFrameworksApiError(error: unknown, fallbackMessage: string): Error {
  let message = fallbackMessage;
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | null | undefined;
    if (typeof data?.error === 'string' && data.error.length > 0) {
      message = data.error;
    }
  }
  return new Error(message);
}

class ComplianceFrameworksService {
  private readonly basePath = '/api/compliance-frameworks';

  async getFrameworks(): Promise<ComplianceFramework[]> {
    try {
      const response = await api.get(this.basePath);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to fetch frameworks');
    }
  }

  async getFramework(id: string): Promise<{ framework: ComplianceFramework; rules: ComplianceFrameworkRule[] }> {
    try {
      const response = await api.get(`${this.basePath}/${id}`);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to fetch framework');
    }
  }

  async createFramework(framework: CreateFrameworkRequest): Promise<ComplianceFramework> {
    try {
      const response = await api.post(this.basePath, framework);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to create framework');
    }
  }

  async updateFramework(id: string, updates: Partial<CreateFrameworkRequest & { enabled: boolean }>): Promise<ComplianceFramework> {
    try {
      const response = await api.put(`${this.basePath}/${id}`, updates);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to update framework');
    }
  }

  async deleteFramework(id: string): Promise<void> {
    try {
      await api.delete(`${this.basePath}/${id}`);
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to delete framework');
    }
  }

  async createRule(frameworkId: string, rule: CreateRuleRequest): Promise<ComplianceFrameworkRule> {
    try {
      const response = await api.post(`${this.basePath}/${frameworkId}/rules`, rule);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to create rule');
    }
  }

  async updateRule(ruleId: string, updates: Partial<CreateRuleRequest>): Promise<ComplianceFrameworkRule> {
    try {
      const response = await api.put(`${this.basePath}/rules/${ruleId}`, updates);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to update rule');
    }
  }

  async deleteRule(ruleId: string): Promise<void> {
    try {
      await api.delete(`${this.basePath}/rules/${ruleId}`);
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to delete rule');
    }
  }

  async executeScan(frameworkId: string, resourceFilters?: Record<string, any>): Promise<void> {
    try {
      await api.post(`${this.basePath}/${frameworkId}/scan`, { resource_filters: resourceFilters });
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to execute scan');
    }
  }

  async getScans(limit?: number): Promise<ComplianceScan[]> {
    const url = `${this.basePath}/scans/list${limit ? `?limit=${limit}` : ''}`;
    try {
      const response = await api.get(url);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to fetch scans');
    }
  }

  async getScanResults(scanId: string): Promise<{ scan: ComplianceScan; findings: ComplianceScanFinding[] }> {
    try {
      const response = await api.get(`${this.basePath}/scans/${scanId}`);
      return response.data.data;
    } catch (error) {
      throw toComplianceFrameworksApiError(error, 'Failed to fetch scan results');
    }
  }
}

export const complianceFrameworksService = new ComplianceFrameworksService();
