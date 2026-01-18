import { useState, useEffect, useMemo, useCallback } from 'react';
import { searchDependencies, SearchResult } from '@/lib/search/dependency-search';
import type { DependencyExportData } from '@/types/export';

/**
 * Service dependency structure from API
 */
export interface ServiceDependency {
  id: string;
  organizationId?: string;
  sourceServiceId?: string;
  targetServiceId?: string;
  sourceServiceName?: string;
  targetServiceName?: string;
  dependencyType: string;
  description?: string;
  isCritical: boolean;
  metadata?: Record<string, any>;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceServiceStatus?: string;
  targetServiceStatus?: string;
}

/**
 * Hook return type
 */
export interface UseDependencySearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult<DependencyExportData>[];
  isSearching: boolean;
  clearSearch: () => void;
  hasActiveSearch: boolean;
}

/**
 * Custom hook for searching dependencies with debounced input
 * Provides fuzzy search functionality across service names, tags, and status
 *
 * @param dependencies - Array of service dependencies to search
 * @returns Search state and handlers
 */
export function useDependencySearch(
  dependencies: ServiceDependency[]
): UseDependencySearchReturn {
  const [query, setQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Debounce search query (300ms delay)
  useEffect(() => {
    setIsSearching(true);

    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setIsSearching(false);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  // Transform ServiceDependency to DependencyExportData for search
  const searchableData = useMemo<DependencyExportData[]>(() => {
    if (!dependencies || dependencies.length === 0) {
      return [];
    }

    return dependencies.map((dep) => ({
      serviceName: dep.sourceServiceName || dep.sourceServiceId || 'Unknown',
      dependsOn: dep.targetServiceName || dep.targetServiceId || 'Unknown',
      type: 'direct' as const,
      status: dep.sourceServiceStatus || 'active',
      isCriticalPath: dep.isCritical,
      tags: dep.dependencyType ? [dep.dependencyType] : [],
    }));
  }, [dependencies]);

  // Perform search with memoization
  const results = useMemo<SearchResult<DependencyExportData>[]>(() => {
    if (!debouncedQuery || debouncedQuery.trim().length === 0) {
      // Return all dependencies as results when no query
      return searchableData.map((item) => ({ item }));
    }

    return searchDependencies(searchableData, debouncedQuery);
  }, [searchableData, debouncedQuery]);

  // Clear search handler
  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setIsSearching(false);
  }, []);

  // Check if search is active
  const hasActiveSearch = query.trim().length > 0;

  return {
    query,
    setQuery,
    results,
    isSearching,
    clearSearch,
    hasActiveSearch,
  };
}
