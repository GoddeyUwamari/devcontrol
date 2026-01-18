'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportDependenciesToCSV } from '@/lib/export/csv-export';
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

interface ExportCSVButtonProps {
  dependencies: ServiceDependency[];
  cycles?: CircularDependency[];
}

export function ExportCSVButton({ dependencies, cycles = [] }: ExportCSVButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);

      // Transform dependencies to export format
      const exportData: DependencyExportData[] = dependencies.map((dep) => ({
        serviceName: dep.sourceServiceName || dep.sourceServiceId || 'Unknown',
        dependsOn: dep.targetServiceName || dep.targetServiceId || 'Unknown',
        type: 'direct', // All current dependencies are direct (transitive would be calculated)
        status: 'active', // Default status
        isCriticalPath: dep.isCritical,
        tags: [dep.dependencyType], // Use dependency type as tag
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

      // Export to CSV
      await exportDependenciesToCSV(exportData, stats);

      toast.success('Dependencies exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isExporting || dependencies.length === 0}
    >
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </>
      )}
    </Button>
  );
}
