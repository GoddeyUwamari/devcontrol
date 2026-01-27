import { Pool } from 'pg';

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
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
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
  created_at: Date;
  updated_at: Date;
}

export interface ComplianceScan {
  id: string;
  organization_id: string;
  framework_id: string;
  scan_type: 'manual' | 'scheduled' | 'continuous';
  status: 'pending' | 'running' | 'completed' | 'failed';
  resource_filters: Record<string, any>;
  total_resources: number;
  compliant_resources: number;
  non_compliant_resources: number;
  resources_scanned: number;
  critical_issues: number;
  high_issues: number;
  medium_issues: number;
  low_issues: number;
  compliance_score: number | null;
  started_at: Date | null;
  completed_at: Date | null;
  duration_seconds: number | null;
  error_message: string | null;
  results: Record<string, any> | null;
  triggered_by: string | null;
  created_at: Date;
}

export interface ComplianceScanFinding {
  id: string;
  scan_id: string;
  rule_id: string;
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
  remediated_at: Date | null;
  remediated_by: string | null;
  remediation_notes: string | null;
  detected_at: Date;
}

export interface CreateFrameworkData {
  organization_id: string;
  name: string;
  description?: string;
  framework_type?: 'built_in' | 'custom';
  enabled?: boolean;
  is_default?: boolean;
  standard_name?: string;
  version?: string;
  created_by?: string;
}

export interface CreateRuleData {
  framework_id: string;
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

export class ComplianceFrameworksRepository {
  constructor(private pool: Pool) {}

  // ==================== Frameworks ====================

  async findAllFrameworks(organizationId: string): Promise<ComplianceFramework[]> {
    const query = `
      SELECT * FROM compliance_frameworks
      WHERE organization_id = $1
      ORDER BY created_at DESC
    `;
    const result = await this.pool.query(query, [organizationId]);
    return result.rows;
  }

  async findFrameworkById(id: string, organizationId: string): Promise<ComplianceFramework | null> {
    const query = `
      SELECT * FROM compliance_frameworks
      WHERE id = $1 AND organization_id = $2
    `;
    const result = await this.pool.query(query, [id, organizationId]);
    return result.rows[0] || null;
  }

  async findFrameworkWithRules(id: string, organizationId: string): Promise<{
    framework: ComplianceFramework;
    rules: ComplianceFrameworkRule[];
  } | null> {
    const framework = await this.findFrameworkById(id, organizationId);
    if (!framework) return null;

    const rules = await this.findRulesByFramework(id);
    return { framework, rules };
  }

  async createFramework(data: CreateFrameworkData): Promise<ComplianceFramework> {
    const query = `
      INSERT INTO compliance_frameworks (
        organization_id, name, description, framework_type, enabled, is_default,
        standard_name, version, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      data.organization_id,
      data.name,
      data.description || null,
      data.framework_type || 'custom',
      data.enabled !== undefined ? data.enabled : true,
      data.is_default !== undefined ? data.is_default : false,
      data.standard_name || null,
      data.version || null,
      data.created_by || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async updateFramework(
    id: string,
    organizationId: string,
    updates: Partial<CreateFrameworkData>
  ): Promise<ComplianceFramework | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex++}`);
      values.push(updates.enabled);
    }
    if (updates.is_default !== undefined) {
      fields.push(`is_default = $${paramIndex++}`);
      values.push(updates.is_default);
    }

    if (fields.length === 0) {
      return this.findFrameworkById(id, organizationId);
    }

    const query = `
      UPDATE compliance_frameworks
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
      RETURNING *
    `;

    values.push(id, organizationId);
    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async deleteFramework(id: string, organizationId: string): Promise<boolean> {
    const query = `
      DELETE FROM compliance_frameworks
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `;
    const result = await this.pool.query(query, [id, organizationId]);
    return result.rowCount > 0;
  }

  // ==================== Rules ====================

  async findRulesByFramework(frameworkId: string): Promise<ComplianceFrameworkRule[]> {
    const query = `
      SELECT * FROM compliance_framework_rules
      WHERE framework_id = $1
      ORDER BY created_at ASC
    `;
    const result = await this.pool.query(query, [frameworkId]);
    return result.rows;
  }

