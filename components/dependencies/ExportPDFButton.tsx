'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportDependencyReport } from '@/lib/export/pdf-export';
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

interface ExportPDFButtonProps {
  dependencies: ServiceDependency[];
  cycles?: CircularDependency[];
  graphRef: React.RefObject<HTMLDivElement> | null;
  disabled?: boolean;
}

export function ExportPDFButton({
  dependencies,
  cycles = [],
  graphRef,
  disabled = false,
}: ExportPDFButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);

      // Small delay to ensure UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Transform dependencies to export format
      const exportData: DependencyExportData[] = dependencies.map((dep) => ({
        serviceName: dep.sourceServiceName || dep.sourceServiceId || 'Unknown',
        dependsOn: dep.targetServiceName || dep.targetServiceId || 'Unknown',
        type: 'direct',
        status: 'active',
        isCriticalPath: dep.isCritical,
        tags: [dep.dependencyType],
      }));

      // Calculate unique services
      const uniqueServices = new Set<string>();
      dependencies.forEach((dep) => {
        if (dep.sourceServiceName) uniqueServices.add(dep.sourceServiceName);
        if (dep.targetServiceName) uniqueServices.add(dep.targetServiceName);
      });

      // Calculate critical paths
      const criticalPaths = dependencies.filter((dep) => dep.isCritical).length;

      // Prepare stats
      const stats: ExportStats = {
        totalServices: uniqueServices.size,
        totalDependencies: dependencies.length,
        criticalPaths,
        circularDependencies: cycles.length,
        exportDate: new Date().toISOString(),
      };

      // Export to PDF
      await exportDependencyReport(exportData, stats, graphRef?.current || null);

      toast.success('Report exported successfully');
    } catch (error) {
      console.error('PDF export error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Report export failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const isDisabled = disabled || dependencies.length === 0 || isExporting;

  return (
    <Button variant="outline" onClick={handleExport} disabled={isDisabled}>
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Generating report...
        </>
      ) : (
        <>
          <FileText className="h-4 w-4 mr-2" />
          Export Report
        </>
      )}
    </Button>
  );
}
