'use client';

import { CheckCircle2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDelete: () => void;
  onClear: () => void;
  isLoading?: boolean;
}

export function BulkActionBar({
  selectedCount,
  onAcknowledge,
  onResolve,
  onDelete,
  onClear,
  isLoading = false,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white rounded-lg shadow-2xl border border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-sm font-semibold text-blue-700">{selectedCount}</span>
            </div>
            <span className="text-sm font-medium text-gray-700">
              {selectedCount === 1 ? '1 alert selected' : `${selectedCount} alerts selected`}
            </span>
          </div>

          <div className="h-6 w-px bg-gray-300" />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onAcknowledge}
              disabled={isLoading}
              className="bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Acknowledge
            </Button>

            <Button
              size="sm"
              onClick={onResolve}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Resolve
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              disabled={isLoading}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>

          <div className="h-6 w-px bg-gray-300" />

          <button
            onClick={onClear}
            disabled={isLoading}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
          >
            Clear selection
          </button>
        </div>
      </div>
    </div>
  );
}
