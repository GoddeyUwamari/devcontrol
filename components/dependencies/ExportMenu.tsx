'use client';

import { useState, forwardRef } from 'react';
import { Download, FileText, Image as ImageIcon, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { exportDependenciesToCSV } from '@/lib/export/csv-export';
import { exportGraphToPNG } from '@/lib/export/graph-export';
import { exportDependencyReport } from '@/lib/export/pdf-export';
import type { DependencyExportData, ExportStats } from '@/types/export';
import type { CircularDependency, ServiceDependency } from '@/lib/types';
import { logError } from '@/lib/safe-log';

interface ExportMenuProps {
  dependencies: ServiceDependency[];
  /** Null when cycle detection failed or has not loaded. */
  cycles: CircularDependency[] | null;
  graphRef: React.RefObject<HTMLDivElement | null> | null;
  activeTab?: string;
}

/**
 * The export rows and counts, from the recorded dependencies and detected
 * cycles only.
 */
export function prepareDependencyExport(
  dependencies: ServiceDependency[],
  cycles: CircularDependency[] | null,
  now: Date = new Date()
): { exportData: DependencyExportData[]; stats: ExportStats } {
  const exportData: DependencyExportData[] = dependencies.map((dep) => ({
    serviceName: dep.sourceServiceName || dep.sourceServiceId,
    dependsOn: dep.targetServiceName || dep.targetServiceId,
    dependencyType: dep.dependencyType,
    isCritical: dep.isCritical,
    description: dep.description ?? '',
  }));

  const uniqueServices = new Set<string>();
  dependencies.forEach((dep) => {
    uniqueServices.add(dep.sourceServiceId);
    uniqueServices.add(dep.targetServiceId);
  });

  const stats: ExportStats = {
    totalServices: uniqueServices.size,
    totalDependencies: dependencies.length,
    criticalDependencies: dependencies.filter((dep) => dep.isCritical).length,
    circularDependencies: cycles === null ? null : cycles.length,
    exportDate: now.toISOString(),
  };

  return { exportData, stats };
}

export const ExportMenu = forwardRef<HTMLButtonElement, ExportMenuProps>(
  function ExportMenu(
    {
      dependencies,
      cycles,
      graphRef,
      activeTab = 'graph',
    },
    ref
  ) {
    const [exportingType, setExportingType] = useState<'csv' | 'png' | 'pdf' | null>(null);

  const handleCSVExport = async () => {
    try {
      setExportingType('csv');
      const { exportData, stats } = prepareDependencyExport(dependencies, cycles);
      await exportDependenciesToCSV(exportData, stats);

      toast.success('Dependencies exported as CSV');
    } catch (error) {
      logError('CSV export error', error);
      toast.error('CSV export failed. Please try again.');
    } finally {
      setExportingType(null);
    }
  };

  const handlePNGExport = async () => {
    if (!graphRef?.current) {
      toast.error('Graph not loaded. Please wait for the graph to render.');
      return;
    }

    try {
      setExportingType('png');
      await exportGraphToPNG(graphRef.current);

      toast.success('Graph exported as PNG');
    } catch (error) {
      logError('PNG export error', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Graph export failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setExportingType(null);
    }
  };

  const handlePDFExport = async () => {
    try {
      setExportingType('pdf');
      const { exportData, stats } = prepareDependencyExport(dependencies, cycles);
      await exportDependencyReport(exportData, stats, graphRef?.current || null, (cycles ?? []).map((c) => c.path));

      toast.success('Report exported as PDF');
    } catch (error) {
      logError('PDF export error', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Report export failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setExportingType(null);
    }
  };

  const isExporting = exportingType !== null;
  const hasDependencies = dependencies.length > 0;
  const hasGraph = activeTab === 'graph';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={ref} variant="outline" disabled={!hasDependencies || isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleCSVExport} disabled={isExporting}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export as CSV</span>
            <span className="text-meta text-muted-foreground">Download dependency data</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handlePNGExport}
          disabled={!hasGraph || isExporting}
        >
          <ImageIcon className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export Graph as PNG</span>
            <span className="text-meta text-muted-foreground">
              {hasGraph ? 'Save visualization' : 'View graph tab first'}
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handlePDFExport} disabled={isExporting}>
          <FileText className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export Report as PDF</span>
            <span className="text-meta text-muted-foreground">Counts, graph, dependency table and cycles</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
