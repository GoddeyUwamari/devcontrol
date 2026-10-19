/** One recorded dependency, as exported: only fields service_dependencies holds. */
export interface DependencyExportData {
  serviceName: string;
  dependsOn: string;
  dependencyType: string;
  isCritical: boolean;
  description: string;
}

export interface ExportStats {
  /** Distinct services named in the exported dependencies. */
  totalServices: number;
  totalDependencies: number;
  /** Dependencies marked critical. */
  criticalDependencies: number;
  /** Null when cycle detection failed or has not loaded. */
  circularDependencies: number | null;
  exportDate: string;
}
