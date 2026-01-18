import Papa from 'papaparse';
import type { DependencyExportData, ExportStats } from '@/types/export';

/**
 * Exports dependency data to CSV format with metadata headers
 * Downloads the file to the user's browser
 */
export async function exportDependenciesToCSV(
  dependencies: DependencyExportData[],
  stats: ExportStats
): Promise<void> {
  try {
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const filename = `devcontrol-dependencies-${timestamp}.csv`;

    // Prepare metadata rows
    const metadataRows = [
      ['Exported from', 'DevControl'],
      ['Export date', stats.exportDate],
      ['Total services', stats.totalServices.toString()],
      ['Total dependencies', stats.totalDependencies.toString()],
      ['Critical paths', stats.criticalPaths.toString()],
      ['Circular dependencies', stats.circularDependencies.toString()],
      [], // Blank row separator
    ];

    // Prepare data rows with headers
    const dataRows = [
      ['Service Name', 'Depends On', 'Type', 'Status', 'Critical Path', 'Tags'],
      ...dependencies.map((dep) => [
        dep.serviceName,
        dep.dependsOn,
        dep.type,
        dep.status,
        dep.isCriticalPath ? 'Yes' : 'No',
        dep.tags.join('; '), // Use semicolon to avoid comma conflicts
      ]),
    ];

    // Combine all rows
    const allRows = [...metadataRows, ...dataRows];

    // Generate CSV using Papa Parse
    const csv = Papa.unparse(allRows, {
      quotes: true, // Always quote fields to handle special characters
      quoteChar: '"',
      escapeChar: '"',
      delimiter: ',',
      header: false,
      newline: '\r\n',
    });

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`CSV export successful: ${filename}`);
  } catch (error) {
    console.error('CSV export failed:', error);
    throw new Error(
      `Failed to export dependencies to CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
