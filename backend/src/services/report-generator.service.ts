import { Pool } from 'pg';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AWSResourcesExportService } from './awsResourcesExport.service';
import { ExportColumn } from '../types/export.types';
import { ResourceFilters } from '../types/aws-resources.types';

export interface ReportData {
  organizationId: string;
  format: 'pdf' | 'csv' | 'both';
  filters?: ResourceFilters;
  columns?: ExportColumn[];
}

export interface CostSummaryData {
  totalCost: number;
  costByTeam: { team: string; cost: number }[];
  costByService: { service: string; cost: number }[];
  costByEnvironment: { env: string; cost: number }[];
  costByResourceType: { type: string; cost: number }[];
  topSpenders: { resource: string; cost: number; type: string }[];
}

export interface SecurityAuditData {
  totalResources: number;
  encryptedCount: number;
  unencryptedCount: number;
  encryptionPercentage: number;
  publicCount: number;
  publicCriticalResources: Array<{ name: string; type: string; region: string }>;
  backupCount: number;
  noBackupCount: number;
  backupPercentage: number;
}

export interface ComplianceStatusData {
  totalResources: number;
  totalIssues: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byCategory: Array<{ category: string; count: number }>;
  topNonCompliantResources: Array<{ name: string; type: string; issueCount: number }>;
  complianceScore: number;
}

export class ReportGeneratorService {
  private exportService: AWSResourcesExportService;

  constructor(private pool: Pool) {
    this.exportService = new AWSResourcesExportService(pool);
  }

  /**
   * Generate Cost Summary Report
   */
  async generateCostSummaryReport(data: ReportData): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch cost summary data
    const summaryData = await this.fetchCostSummaryData(data.organizationId, data.filters);

    const result: { pdf?: Buffer; csv?: Buffer } = {};

    if (data.format === 'pdf' || data.format === 'both') {
      result.pdf = await this.generateCostSummaryPDF(data.organizationId, data.filters, summaryData);
    }

