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

export interface ComplianceFrameworkRule {
  id: string;
  framework_id: string;
  rule_code: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'encryption' | 'backups' | 'public_access' | 'tagging' | 'iam' | 'networking' | 'custom';
  rule_type: 'property_check' | 'tag_required' | 'tag_pattern' | 'metadata_check' | 'relationship_check' | 'custom_script';
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
  framework_type?: 'built_in' | 'custom';
  is_default?: boolean;
}

export interface CreateRuleRequest {
  rule_code: string;
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'encryption' | 'backups' | 'public_access' | 'tagging' | 'iam' | 'networking' | 'custom';
  rule_type: 'property_check' | 'tag_required' | 'tag_pattern' | 'metadata_check' | 'relationship_check' | 'custom_script';
  conditions: Record<string, any>;
  resource_types?: string[];
  recommendation: string;
  remediation_url?: string;
  enabled?: boolean;
}

class ComplianceFrameworksService {
  private baseUrl = '/api/compliance-frameworks';

  async getFrameworks(): Promise<ComplianceFramework[]> {
    const response = await fetch(this.baseUrl, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch frameworks' }));
      throw new Error(error.error || 'Failed to fetch frameworks');
    }

    const data = await response.json();
    return data.data;
  }

  async getFramework(id: string): Promise<{ framework: ComplianceFramework; rules: ComplianceFrameworkRule[] }> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch framework' }));
      throw new Error(error.error || 'Failed to fetch framework');
    }

    const data = await response.json();
    return data.data;
  }

  async createFramework(framework: CreateFrameworkRequest): Promise<ComplianceFramework> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(framework),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create framework' }));
      throw new Error(error.error || 'Failed to create framework');
    }

    const data = await response.json();
    return data.data;
  }

  async updateFramework(id: string, updates: Partial<CreateFrameworkRequest & { enabled: boolean }>): Promise<ComplianceFramework> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update framework' }));
      throw new Error(error.error || 'Failed to update framework');
    }

    const data = await response.json();
    return data.data;
  }

  async deleteFramework(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete framework' }));
      throw new Error(error.error || 'Failed to delete framework');
    }
  }

  async createRule(frameworkId: string, rule: CreateRuleRequest): Promise<ComplianceFrameworkRule> {
    const response = await fetch(`${this.baseUrl}/${frameworkId}/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(rule),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create rule' }));
      throw new Error(error.error || 'Failed to create rule');
    }

    const data = await response.json();
    return data.data;
  }

  async updateRule(ruleId: string, updates: Partial<CreateRuleRequest>): Promise<ComplianceFrameworkRule> {
    const response = await fetch(`${this.baseUrl}/rules/${ruleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update rule' }));
      throw new Error(error.error || 'Failed to update rule');
    }

    const data = await response.json();
    return data.data;
  }

  async deleteRule(ruleId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/rules/${ruleId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete rule' }));
      throw new Error(error.error || 'Failed to delete rule');
    }
  }

  async executeScan(frameworkId: string, resourceFilters?: Record<string, any>): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${frameworkId}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ resource_filters: resourceFilters }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to execute scan' }));
      throw new Error(error.error || 'Failed to execute scan');
    }
  }

  async getScans(limit?: number): Promise<ComplianceScan[]> {
    const url = `${this.baseUrl}/scans/list${limit ? `?limit=${limit}` : ''}`;

    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch scans' }));
      throw new Error(error.error || 'Failed to fetch scans');
    }

    const data = await response.json();
    return data.data;
  }

  async getScanResults(scanId: string): Promise<{ scan: ComplianceScan; findings: ComplianceScanFinding[] }> {
    const response = await fetch(`${this.baseUrl}/scans/${scanId}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch scan results' }));
      throw new Error(error.error || 'Failed to fetch scan results');
    }

    const data = await response.json();
    return data.data;
  }
}

export const complianceFrameworksService = new ComplianceFrameworksService();
