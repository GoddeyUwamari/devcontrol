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
import { getModifierSymbol } from '@/lib/hooks/use-keyboard-shortcuts';
import type { DependencyExportData, ExportStats } from '@/types/export';

interface ServiceDependency {
  id: string;
  sourceServiceId?: string;
  targetServiceId?: string;
  sourceServiceName?: string;
  targetServiceName?: string;
  dependencyType: string;
  description?: string;
  isCritical: boolean;
}

interface CircularDependency {
  path: string;
}

interface ExportMenuProps {
  dependencies: ServiceDependency[];
  cycles?: CircularDependency[];
  graphRef: React.RefObject<HTMLDivElement> | null;
  activeTab?: string;
}

export const ExportMenu = forwardRef<HTMLButtonElement, ExportMenuProps>(
  function ExportMenu(
    {
      dependencies,
      cycles = [],
      graphRef,
      activeTab = 'graph',
    },
    ref
  ) {
    const [exportingType, setExportingType] = useState<'csv' | 'png' | 'pdf' | null>(null);
    const modSymbol = getModifierSymbol();

  // Prepare export data and stats
  const prepareExportData = (): { exportData: DependencyExportData[]; stats: ExportStats } => {
    const exportData: DependencyExportData[] = dependencies.map((dep) => ({
      serviceName: dep.sourceServiceName || dep.sourceServiceId || 'Unknown',
      dependsOn: dep.targetServiceName || dep.targetServiceId || 'Unknown',
      type: 'direct',
      status: 'active',
      isCriticalPath: dep.isCritical,
      tags: [dep.dependencyType],
    }));

    const uniqueServices = new Set<string>();
    dependencies.forEach((dep) => {
      if (dep.sourceServiceName) uniqueServices.add(dep.sourceServiceName);
      if (dep.targetServiceName) uniqueServices.add(dep.targetServiceName);
    });

    const criticalPaths = dependencies.filter((dep) => dep.isCritical).length;

    const stats: ExportStats = {
      totalServices: uniqueServices.size,
      totalDependencies: dependencies.length,
      criticalPaths,
      circularDependencies: cycles.length,
      exportDate: new Date().toISOString(),
    };

    return { exportData, stats };
  };

  const handleCSVExport = async () => {
    try {
      setExportingType('csv');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { exportData, stats } = prepareExportData();
      await exportDependenciesToCSV(exportData, stats);

      toast.success('Dependencies exported as CSV');
    } catch (error) {
      console.error('CSV export error:', error);
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      await exportGraphToPNG(graphRef.current);

      toast.success('Graph exported as PNG');
    } catch (error) {
      console.error('PNG export error:', error);
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
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { exportData, stats } = prepareExportData();
      await exportDependencyReport(exportData, stats, graphRef?.current || null);

      toast.success('Report exported as PDF');
    } catch (error) {
      console.error('PDF export error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Report export failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setExportingType(null);
    }
  };

  const isExporting = exportingType !== null;
  const hasDependencies = dependencies.length > 0;
  const hasGraph = activeTab === 'graph' && graphRef?.current;

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
              <kbd className="hidden md:inline-block ml-2 px-1.5 py-0.5 text-xs bg-muted/50 border border-border rounded">
                {modSymbol}E
              </kbd>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleCSVExport} disabled={isExporting}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export as CSV</span>
            <span className="text-xs text-muted-foreground">Download dependency data</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handlePNGExport}
          disabled={!hasGraph || isExporting}
        >
          <ImageIcon className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export Graph as PNG</span>
            <span className="text-xs text-muted-foreground">
              {hasGraph ? 'Save visualization' : 'View graph tab first'}
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handlePDFExport} disabled={isExporting}>
          <FileText className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export Report as PDF</span>
            <span className="text-xs text-muted-foreground">Full comprehensive report</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
