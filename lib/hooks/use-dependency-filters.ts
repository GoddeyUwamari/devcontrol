import { useState, useMemo, useCallback } from 'react';
import type { SearchResult } from '@/lib/search/dependency-search';
import type { DependencyExportData } from '@/types/export';

/**
 * Filter state structure
 */
export interface FilterState {
  type: 'all' | 'direct' | 'transitive';
  status: 'all' | 'active' | 'inactive' | 'deprecated';
  criticalPath: 'all' | 'critical' | 'non-critical';
}

/**
 * Hook return type
 */
export interface UseDependencyFiltersReturn {
  filters: FilterState;
  setFilter: (key: keyof FilterState, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;
  filteredResults: SearchResult<DependencyExportData>[];
}

/**
 * Default filter state
 */
const DEFAULT_FILTERS: FilterState = {
  type: 'all',
  status: 'all',
  criticalPath: 'all',
};

/**
 * Custom hook for filtering dependency search results
 * Applies multiple filters simultaneously with AND logic
 *
 * @param searchResults - Array of search results to filter
 * @returns Filter state and handlers
 */
export function useDependencyFilters(
  searchResults: SearchResult<DependencyExportData>[]
): UseDependencyFiltersReturn {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  /**
   * Update a specific filter
   */
  const setFilter = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  /**
   * Clear all filters to default
   */
  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  /**
   * Count active filters (excluding 'all')
   */
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.type !== 'all') count++;
    if (filters.status !== 'all') count++;
    if (filters.criticalPath !== 'all') count++;
    return count;
  }, [filters]);

  /**
   * Apply all filters to search results
   * Uses AND logic - all filter conditions must match
   */
  const filteredResults = useMemo(() => {
    if (activeFilterCount === 0) {
      return searchResults;
    }

    return searchResults.filter((result) => {
      const item = result.item;

      // Filter by type
      if (filters.type !== 'all' && item.type !== filters.type) {
        return false;
      }

      // Filter by status
      if (filters.status !== 'all') {
        const itemStatus = item.status.toLowerCase();
        if (itemStatus !== filters.status) {
          return false;
        }
      }

      // Filter by critical path
      if (filters.criticalPath !== 'all') {
        const isCritical = item.isCriticalPath;
        if (filters.criticalPath === 'critical' && !isCritical) {
          return false;
        }
        if (filters.criticalPath === 'non-critical' && isCritical) {
          return false;
        }
      }

      return true;
    });
  }, [searchResults, filters, activeFilterCount]);

  return {
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    filteredResults,
  };
}
