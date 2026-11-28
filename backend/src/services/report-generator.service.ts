import { Pool, PoolClient } from 'pg';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AWSResourcesExportService } from './awsResourcesExport.service';
import { ExportColumn } from '../types/export.types';
import { ResourceFilters } from '../types/aws-resources.types';
import { activeComplianceFindings } from '../utils/frameworkApplicability';
import awsCostService, { type MonthlyCost } from './aws-cost.service';
import {
  aggregateInventoryCosts,
  formatInventoryUsd,
  inventoryCost,
  inventoryCostCell,
  inventoryCostColumns,
  INVENTORY_PRICE_BASIS,
  NO_PRICE_TEXT,
  type InventoryCost,
  type InventoryCostTotal,
} from './inventory-cost';
import { INVENTORY_COST_BASIS_NOTE } from './awsResourcesExport.service';

export interface ReportData {
  organizationId: string;
  format: 'pdf' | 'csv' | 'both';
  filters?: ResourceFilters;
  columns?: ExportColumn[];
}

/**
 * The Cost Summary headline (ruling F-4): AWS Cost Explorer billed spend for the
 * month to date when Cost Explorer has a usable amount; otherwise it is stated as
 * unavailable. Never a sum of inventory figures, never "$0.00" for missing data.
 */
export type BilledSpendHeadline =
  | {
      state: 'usable';
      amount: number;
      periodStart: string;
      periodEndExclusive: string;
      latestDaysUpdating: boolean;
      topServices: { service: string; amount: number }[];
    }
  | { state: 'unavailable'; reason: string };

export interface InventoryGroupCost {
  name: string;
  total: InventoryCostTotal;
}

export interface CostSummaryData {
  billed: BilledSpendHeadline;
  /** The appendix: inventory pricing through the shared rule (K of N priced). */
  inventory: InventoryCostTotal;
  inventoryByEnvironment: InventoryGroupCost[];
  inventoryByTeam: InventoryGroupCost[];
  /** Priced resources only, highest first (at most 10). */
  topPriced: { resource: string; type: string; cell: string }[];
}

/** How the report reads billed spend (AWSCostService.fetchMonthlyCosts by default; injectable for tests). */
export type BilledSpendReader = (organizationId: string) => Promise<MonthlyCost>;

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

