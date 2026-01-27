import { ResourceFilters } from './aws-resources.types';

// =====================================================
// EXPORT TYPES
// =====================================================

export type ExportFormat = 'csv' | 'pdf';

export type ExportColumn =
  | 'resource_name'
  | 'resource_type'
  | 'region'
  | 'team'
  | 'service'
  | 'environment'
  | 'status'
  | 'cost'
  | 'security'
  | 'compliance'
  | 'tags'
  | 'created_at';

export interface ExportRequest {
  format: ExportFormat;
  columns: ExportColumn[];
  filters?: ResourceFilters;
}

export interface ColumnMapping {
  label: string;
  field: string;
  formatter: (resource: any) => string;
}
