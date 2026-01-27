import { Pool } from 'pg';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ExportColumn, ColumnMapping } from '../types/export.types';
import { ResourceFilters, AWSResource } from '../types/aws-resources.types';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: typeof autoTable;
  }
}

export class AWSResourcesExportService {
  private static readonly MAX_EXPORT_LIMIT = 50000;

  private static readonly COLUMN_MAPPINGS: Record<ExportColumn, ColumnMapping> = {
    resource_name: {
      label: 'Resource Name',
      field: 'resource_name',
      formatter: (r: any) => r.resource_name || 'N/A',
    },
    resource_type: {
      label: 'Resource Type',
      field: 'resource_type',
      formatter: (r: any) => (r.resource_type || '').toUpperCase(),
    },
    region: {
      label: 'Region',
      field: 'region',
      formatter: (r: any) => r.region || '-',
    },
    team: {
      label: 'Team',
      field: 'team_name',
      formatter: (r: any) => r.team_name || 'Unassigned',
    },
    service: {
      label: 'Service',
      field: 'service_name',
      formatter: (r: any) => r.service_name || 'Unassigned',
    },
    environment: {
      label: 'Environment',
      field: 'environment',
      formatter: (r: any) => r.environment || '-',
    },
    status: {
      label: 'Status',
      field: 'status',
      formatter: (r: any) => r.status || 'Unknown',
    },
    cost: {
      label: 'Monthly Cost',
      field: 'estimated_monthly_cost',
      formatter: (r: any) => {
        const cost = r.estimated_monthly_cost || 0;
        return `$${cost.toFixed(2)}`;
      },
    },
    security: {
      label: 'Security Status',
      field: 'is_encrypted,is_public',
      formatter: (r: any) => {
        if (r.is_encrypted) return '✓ Encrypted';
        if (r.is_public) return '⚠ Public';
        return '✗ Not Encrypted';
      },
    },
    compliance: {
      label: 'Compliance Issues',
      field: 'compliance_issues',
      formatter: (r: any) => {
        const issues = r.compliance_issues || [];
        const count = Array.isArray(issues) ? issues.length : 0;
        return count === 0 ? 'No issues' : `${count} issue${count > 1 ? 's' : ''}`;
      },
    },
    tags: {
      label: 'Tags',
      field: 'tags',
      formatter: (r: any) => {
        const tags = r.tags || {};
        if (Object.keys(tags).length === 0) return '-';
        return Object.entries(tags)
          .map(([k, v]) => `${k}:${v}`)
          .join('; ');
      },
    },
    created_at: {
      label: 'Created Date',
      field: 'created_at',
      formatter: (r: any) => {
        if (!r.created_at) return '-';
        return new Date(r.created_at).toLocaleDateString('en-US');
      },
    },
  };

  constructor(private pool: Pool) {}

  /**
   * Generate CSV export
   */
  async generateCSV(
    organizationId: string,
    filters: ResourceFilters,
    columns: ExportColumn[]
  ): Promise<Buffer> {
    const resources = await this.fetchResourcesForExport(organizationId, filters);

    if (resources.length === 0) {
      // Return empty CSV with headers
      const headers = columns.map((col) => AWSResourcesExportService.COLUMN_MAPPINGS[col]?.label || col);
      return Buffer.from(headers.join(',') + '\n', 'utf-8');
    }

    // Build header row
    const headers = columns.map((col) => AWSResourcesExportService.COLUMN_MAPPINGS[col]?.label || col);

    // Build data rows
    const rows = resources.map((resource) =>
      columns.map((col) => this.formatCellValue(col, resource))
    );

    // Generate CSV content with proper escaping
    const csvContent = [
      headers.map((h) => this.escapeCsvValue(h)).join(','),
      ...rows.map((row) => row.map((cell) => this.escapeCsvValue(cell)).join(',')),
    ].join('\n');

    return Buffer.from(csvContent, 'utf-8');
  }