    if (data.format === 'csv' || data.format === 'both') {
      const columns: ExportColumn[] = data.columns || [
        'resource_name',
        'resource_type',
        'region',
        'team',
        'service',
        'environment',
        'cost',
      ];
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns);
    }

    console.log(`[ReportGenerator] Cost Summary generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Generate Security Audit Report
   */
  async generateSecurityAuditReport(data: ReportData): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch security audit data
    const securityData = await this.fetchSecurityAuditData(data.organizationId, data.filters);

    const result: { pdf?: Buffer; csv?: Buffer } = {};

    if (data.format === 'pdf' || data.format === 'both') {
      result.pdf = await this.generateSecurityAuditPDF(data.organizationId, data.filters, securityData);
    }

    if (data.format === 'csv' || data.format === 'both') {
      // Security-focused columns
      const columns: ExportColumn[] = data.columns || [
        'resource_name',
        'resource_type',
        'region',
        'security',
        'compliance',
        'environment',
      ];
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns);
    }

    console.log(`[ReportGenerator] Security Audit generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Generate Compliance Status Report
   */
  async generateComplianceStatusReport(data: ReportData): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch compliance data
    const complianceData = await this.fetchComplianceStatusData(data.organizationId, data.filters);

    const result: { pdf?: Buffer; csv?: Buffer } = {};

    if (data.format === 'pdf' || data.format === 'both') {
      result.pdf = await this.generateComplianceStatusPDF(data.organizationId, data.filters, complianceData);
    }

    if (data.format === 'csv' || data.format === 'both') {
      // Compliance-focused columns
      const columns: ExportColumn[] = data.columns || [
        'resource_name',
        'resource_type',
        'region',
        'compliance',
        'security',
        'team',
        'service',
      ];
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns);
    }

    console.log(`[ReportGenerator] Compliance Status generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Fetch cost summary aggregations
   */
  private async fetchCostSummaryData(
    organizationId: string,
    filters?: ResourceFilters
  ): Promise<CostSummaryData> {
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Apply filters
    if (filters?.resource_type) {
      conditions.push(`r.resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }
    if (filters?.region) {
      conditions.push(`r.region = $${paramIndex++}`);
      values.push(filters.region);
    }
    if (filters?.environment) {
      conditions.push(`r.environment = $${paramIndex++}`);
      values.push(filters.environment);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Total cost and top spenders
    const totalQuery = `
      SELECT
        COALESCE(SUM(r.estimated_monthly_cost), 0) as total_cost,
        COUNT(*) as total_resources
      FROM aws_resources r
      ${whereClause}
    `;

    const topSpendersQuery = `
      SELECT
        r.resource_name as resource,
        r.resource_type as type,
        r.estimated_monthly_cost as cost
      FROM aws_resources r
      ${whereClause}
      ORDER BY r.estimated_monthly_cost DESC NULLS LAST
      LIMIT 10
    `;

    // Cost by team
    const byTeamQuery = `
      SELECT
        COALESCE(t.name, 'Unassigned') as team,
        COALESCE(SUM(r.estimated_monthly_cost), 0) as cost
      FROM aws_resources r
      LEFT JOIN teams t ON r.team_id = t.id
      ${whereClause}
      GROUP BY t.name
      ORDER BY cost DESC
      LIMIT 10
    `;

    // Cost by service
    const byServiceQuery = `
      SELECT
        COALESCE(s.name, 'Unassigned') as service,
        COALESCE(SUM(r.estimated_monthly_cost), 0) as cost
      FROM aws_resources r
      LEFT JOIN services s ON r.service_id = s.id
      ${whereClause}
      GROUP BY s.name
      ORDER BY cost DESC
      LIMIT 10
    `;

    // Cost by environment
    const byEnvQuery = `
      SELECT
        COALESCE(r.environment, 'Unknown') as env,
        COALESCE(SUM(r.estimated_monthly_cost), 0) as cost
      FROM aws_resources r
      ${whereClause}
      GROUP BY r.environment
      ORDER BY cost DESC
    `;

    // Cost by resource type
    const byTypeQuery = `
      SELECT
        r.resource_type as type,
        COALESCE(SUM(r.estimated_monthly_cost), 0) as cost
      FROM aws_resources r
      ${whereClause}
      GROUP BY r.resource_type
      ORDER BY cost DESC
    `;

    const [totalResult, topSpendersResult, byTeamResult, byServiceResult, byEnvResult, byTypeResult] =
      await Promise.all([
        this.pool.query(totalQuery, values),
        this.pool.query(topSpendersQuery, values),
        this.pool.query(byTeamQuery, values),
        this.pool.query(byServiceQuery, values),
        this.pool.query(byEnvQuery, values),
        this.pool.query(byTypeQuery, values),
      ]);

    return {
      totalCost: parseFloat(totalResult.rows[0]?.total_cost || 0),
      costByTeam: byTeamResult.rows.map((r) => ({ team: r.team, cost: parseFloat(r.cost) })),
      costByService: byServiceResult.rows.map((r) => ({ service: r.service, cost: parseFloat(r.cost) })),
      costByEnvironment: byEnvResult.rows.map((r) => ({ env: r.env, cost: parseFloat(r.cost) })),
      costByResourceType: byTypeResult.rows.map((r) => ({ type: r.type, cost: parseFloat(r.cost) })),
      topSpenders: topSpendersResult.rows.map((r) => ({
        resource: r.resource,
        type: r.type,
        cost: parseFloat(r.cost || 0),
      })),
    };
  }

  /**
   * Fetch security audit aggregations
   */
  private async fetchSecurityAuditData(
    organizationId: string,
    filters?: ResourceFilters
  ): Promise<SecurityAuditData> {
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Apply filters
    if (filters?.resource_type) {
      conditions.push(`r.resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }
    if (filters?.region) {
      conditions.push(`r.region = $${paramIndex++}`);
      values.push(filters.region);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const securityStatsQuery = `
      SELECT
        COUNT(*) as total_resources,
        COUNT(*) FILTER (WHERE r.is_encrypted = true) as encrypted_count,
        COUNT(*) FILTER (WHERE r.is_encrypted = false) as unencrypted_count,
        COUNT(*) FILTER (WHERE r.is_public = true) as public_count,
        COUNT(*) FILTER (WHERE r.has_backup = true) as backup_count,
        COUNT(*) FILTER (WHERE r.has_backup = false) as no_backup_count
      FROM aws_resources r
      ${whereClause}
    `;

    const publicResourcesQuery = `
      SELECT
        r.resource_name as name,
        r.resource_type as type,
        r.region
      FROM aws_resources r
      ${whereClause} AND r.is_public = true
      ORDER BY r.resource_type, r.resource_name
      LIMIT 20
    `;

    const [statsResult, publicResult] = await Promise.all([
      this.pool.query(securityStatsQuery, values),
      this.pool.query(publicResourcesQuery, values),
    ]);

    const stats = statsResult.rows[0];
    const totalResources = parseInt(stats.total_resources) || 0;
    const encryptedCount = parseInt(stats.encrypted_count) || 0;
    const unencryptedCount = parseInt(stats.unencrypted_count) || 0;
    const publicCount = parseInt(stats.public_count) || 0;
    const backupCount = parseInt(stats.backup_count) || 0;
    const noBackupCount = parseInt(stats.no_backup_count) || 0;

    return {
      totalResources,
      encryptedCount,
      unencryptedCount,
      encryptionPercentage: totalResources > 0 ? (encryptedCount / totalResources) * 100 : 0,
      publicCount,
      publicCriticalResources: publicResult.rows,
      backupCount,
      noBackupCount,
      backupPercentage: totalResources > 0 ? (backupCount / totalResources) * 100 : 0,
    };
  }

  /**
   * Fetch compliance status aggregations
   */
  private async fetchComplianceStatusData(
    organizationId: string,
    filters?: ResourceFilters
  ): Promise<ComplianceStatusData> {
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Apply filters
    if (filters?.resource_type) {
      conditions.push(`r.resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }
    if (filters?.region) {
      conditions.push(`r.region = $${paramIndex++}`);
      values.push(filters.region);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const complianceStatsQuery = `
      SELECT
        COUNT(*) as total_resources,
        COUNT(*) FILTER (WHERE jsonb_array_length(r.compliance_issues) > 0) as resources_with_issues
      FROM aws_resources r
      ${whereClause}
    `;

    const severityQuery = `
      SELECT
        jsonb_array_elements(r.compliance_issues)->>'severity' as severity,
        COUNT(*) as count
      FROM aws_resources r
      ${whereClause} AND jsonb_array_length(r.compliance_issues) > 0
      GROUP BY severity
    `;

    const categoryQuery = `
      SELECT
        jsonb_array_elements(r.compliance_issues)->>'category' as category,
        COUNT(*) as count
      FROM aws_resources r
      ${whereClause} AND jsonb_array_length(r.compliance_issues) > 0
      GROUP BY category
      ORDER BY count DESC
    `;

    const topNonCompliantQuery = `
      SELECT
        r.resource_name as name,
        r.resource_type as type,
        jsonb_array_length(r.compliance_issues) as issue_count
      FROM aws_resources r
      ${whereClause} AND jsonb_array_length(r.compliance_issues) > 0
      ORDER BY issue_count DESC
      LIMIT 10
    `;

    const [statsResult, severityResult, categoryResult, topNonCompliantResult] = await Promise.all([
      this.pool.query(complianceStatsQuery, values),
      this.pool.query(severityQuery, values).catch(() => ({ rows: [] })),
      this.pool.query(categoryQuery, values).catch(() => ({ rows: [] })),
      this.pool.query(topNonCompliantQuery, values),
    ]);

    const totalResources = parseInt(statsResult.rows[0]?.total_resources || 0);
    const resourcesWithIssues = parseInt(statsResult.rows[0]?.resources_with_issues || 0);

    const bySeverity = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    severityResult.rows.forEach((row) => {
      const severity = row.severity?.toLowerCase();
      if (severity && severity in bySeverity) {
        bySeverity[severity as keyof typeof bySeverity] = parseInt(row.count);
      }
    });

    const totalIssues = Object.values(bySeverity).reduce((sum, count) => sum + count, 0);
    const complianceScore = totalResources > 0 ? ((totalResources - resourcesWithIssues) / totalResources) * 100 : 100;

    return {
      totalResources,
      totalIssues,
      bySeverity,
      byCategory: categoryResult.rows.map((r) => ({ category: r.category, count: parseInt(r.count) })),
      topNonCompliantResources: topNonCompliantResult.rows.map((r) => ({
        name: r.name,
        type: r.type,
        issueCount: parseInt(r.issue_count),
      })),
      complianceScore,
    };
  }

  /**
   * Generate Cost Summary PDF with custom cover page
   */
  private async generateCostSummaryPDF(
    organizationId: string,
    filters: ResourceFilters | undefined,
    summary: CostSummaryData
  ): Promise<Buffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
    const pageWidth = 11;
    const pageHeight = 8.5;
    const margin = 0.75;

    const primaryBlue = '#2563eb';
    const darkGray = '#1f2937';

    // Cover Page
    doc.setFillColor('#3b82f6');
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(36);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Summary Report', pageWidth / 2, 2.5, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(reportDate, pageWidth / 2, 3.2, { align: 'center' });

    // Key metrics on cover
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Monthly Cost: $${summary.totalCost.toFixed(2)}`, pageWidth / 2, 4.5, { align: 'center' });

    // Summary table on cover
    let y = 5.2;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');

    if (summary.costByEnvironment.length > 0) {
      doc.text('Cost by Environment:', margin, y);
      y += 0.3;
      summary.costByEnvironment.slice(0, 3).forEach((item) => {
        doc.text(`  ${item.env}: $${item.cost.toFixed(2)}`, margin + 0.2, y);
        y += 0.25;
      });
    }

    // Detailed tables on subsequent pages
    doc.addPage();
    doc.setTextColor(darkGray);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Breakdown', margin, margin + 0.3);

    let startY = margin + 0.6;

    // Top spenders table
    if (summary.topSpenders.length > 0) {
      autoTable(doc, {
        head: [['Resource', 'Type', 'Monthly Cost']],
        body: summary.topSpenders.map((r) => [r.resource, r.type.toUpperCase(), `$${r.cost.toFixed(2)}`]),
        startY,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: primaryBlue, textColor: '#ffffff', fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9 },
      });
      startY = (doc as any).lastAutoTable.finalY + 0.4;
    }

    // Cost by team table
    if (summary.costByTeam.length > 0 && startY < pageHeight - 2) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Cost by Team', margin, startY);
      startY += 0.3;

      autoTable(doc, {
        head: [['Team', 'Monthly Cost']],
        body: summary.costByTeam.map((r) => [r.team, `$${r.cost.toFixed(2)}`]),
        startY,
        margin: { left: margin, right: pageWidth / 2 },
        theme: 'grid',
        headStyles: { fillColor: primaryBlue, textColor: '#ffffff', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
      });
    }

    // Add page numbers
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 0.4, { align: 'center' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  /**
   * Generate Security Audit PDF with custom cover page
   */
  private async generateSecurityAuditPDF(
    organizationId: string,
    filters: ResourceFilters | undefined,
    security: SecurityAuditData
  ): Promise<Buffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
    const pageWidth = 11;
    const pageHeight = 8.5;
    const margin = 0.75;

    const primaryGreen = '#10b981';
    const darkGray = '#1f2937';

    // Cover Page
    doc.setFillColor('#059669');
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(36);
    doc.setFont('helvetica', 'bold');
    doc.text('Security Audit Report', pageWidth / 2, 2.5, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(reportDate, pageWidth / 2, 3.2, { align: 'center' });

    // Key security metrics
    doc.setFontSize(12);
    let y = 4.2;
    doc.text(`Total Resources: ${security.totalResources}`, pageWidth / 2, y, { align: 'center' });
    y += 0.3;
    doc.text(`Encryption Rate: ${security.encryptionPercentage.toFixed(1)}%`, pageWidth / 2, y, { align: 'center' });
    y += 0.3;
    doc.text(`Public Resources: ${security.publicCount}`, pageWidth / 2, y, { align: 'center' });
    y += 0.3;
    doc.text(`Backup Compliance: ${security.backupPercentage.toFixed(1)}%`, pageWidth / 2, y, { align: 'center' });

    // Details page
    doc.addPage();
    doc.setTextColor(darkGray);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Security Findings', margin, margin + 0.3);

    let startY = margin + 0.6;

    // Public resources table
    if (security.publicCriticalResources.length > 0) {
      doc.setFontSize(14);
      doc.text('Public Resources (Critical)', margin, startY);
      startY += 0.3;

      autoTable(doc, {
        head: [['Resource Name', 'Type', 'Region']],
        body: security.publicCriticalResources.map((r) => [r.name, r.type.toUpperCase(), r.region]),
        startY,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: '#dc2626', textColor: '#ffffff', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
      });
    }

    // Add page numbers
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 0.4, { align: 'center' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }

  /**
   * Generate Compliance Status PDF with custom cover page
   */
  private async generateComplianceStatusPDF(
    organizationId: string,
    filters: ResourceFilters | undefined,
    compliance: ComplianceStatusData
  ): Promise<Buffer> {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
    const pageWidth = 11;
    const pageHeight = 8.5;
    const margin = 0.75;

    const primaryPurple = '#8b5cf6';
    const darkGray = '#1f2937';

    // Cover Page
    doc.setFillColor('#7c3aed');
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(36);
    doc.setFont('helvetica', 'bold');
    doc.text('Compliance Status Report', pageWidth / 2, 2.5, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(reportDate, pageWidth / 2, 3.2, { align: 'center' });

    // Compliance score
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(`Compliance Score: ${compliance.complianceScore.toFixed(1)}%`, pageWidth / 2, 4.2, { align: 'center' });

    // Issue breakdown
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    let y = 5;
    doc.text(`Total Issues: ${compliance.totalIssues}`, pageWidth / 2, y, { align: 'center' });
    y += 0.3;
    doc.text(
      `Critical: ${compliance.bySeverity.critical} | High: ${compliance.bySeverity.high} | Medium: ${compliance.bySeverity.medium} | Low: ${compliance.bySeverity.low}`,
      pageWidth / 2,
      y,
      { align: 'center' }
    );

    // Details page
    doc.addPage();
    doc.setTextColor(darkGray);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Compliance Details', margin, margin + 0.3);

    let startY = margin + 0.6;

    // Top non-compliant resources
    if (compliance.topNonCompliantResources.length > 0) {
      doc.setFontSize(14);
      doc.text('Top Non-Compliant Resources', margin, startY);
      startY += 0.3;

      autoTable(doc, {
        head: [['Resource Name', 'Type', 'Issue Count']],
        body: compliance.topNonCompliantResources.map((r) => [r.name, r.type.toUpperCase(), r.issueCount.toString()]),
        startY,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: primaryPurple, textColor: '#ffffff', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
      });
      startY = (doc as any).lastAutoTable.finalY + 0.4;
    }

    // Issues by category
    if (compliance.byCategory.length > 0 && startY < pageHeight - 2) {
      doc.setFontSize(14);
      doc.text('Issues by Category', margin, startY);
      startY += 0.3;

      autoTable(doc, {
        head: [['Category', 'Count']],
        body: compliance.byCategory.map((r) => [r.category, r.count.toString()]),
        startY,
        margin: { left: margin, right: pageWidth / 2 },
        theme: 'grid',
        headStyles: { fillColor: primaryPurple, textColor: '#ffffff', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
      });
    }

    // Add page numbers
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 0.4, { align: 'center' });
    }

    return Buffer.from(doc.output('arraybuffer'));
  }
}
