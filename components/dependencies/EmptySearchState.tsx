'use client';

import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptySearchStateProps {
  query: string;
  onClear: () => void;
}

export function EmptySearchState({ query, onClear }: EmptySearchStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      {/* Icon */}
      <div className="mb-4 rounded-full bg-muted p-3">
        <SearchX className="h-8 w-8 text-muted-foreground" />
      </div>

      {/* Message */}
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No dependencies found
      </h3>

      <p className="text-sm text-muted-foreground text-center max-w-md mb-1">
        No dependencies match your search for{' '}
        <span className="font-medium text-foreground">"{query}"</span>
      </p>

      <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
        Try adjusting your search terms or clear the search to see all dependencies.
      </p>

      {/* Clear Button */}
      <Button variant="outline" onClick={onClear}>
        Clear search
      </Button>

      {/* Search Tips (Optional) */}
      <div className="mt-8 p-4 bg-muted rounded-lg max-w-md">
        <h4 className="text-sm font-medium text-foreground mb-2">Search tips:</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Search by service name (e.g., "auth", "api")</li>
          <li>• Search by dependency type (e.g., "runtime", "data")</li>
          <li>• Search is fuzzy - typos are okay!</li>
          <li>• Press ESC to clear your search</li>
        </ul>
      </div>
    </div>
  );
}
