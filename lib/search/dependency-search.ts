import Fuse from 'fuse.js';
import type { DependencyExportData } from '@/types/export';

/**
 * Search result with relevance score and matched fields
 */
export interface SearchResult<T> {
  item: T;
  score?: number;
  matches?: Array<{
    key?: string;
    value?: string;
    indices?: ReadonlyArray<readonly [number, number]>;
  }>;
}

/**
 * Configuration for dependency search
 */
const SEARCH_OPTIONS: Fuse.IFuseOptions<DependencyExportData> = {
  // Threshold: 0.0 = perfect match, 1.0 = match anything
  // 0.3 provides good balance between strict and loose matching
  threshold: 0.3,

  // Include score and matches in results
  includeScore: true,
  includeMatches: true,

  // Minimum character length before fuzzy matching
  minMatchCharLength: 1,

  // Fields to search with weighted scoring
  keys: [
    {
      name: 'serviceName',
      weight: 2.0, // Highest priority
    },
    {
      name: 'dependsOn',
      weight: 2.0, // Highest priority
    },
    {
      name: 'type',
      weight: 1.0,
    },
    {
      name: 'status',
      weight: 1.0,
    },
    {
      name: 'tags',
      weight: 0.8, // Lower priority for tags
    },
  ],

  // Enable extended search for special operators
  useExtendedSearch: false,

  // Distance between two matching characters
  distance: 100,

  // Ignore location of matches (search entire field)
  ignoreLocation: true,
};

/**
 * Searches dependencies using fuzzy matching
 * Returns ranked results with most relevant items first
 *
 * @param dependencies - Array of dependencies to search
 * @param query - Search query string
 * @returns Array of search results with scores and matches
 */
export function searchDependencies(
  dependencies: DependencyExportData[],
  query: string
): SearchResult<DependencyExportData>[] {
  // Handle empty query - return all dependencies
  if (!query || query.trim().length === 0) {
    return dependencies.map((item) => ({ item }));
  }

  // Handle empty dependencies array
  if (!dependencies || dependencies.length === 0) {
    return [];
  }

  // Sanitize query (trim whitespace, handle special characters)
  const sanitizedQuery = query.trim();

  try {
    // Initialize Fuse instance
    const fuse = new Fuse(dependencies, SEARCH_OPTIONS);

    // Perform search
    const results = fuse.search(sanitizedQuery);

    // Transform Fuse results to our SearchResult format
    return results.map((result) => ({
      item: result.item,
      score: result.score,
      matches: result.matches?.map((match) => ({
        key: match.key,
        value: match.value,
        indices: match.indices,
      })),
    }));
  } catch (error) {
    console.error('Search error:', error);
    // Fallback to basic filtering on error
    return dependencies
      .filter((dep) => {
        const searchString = `
          ${dep.serviceName}
          ${dep.dependsOn}
          ${dep.type}
          ${dep.status}
          ${dep.tags.join(' ')}
        `.toLowerCase();

        return searchString.includes(sanitizedQuery.toLowerCase());
      })
      .map((item) => ({ item }));
  }
}

/**
 * Highlights matching text in a string based on match indices
 * Returns an array of segments with highlighted flag
 *
 * @param text - Original text
 * @param indices - Array of [start, end] indices to highlight
 * @returns Array of text segments with highlighting info
 */
export function highlightMatches(
  text: string,
  indices?: ReadonlyArray<readonly [number, number]>
): Array<{ text: string; highlight: boolean }> {
  if (!indices || indices.length === 0) {
    return [{ text, highlight: false }];
  }

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;

  // Sort indices by start position
  const sortedIndices = [...indices].sort((a, b) => a[0] - b[0]);

  sortedIndices.forEach(([start, end]) => {
    // Add non-highlighted text before this match
    if (start > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, start),
        highlight: false,
      });
    }

    // Add highlighted text
    segments.push({
      text: text.substring(start, end + 1),
      highlight: true,
    });

    lastIndex = end + 1;
  });

  // Add remaining non-highlighted text
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      highlight: false,
    });
  }

  return segments;
}
