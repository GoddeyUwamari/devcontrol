'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModifierSymbol } from '@/lib/hooks/use-keyboard-shortcuts';

interface DependencySearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  resultsCount: number;
  totalCount: number;
  isSearching: boolean;
  onClear: () => void;
  autoFocus?: boolean;
  hasActiveFilters?: boolean;
  className?: string;
}

export interface DependencySearchHandle {
  focus: () => void;
  clear: () => void;
}

export const DependencySearch = forwardRef<DependencySearchHandle, DependencySearchProps>(
  function DependencySearch(
    {
      query,
      onQueryChange,
      resultsCount,
      totalCount,
      isSearching,
      onClear,
      autoFocus = false,
      hasActiveFilters = false,
      className,
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Expose focus and clear methods
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        onClear();
        inputRef.current?.blur();
      },
    }));

    // Auto-focus on mount if requested
    useEffect(() => {
      if (autoFocus && inputRef.current) {
        inputRef.current.focus();
      }
    }, [autoFocus]);

    // Handle ESC key to clear search
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && query) {
          event.preventDefault();
          onClear();
          inputRef.current?.blur();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [query, onClear]);

  const hasQuery = query.trim().length > 0;
  const showResults = hasQuery && !isSearching;
  const modSymbol = getModifierSymbol();

  return (
    <div className={cn('w-full space-y-2', className)}>
      {/* Search Input */}
      <div className="relative">
        {/* Search Icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Search dependencies..."
          className={cn(
            'w-full h-10 pl-9 pr-24',
            'border border-input rounded-md',
            'bg-background text-foreground',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
            'transition-all duration-200',
            'md:max-w-[400px]'
          )}
          aria-label="Search dependencies"
          aria-describedby={showResults ? 'search-results-count' : undefined}
        />

        {/* Keyboard Hint */}
        {!isFocused && !hasQuery && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 pointer-events-none">
            <kbd className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted border border-border rounded shadow-sm">
              {modSymbol}K
            </kbd>
          </div>
        )}

        {/* Loading Spinner or Clear Button */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isSearching ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : hasQuery ? (
            <button
              onClick={onClear}
              className={cn(
                'text-muted-foreground hover:text-foreground',
                'transition-colors duration-200',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm',
                'p-1'
              )}
              aria-label="Clear search"
              title="Clear search (ESC)"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Results Count */}
      {showResults && (
        <div
          id="search-results-count"
          className="text-sm text-muted-foreground px-1"
          role="status"
          aria-live="polite"
        >
          {resultsCount === 0 ? (
            <span>No dependencies found</span>
          ) : (
            <span>
              Showing {resultsCount} of {totalCount} {resultsCount === 1 ? 'dependency' : 'dependencies'}
              {hasActiveFilters && <span className="text-primary"> (filtered)</span>}
            </span>
          )}
        </div>
      )}

      {/* Keyboard Shortcut Hint (Optional) */}
      {!hasQuery && (
        <div className="text-xs text-muted-foreground px-1 hidden md:block">
          Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border border-border rounded">ESC</kbd> to clear search
        </div>
      )}
    </div>
  );
});