  /**
   * Generate PDF export
   */
  async generatePDF(
    organizationId: string,
    filters: ResourceFilters,
    columns: ExportColumn[]
  ): Promise<Buffer> {
    const resources = await this.fetchResourcesForExport(organizationId, filters);

    // Initialize PDF with landscape orientation for wide tables
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'in',
      format: 'letter',
    });

    const pageWidth = 11; // landscape
    const pageHeight = 8.5;
    const margin = 0.75;
    const contentWidth = pageWidth - margin * 2;

    // Color scheme
    const primaryBlue = '#2563eb';
    const darkGray = '#1f2937';

    // ======================
    // Cover Page
    // ======================
    doc.setFillColor(primaryBlue);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(32);
    doc.setFont('helvetica', 'bold');
    doc.text('AWS Resources Export', pageWidth / 2, 3.5, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.text(exportDate, pageWidth / 2, 4.5, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`Total Resources: ${resources.length}`, pageWidth / 2, 5.5, { align: 'center' });

    // ======================
    // Resource Table
    // ======================
    if (resources.length > 0) {
      doc.addPage();

      doc.setTextColor(darkGray);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Resource Inventory', margin, margin + 0.3);

      const tableHeaders = columns.map(
        (col) => AWSResourcesExportService.COLUMN_MAPPINGS[col]?.label || col
      );
      const tableData = resources.map((resource) =>
        columns.map((col) => this.formatCellValue(col, resource))
      );

      autoTable(doc, {
        head: [tableHeaders],
        body: tableData,
        startY: margin + 0.5,
        margin: { left: margin, right: margin },
        theme: 'grid',
        headStyles: {
          fillColor: primaryBlue,
          textColor: '#ffffff',
          fontSize: 9,
          fontStyle: 'bold',
        },
        bodyStyles: {
          fontSize: 8,
          textColor: darkGray,
        },
        alternateRowStyles: {
          fillColor: '#f9fafb',
        },
        columnStyles: columns.reduce((acc, col, idx) => {
          // Adjust column widths based on content type
          if (col === 'resource_name' || col === 'tags') {
            acc[idx] = { cellWidth: 'auto' };
          }
          return acc;
        }, {} as any),
      });
    } else {
      doc.addPage();
      doc.setTextColor(darkGray);
      doc.setFontSize(14);
      doc.text('No resources found matching the filters.', pageWidth / 2, pageHeight / 2, {
        align: 'center',
      });
    }

    // ======================
    // Page Numbers
    // ======================
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 0.4, { align: 'center' });
    }

    // Return as buffer
    const pdfBuffer = doc.output('arraybuffer');
    return Buffer.from(pdfBuffer);
  }

  /**
   * Fetch resources for export with joins for team_name and service_name
   */
  private async fetchResourcesForExport(
    organizationId: string,
    filters: ResourceFilters
  ): Promise<any[]> {
    const conditions: string[] = ['r.organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Build WHERE conditions (same as repository)
    if (filters?.resource_type) {
      conditions.push(`r.resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }

    if (filters?.region) {
      conditions.push(`r.region = $${paramIndex++}`);
      values.push(filters.region);
    }

    if (filters?.status) {
      conditions.push(`r.status = $${paramIndex++}`);
      values.push(filters.status);
    }

    if (filters?.is_encrypted !== undefined) {
      conditions.push(`r.is_encrypted = $${paramIndex++}`);
      values.push(filters.is_encrypted);
    }

    if (filters?.is_public !== undefined) {
      conditions.push(`r.is_public = $${paramIndex++}`);
      values.push(filters.is_public);
    }

    if (filters?.has_backup !== undefined) {
      conditions.push(`r.has_backup = $${paramIndex++}`);
      values.push(filters.has_backup);
    }

    if (filters?.search) {
      conditions.push(`(
        r.resource_name ILIKE $${paramIndex} OR
        r.resource_id ILIKE $${paramIndex} OR
        r.resource_arn ILIKE $${paramIndex}
      )`);
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Count total to check limit
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM aws_resources r ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total);

    if (total > AWSResourcesExportService.MAX_EXPORT_LIMIT) {
      throw new Error(
        `Export limited to ${AWSResourcesExportService.MAX_EXPORT_LIMIT} resources. ` +
          `Your query would return ${total}. Please apply filters to reduce the dataset.`
      );
    }

    // Query with LEFT JOINs for team_name and service_name
    const query = `
      SELECT
        r.*,
        t.name as team_name,
        s.name as service_name
      FROM aws_resources r
      LEFT JOIN teams t ON r.team_id = t.id
      LEFT JOIN services s ON r.service_id = s.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${AWSResourcesExportService.MAX_EXPORT_LIMIT}
    `;

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Format cell value for a given column
   */
  private formatCellValue(column: ExportColumn, resource: any): string {
    const mapping = AWSResourcesExportService.COLUMN_MAPPINGS[column];
    if (!mapping) return '-';
    return mapping.formatter(resource);
  }

  /**
   * Escape CSV value (handle quotes, commas, newlines)
   */
  private escapeCsvValue(value: string): string {
    if (value == null) return '""';

    const stringValue = String(value);

    // If value contains comma, quote, or newline, wrap in quotes and escape existing quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }
}
