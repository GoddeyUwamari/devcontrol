'use client';

import { forwardRef, useRef, useImperativeHandle } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { FilterState } from '@/lib/hooks/use-dependency-filters';
import { cn } from '@/lib/utils';
import { getModifierSymbol } from '@/lib/hooks/use-keyboard-shortcuts';

interface DependencyFiltersProps {
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string) => void;
  onClearFilters: () => void;
  activeCount: number;
  className?: string;
}

export interface DependencyFiltersHandle {
  focusFirst: () => void;
}

export const DependencyFilters = forwardRef<DependencyFiltersHandle, DependencyFiltersProps>(
  function DependencyFilters(
    {
      filters,
      onFilterChange,
      onClearFilters,
      activeCount,
      className,
    },
    ref
  ) {
    const firstFilterRef = useRef<HTMLButtonElement>(null);
    const modSymbol = getModifierSymbol();

    // Expose focus method
    useImperativeHandle(ref, () => ({
      focusFirst: () => {
        firstFilterRef.current?.click();
      },
    }));

    return (
      <div className={cn('flex flex-col sm:flex-row items-start sm:items-center gap-3', className)}>
        {/* Filter Icon and Label */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span className="font-medium">Filters:</span>
          <kbd className="hidden md:inline-block px-1.5 py-0.5 text-xs bg-muted border border-border rounded">
            {modSymbol}⇧F
          </kbd>
        </div>

      {/* Filter Dropdowns */}
      <div className="flex flex-wrap items-center gap-2 flex-1">
        {/* Type Filter */}
        <div className="relative">
          <Select
            value={filters.type}
            onValueChange={(value) => onFilterChange('type', value)}
          >
            <SelectTrigger ref={firstFilterRef} className="h-9 w-[140px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="transitive">Transitive</SelectItem>
            </SelectContent>
          </Select>
          {filters.type !== 'all' && (
            <Badge
              variant="default"
              className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
            >
              1
            </Badge>
          )}
        </div>

        {/* Status Filter */}
        <div className="relative">
          <Select
            value={filters.status}
            onValueChange={(value) => onFilterChange('status', value)}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="deprecated">Deprecated</SelectItem>
            </SelectContent>
          </Select>
          {filters.status !== 'all' && (
            <Badge
              variant="default"
              className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
            >
              1
            </Badge>
          )}
        </div>

        {/* Critical Path Filter */}
        <div className="relative">
          <Select
            value={filters.criticalPath}
            onValueChange={(value) => onFilterChange('criticalPath', value)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Critical Path" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dependencies</SelectItem>
              <SelectItem value="critical">Critical Only</SelectItem>
              <SelectItem value="non-critical">Non-Critical</SelectItem>
            </SelectContent>
          </Select>
          {filters.criticalPath !== 'all' && (
            <Badge
              variant="default"
              className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
            >
              1
            </Badge>
          )}
        </div>

        {/* Clear Filters Button */}
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-9 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear {activeCount > 1 ? `all (${activeCount})` : 'filter'}
          </Button>
        )}
      </div>
    </div>
  );
});