  async findRuleById(id: string): Promise<ComplianceFrameworkRule | null> {
    const query = `
      SELECT * FROM compliance_framework_rules
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async createRule(data: CreateRuleData): Promise<ComplianceFrameworkRule> {
    const query = `
      INSERT INTO compliance_framework_rules (
        framework_id, rule_code, title, description, severity, category,
        rule_type, conditions, resource_types, recommendation, remediation_url, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      data.framework_id,
      data.rule_code,
      data.title,
      data.description || null,
      data.severity,
      data.category,
      data.rule_type,
      JSON.stringify(data.conditions),
      data.resource_types || [],
      data.recommendation,
      data.remediation_url || null,
      data.enabled !== undefined ? data.enabled : true,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async updateRule(
    id: string,
    updates: Partial<CreateRuleData>
  ): Promise<ComplianceFrameworkRule | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.severity !== undefined) {
      fields.push(`severity = $${paramIndex++}`);
      values.push(updates.severity);
    }
    if (updates.category !== undefined) {
      fields.push(`category = $${paramIndex++}`);
      values.push(updates.category);
    }
    if (updates.conditions !== undefined) {
      fields.push(`conditions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.conditions));
    }
    if (updates.resource_types !== undefined) {
      fields.push(`resource_types = $${paramIndex++}`);
      values.push(updates.resource_types);
    }
    if (updates.recommendation !== undefined) {
      fields.push(`recommendation = $${paramIndex++}`);
      values.push(updates.recommendation);
    }
    if (updates.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex++}`);
      values.push(updates.enabled);
    }

    if (fields.length === 0) {
      return this.findRuleById(id);
    }

    const query = `
      UPDATE compliance_framework_rules
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    values.push(id);
    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async deleteRule(id: string): Promise<boolean> {
    const query = `
      DELETE FROM compliance_framework_rules
      WHERE id = $1
      RETURNING id
    `;
    const result = await this.pool.query(query, [id]);
    return result.rowCount > 0;
  }

  // ==================== Scans ====================

  async createScan(data: {
    organization_id: string;
    framework_id: string;
    scan_type: 'manual' | 'scheduled' | 'continuous';
    resource_filters?: Record<string, any>;
    triggered_by?: string;
  }): Promise<ComplianceScan> {
    const query = `
      INSERT INTO compliance_scans (
        organization_id, framework_id, scan_type, status,
        resource_filters, triggered_by
      ) VALUES ($1, $2, $3, 'pending', $4, $5)
      RETURNING *
    `;

    const values = [
      data.organization_id,
      data.framework_id,
      data.scan_type,
      JSON.stringify(data.resource_filters || {}),
      data.triggered_by || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async updateScan(
    id: string,
    updates: Partial<{
      status: string;
      total_resources: number;
      compliant_resources: number;
      non_compliant_resources: number;
      resources_scanned: number;
      critical_issues: number;
      high_issues: number;
      medium_issues: number;
      low_issues: number;
      compliance_score: number;
      started_at: Date;
      completed_at: Date;
      duration_seconds: number;
      error_message: string;
      results: Record<string, any>;
    }>
  ): Promise<ComplianceScan | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(key === 'results' ? JSON.stringify(value) : value);
      }
    });

    if (fields.length === 0) return null;

    const query = `
      UPDATE compliance_scans
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    values.push(id);
    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async findScanById(id: string): Promise<ComplianceScan | null> {
    const query = `SELECT * FROM compliance_scans WHERE id = $1`;
    const result = await this.pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async findScansByOrganization(organizationId: string, limit: number = 50): Promise<ComplianceScan[]> {
    const query = `
      SELECT * FROM compliance_scans
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await this.pool.query(query, [organizationId, limit]);
    return result.rows;
  }

  // ==================== Findings ====================

  async createFinding(data: {
    scan_id: string;
    rule_id: string;
    resource_id: string;
    resource_arn: string;
    resource_type: string;
    resource_name: string | null;
    status: 'pass' | 'fail' | 'error' | 'skip';
    severity: string;
    category: string;
    issue: string | null;
    recommendation: string | null;
  }): Promise<ComplianceScanFinding> {
    const query = `
      INSERT INTO compliance_scan_findings (
        scan_id, rule_id, resource_id, resource_arn, resource_type, resource_name,
        status, severity, category, issue, recommendation
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (scan_id, resource_id, rule_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        issue = EXCLUDED.issue,
        recommendation = EXCLUDED.recommendation
      RETURNING *
    `;

    const values = [
      data.scan_id,
      data.rule_id,
      data.resource_id,
      data.resource_arn,
      data.resource_type,
      data.resource_name,
      data.status,
      data.severity,
      data.category,
      data.issue,
      data.recommendation,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async findFindingsByScan(scanId: string): Promise<ComplianceScanFinding[]> {
    const query = `
      SELECT * FROM compliance_scan_findings
      WHERE scan_id = $1
      ORDER BY severity DESC, detected_at DESC
    `;
    const result = await this.pool.query(query, [scanId]);
    return result.rows;
  }

  async markFindingAsRemediated(
    id: string,
    remediatedBy: string,
    notes?: string
  ): Promise<ComplianceScanFinding | null> {
    const query = `
      UPDATE compliance_scan_findings
      SET remediated = true,
          remediated_at = NOW(),
          remediated_by = $1,
          remediation_notes = $2
      WHERE id = $3
      RETURNING *
    `;
    const result = await this.pool.query(query, [remediatedBy, notes || null, id]);
    return result.rows[0] || null;
  }
}
