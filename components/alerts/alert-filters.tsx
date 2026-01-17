'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';

type DateRangeOption = '24h' | '7d' | '30d' | '90d' | 'custom';

interface AlertFiltersProps {
  dateRange: DateRangeOption;
  onDateRangeChange: (range: DateRangeOption) => void;
  severity: string;
  onSeverityChange: (severity: string) => void;
  status: string;
  onStatusChange: (status: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearFilters: () => void;
}

export function AlertFilters({
  dateRange,
  onDateRangeChange,
  severity,
  onSeverityChange,
  status,
  onStatusChange,
  searchQuery,
  onSearchChange,
  onClearFilters,
}: AlertFiltersProps) {
  const timeRangeOptions: { value: DateRangeOption; label: string }[] = [
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
  ];

  const hasActiveFilters = severity !== 'all' || status !== 'all' || searchQuery.length > 0;
  const filterCount = [severity !== 'all', status !== 'all', searchQuery.length > 0].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Time Range Selector - Segmented Control */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Time Range</Label>
        <div className="inline-flex bg-gray-100 rounded-lg p-1 gap-1">
          {timeRangeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onDateRangeChange(option.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                dateRange === option.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search Input */}
      <div className="space-y-2">
        <Label htmlFor="search" className="text-sm font-medium text-gray-700">
          Search Alerts
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            id="search"
            type="text"
            placeholder="Search by alert name or description..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Dropdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Severity Filter */}
        <div className="space-y-2">
          <Label htmlFor="severity" className="text-sm font-medium text-gray-700">
            Severity
          </Label>
          <Select value={severity} onValueChange={onSeverityChange}>
            <SelectTrigger id="severity">
              <SelectValue placeholder="All Severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Status Filter */}
        <div className="space-y-2">
          <Label htmlFor="status" className="text-sm font-medium text-gray-700">
            Status
          </Label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger id="status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="firing">Firing</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active Filters and Clear Button */}
      {hasActiveFilters && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{filterCount}</span>{' '}
            {filterCount === 1 ? 'filter' : 'filters'} applied
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-gray-600 hover:text-gray-900"
          >
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
