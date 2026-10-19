import Papa from 'papaparse';
import type { DependencyExportData, ExportStats } from '@/types/export';
import { logError } from '@/lib/safe-log';

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
      ['Services in dependencies', stats.totalServices.toString()],
      ['Total dependencies', stats.totalDependencies.toString()],
      ['Critical dependencies', stats.criticalDependencies.toString()],
      ['Circular dependencies', stats.circularDependencies === null ? 'Unavailable' : stats.circularDependencies.toString()],
      [], // Blank row separator
    ];

    // Prepare data rows with headers
    const dataRows = [
      ['Service Name', 'Depends On', 'Type', 'Critical', 'Description'],
      ...dependencies.map((dep) => [
        dep.serviceName,
        dep.dependsOn,
        dep.dependencyType,
        dep.isCritical ? 'Yes' : 'No',
        dep.description,
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
    logError('CSV export failed', error);
    throw new Error(
      `Failed to export dependencies to CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
