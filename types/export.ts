export interface DependencyExportData {
  serviceName: string;
  dependsOn: string;
  type: 'direct' | 'transitive';
  status: string;
  isCriticalPath: boolean;
  tags: string[];
}

export interface ExportStats {
  totalServices: number;
  totalDependencies: number;
  criticalPaths: number;
  circularDependencies: number;
  exportDate: string;
}
