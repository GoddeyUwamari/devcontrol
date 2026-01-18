'use client';

import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { FilterState } from '@/lib/hooks/use-dependency-filters';
import { cn } from '@/lib/utils';

interface FilterSummaryProps {
  filters: FilterState;
  onRemoveFilter: (key: keyof FilterState, value: string) => void;
  className?: string;
}

/**
 * Display labels for filter values
 */
const FILTER_LABELS: Record<string, Record<string, string>> = {
  type: {
    direct: 'Direct',
    transitive: 'Transitive',
  },
  status: {
    active: 'Active',
    inactive: 'Inactive',
    deprecated: 'Deprecated',
  },
  criticalPath: {
    critical: 'Critical Path',
    'non-critical': 'Non-Critical',
  },
};

/**
 * Filter category labels
 */
const FILTER_CATEGORY_LABELS: Record<keyof FilterState, string> = {
  type: 'Type',
  status: 'Status',
  criticalPath: 'Critical',
};

export function FilterSummary({ filters, onRemoveFilter, className }: FilterSummaryProps) {
  // Get active filters
  const activeFilters: Array<{ key: keyof FilterState; value: string; label: string }> = [];

  (Object.keys(filters) as Array<keyof FilterState>).forEach((key) => {
    const value = filters[key];
    if (value !== 'all' && FILTER_LABELS[key]?.[value]) {
      activeFilters.push({
        key,
        value,
        label: `${FILTER_CATEGORY_LABELS[key]}: ${FILTER_LABELS[key][value]}`,
      });
    }
  });

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-xs text-muted-foreground">Active filters:</span>

      {activeFilters.map(({ key, value, label }) => (
        <Badge
          key={`${key}-${value}`}
          variant="secondary"
          className={cn(
            'pl-2 pr-1 py-1 gap-1.5',
            'text-xs font-normal',
            'transition-all duration-200',
            'hover:bg-secondary/80'
          )}
        >
          <span className="truncate max-w-[150px]">{label}</span>
          <button
            onClick={() => onRemoveFilter(key, 'all')}
            className={cn(
              'ml-0.5 rounded-sm',
              'hover:bg-background/50',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'transition-colors'
            )}
            aria-label={`Remove ${label} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