/** Billed spend keeps its sign (credits); cents always. A real $0.00 billed month is billing data. */
export function formatBilledUsd(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

/** The last included day of an exclusive end date (YYYY-MM-DD). */
function lastDayBefore(endExclusive: string): string {
  const [y, m, d] = endExclusive.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The cover headline (F-4): billed when usable, otherwise "unavailable" with the reason. */
export function costSummaryHeadlineLines(billed: BilledSpendHeadline): string[] {
  if (billed.state === 'unavailable') {
    return [
      'Billed spend: unavailable',
      `AWS Cost Explorer billed spend is unavailable (${billed.reason}).`,
      'No inventory estimate is shown in its place; see the appendix for priced resources.',
    ];
  }
  const last = lastDayBefore(billed.periodEndExclusive);
  return [
    `Billed spend, month to date: ${formatBilledUsd(billed.amount)}`,
    `AWS Cost Explorer, billed ${billed.periodStart} through ${last} (UTC)${billed.amount < 0 ? ', net of credits' : ''}${billed.latestDaysUpdating ? '; the latest days are still updating' : ''}.`,
    "Account-wide billed spend: not filtered by this report's resource filters.",
  ];
}

/** The appendix's coverage and total lines (F-4): "K of N resources priced"; no total when K = 0. */
export function costSummaryAppendixLines(inventory: InventoryCostTotal): string[] {
  const coverage = `Coverage: ${inventory.pricedResources} of ${inventory.totalResources} resources priced.`;
  if (inventory.amount === null) {
    return [coverage, 'No resource has a defensible price, so there is no inventory estimate.'];
  }
  return [
    coverage,
    `Estimated monthly cost of the ${inventory.pricedResources} priced resources: ${formatInventoryUsd(inventory.amount)} (${INVENTORY_PRICE_BASIS}; not AWS billed spend). Resources without a price are not included and are not $0.`,
  ];
}

/** A group's cell: the priced estimate, or "No price" when nothing in the group is priced. */
export function inventoryGroupCell(total: InventoryCostTotal): string {
  return total.amount === null ? NO_PRICE_TEXT : `${formatInventoryUsd(total.amount)} (${INVENTORY_PRICE_BASIS})`;
}

export class ReportGeneratorService {
  private exportService: AWSResourcesExportService;

  constructor(
    private pool: Pool,
    private readBilledSpend: BilledSpendReader = (organizationId) => awsCostService.fetchMonthlyCosts(organizationId)
  ) {
    this.exportService = new AWSResourcesExportService(pool);
  }

  /** F-4 headline: Cost Explorer month to date when its amount is usable; otherwise why not. */
  private async billedSpendHeadline(organizationId: string): Promise<BilledSpendHeadline> {
    let costs: MonthlyCost;
    try {
      costs = await this.readBilledSpend(organizationId);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      console.error('[ReportGenerator] Cost Explorer read failed for the Cost Summary headline:', error?.name ?? 'Error');
      return {
        state: 'unavailable',
        reason: message.startsWith('AWS_NOT_CONNECTED') ? 'no connected AWS account' : 'the AWS Cost Explorer request failed',
      };
    }
    const month = costs.monthState;
    if (!month || !month.amountUsable || !Number.isFinite(costs.total)) {
      return {
        state: 'unavailable',
        reason: month?.state === 'no_billed_days_yet' ? 'AWS Cost Explorer has no billed days yet this month' : 'AWS Cost Explorer has no usable amount',
      };
    }
    return {
      state: 'usable',
      amount: costs.total,
      periodStart: costs.period.start,
      periodEndExclusive: costs.period.end,
      latestDaysUpdating: month.state === 'latest_days_updating',
      topServices: [...costs.byService].filter((s) => Number.isFinite(s.amount)).sort((a, b) => b.amount - a.amount).slice(0, 10),
    };
  }

  /**
   * Generate Cost Summary Report
   */
  async generateCostSummaryReport(data: ReportData, executor?: PoolClient): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch cost summary data
    const summaryData = await this.fetchCostSummaryData(data.organizationId, data.filters, executor);

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
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns, executor);
    }

    console.log(`[ReportGenerator] Cost Summary generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Generate Security Audit Report
   */
  async generateSecurityAuditReport(data: ReportData, executor?: PoolClient): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch security audit data
    const securityData = await this.fetchSecurityAuditData(data.organizationId, data.filters, executor);

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
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns, executor);
    }

    console.log(`[ReportGenerator] Security Audit generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Generate Compliance Status Report
   */
  async generateComplianceStatusReport(data: ReportData, executor?: PoolClient): Promise<{ pdf?: Buffer; csv?: Buffer }> {
    const startTime = Date.now();

    // Fetch compliance data
    const complianceData = await this.fetchComplianceStatusData(data.organizationId, data.filters, executor);

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
      result.csv = await this.exportService.generateCSV(data.organizationId, data.filters || {}, columns, executor);
    }

    console.log(`[ReportGenerator] Compliance Status generated in ${Date.now() - startTime}ms`);
    return result;
  }

  /**
   * Fetch cost summary aggregations
   */
  private async fetchCostSummaryData(
    organizationId: string,
    filters?: ResourceFilters,
    executor?: PoolClient
  ): Promise<CostSummaryData> {
    // Cost Summary is a point-in-time snapshot report, not a historical/audit
    // report — a terminated resource no longer contributes current cost, unless
    // the caller explicitly asked for it via filters.status (e.g. an audit export).
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;
    if (filters?.status) {
      conditions.push(`r.status = $${paramIndex++}`);
      values.push(filters.status);
    } else {
      conditions.push(`r.status != 'terminated'`);
    }

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

    // Every resource row through the shared inventory pricing rule (services/inventory-cost.ts).
    // No SQL sum of estimated_monthly_cost: a stored figure is a placeholder unless the rule
    // establishes its basis, and a missing price is never 0.
    const rowsQuery = `
      SELECT
        r.resource_name AS resource,
        COALESCE(t.name, 'Unassigned') AS team,
        COALESCE(r.environment, 'Unknown') AS env,
        ${inventoryCostColumns('r')}
      FROM aws_resources r
      LEFT JOIN teams t ON r.team_id = t.id
      ${whereClause}
    `;

    // Sequential, not Promise.all: these run on a single shared, RLS-tagged client.
    const client = executor ?? this.pool;
    const { rows } = await client.query(rowsQuery, values);
    const now = new Date();
    const costed = rows.map((row: any) => ({ row, cost: inventoryCost(row, now) }));

    const groupBy = (key: (row: any) => string): InventoryGroupCost[] => {
      const groups = new Map<string, InventoryCost[]>();
      for (const { row, cost } of costed) {
        const name = key(row);
        const list = groups.get(name) ?? [];
        list.push(cost);
        groups.set(name, list);
      }
      return [...groups.entries()]
        .map(([name, costs]) => ({ name, total: aggregateInventoryCosts(costs) }))
        // Priced groups first, highest estimate first; then by size.
        .sort((a, b) => (b.total.amount ?? -1) - (a.total.amount ?? -1) || b.total.totalResources - a.total.totalResources)
        .slice(0, 10);
    };

    const topPriced = costed
      .filter((c): c is { row: any; cost: Extract<InventoryCost, { kind: 'priced' }> } => c.cost.kind === 'priced')
      .sort((a, b) => b.cost.amount - a.cost.amount)
      .slice(0, 10)
      .map(({ row, cost }) => ({ resource: String(row.resource ?? 'N/A'), type: String(row.resource_type ?? ''), cell: inventoryCostCell(cost) }));

    return {
      billed: await this.billedSpendHeadline(organizationId),
      inventory: aggregateInventoryCosts(costed.map((c) => c.cost)),
      inventoryByEnvironment: groupBy((row) => String(row.env)),
      inventoryByTeam: groupBy((row) => String(row.team)),
      topPriced,
    };
  }

  /**
   * Fetch security audit aggregations
   */
  private async fetchSecurityAuditData(
    organizationId: string,
    filters?: ResourceFilters,
    executor?: PoolClient
  ): Promise<SecurityAuditData> {
    // Security Audit is current-posture reporting — see fetchCostSummaryData's note.
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;
    if (filters?.status) {
      conditions.push(`r.status = $${paramIndex++}`);
      values.push(filters.status);
    } else {
      conditions.push(`r.status != 'terminated'`);
    }

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

    // Sequential, not Promise.all: single shared, RLS-tagged client (see note above).
    const client = executor ?? this.pool;
    const statsResult = await client.query(securityStatsQuery, values);
    const publicResult = await client.query(publicResourcesQuery, values);

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
    filters?: ResourceFilters,
    executor?: PoolClient
  ): Promise<ComplianceStatusData> {
    // Compliance Status is current-posture reporting — see fetchCostSummaryData's note.
    // compliance_issues itself is also overwritten in place on every scan (not an
    // append-only findings log), so a terminated resource's issues are stale, not history.
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;
    if (filters?.status) {
      conditions.push(`r.status = $${paramIndex++}`);
      values.push(filters.status);
    } else {
      conditions.push(`r.status != 'terminated'`);
    }

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

    const totalResourcesQuery = `
      SELECT COUNT(*) as total_resources
      FROM aws_resources r
      ${whereClause}
    `;

    // Every figure below counts current findings only -- the same rule the score and
    // the at-risk flag use (isActiveComplianceFinding). That rule is applied here, not
    // in SQL, so there is one definition of it: an entry carried forward unverified,
    // or written for a framework before frameworks had to be enabled, is stored in
    // compliance_issues but is not an issue to report.
    const issuesQuery = `
      SELECT
        r.resource_name as name,
        r.resource_type as type,
        r.compliance_issues
      FROM aws_resources r
      ${whereClause} AND jsonb_typeof(r.compliance_issues) = 'array' AND jsonb_array_length(r.compliance_issues) > 0
    `;

    // Sequential, not Promise.all: single shared, RLS-tagged client (see note above).
    const client = executor ?? this.pool;
    const statsResult = await client.query(totalResourcesQuery, values);
    const issuesResult = await client.query(issuesQuery, values);

    const totalResources = parseInt(statsResult.rows[0]?.total_resources || 0);

    const bySeverity = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    const categoryCounts = new Map<string, number>();
    const nonCompliant: Array<{ name: string; type: string; issueCount: number }> = [];

    for (const row of issuesResult.rows) {
      const issues = activeComplianceFindings(row.compliance_issues);
      if (issues.length === 0) continue;
      nonCompliant.push({ name: row.name, type: row.type, issueCount: issues.length });
      for (const issue of issues) {
        const severity = typeof issue.severity === 'string' ? issue.severity.toLowerCase() : '';
        if (severity in bySeverity) bySeverity[severity as keyof typeof bySeverity]++;
        if (typeof issue.category === 'string') {
          categoryCounts.set(issue.category, (categoryCounts.get(issue.category) ?? 0) + 1);
        }
      }
    }
    const resourcesWithIssues = nonCompliant.length;

    const totalIssues = Object.values(bySeverity).reduce((sum, count) => sum + count, 0);
    const complianceScore = totalResources > 0 ? ((totalResources - resourcesWithIssues) / totalResources) * 100 : 100;

    return {
      totalResources,
      totalIssues,
      bySeverity,
      byCategory: Array.from(categoryCounts, ([category, count]) => ({ category, count })).sort(
        (x, y) => y.count - x.count || x.category.localeCompare(y.category)
      ),
      topNonCompliantResources: nonCompliant
        .sort((x, y) => y.issueCount - x.issueCount || String(x.name).localeCompare(String(y.name)))
        .slice(0, 10),
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
    const contentWidth = pageWidth - margin * 2;

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

    // Headline (F-4): billed spend from AWS Cost Explorer, or a plain statement that it is
    // unavailable. Never an inventory sum in its place.
    for (const [i, line] of costSummaryHeadlineLines(summary.billed).entries()) {
      doc.setFontSize(i === 0 ? 18 : 12);
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.text(line, pageWidth / 2, 4.4 + i * 0.4, { align: 'center', maxWidth: contentWidth });
    }

    doc.addPage();
    doc.setTextColor(darkGray);
    let startY = margin + 0.3;

    // Billed spend by AWS service (Cost Explorer), when there is a usable month.
    if (summary.billed.state === 'usable' && summary.billed.topServices.length > 0) {
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Billed spend by AWS service (month to date)', margin, startY);
      autoTable(doc, {
        head: [['AWS service', 'Billed, month to date']],
        body: summary.billed.topServices.map((s) => [s.service, formatBilledUsd(s.amount)]),
        startY: startY + 0.3,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: primaryBlue, textColor: '#ffffff', fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9 },
      });
      doc.addPage();
      startY = margin + 0.3;
    }

    // Appendix: inventory pricing, through the shared rule. K of N, priced rows only.
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Appendix: inventory price estimates', margin, startY);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const appendixLines = [...costSummaryAppendixLines(summary.inventory), ...INVENTORY_COST_BASIS_NOTE];
    doc.text(appendixLines, margin, startY + 0.35, { maxWidth: contentWidth });
    startY += 0.35 + appendixLines.length * 0.4 + 0.2;

    const groupTable = (title: string, label: string, groups: InventoryGroupCost[]) => {
      if (groups.length === 0) return;
      if (startY > pageHeight - 2) { doc.addPage(); startY = margin + 0.3; }
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(title, margin, startY);
      autoTable(doc, {
        head: [[label, 'Resources priced', 'Estimated monthly cost of priced resources']],
        body: groups.map((g) => [g.name, `${g.total.pricedResources} of ${g.total.totalResources}`, inventoryGroupCell(g.total)]),
        startY: startY + 0.2,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: primaryBlue, textColor: '#ffffff', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
      });
      startY = (doc as any).lastAutoTable.finalY + 0.4;
    };
    groupTable('By environment', 'Environment', summary.inventoryByEnvironment);
    groupTable('By team', 'Team', summary.inventoryByTeam);

    if (startY > pageHeight - 2) { doc.addPage(); startY = margin + 0.3; }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Highest priced resources', margin, startY);
    if (summary.topPriced.length > 0) {
      autoTable(doc, {
        head: [['Resource', 'Type', 'Monthly Cost']],
        body: summary.topPriced.map((r) => [r.resource, r.type.toUpperCase(), r.cell]),
        startY: startY + 0.2,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: { fillColor: primaryBlue, textColor: '#ffffff', fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9 },
      });
    } else {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('No resource has a defensible price.', margin, startY + 0.35);
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
