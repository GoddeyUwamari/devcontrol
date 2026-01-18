'use client';

import { useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportGraphToPNG } from '@/lib/export/graph-export';

interface ExportGraphButtonProps {
  graphRef: React.RefObject<HTMLDivElement> | null;
  disabled?: boolean;
}

export function ExportGraphButton({ graphRef, disabled = false }: ExportGraphButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!graphRef?.current) {
      toast.error('Graph not loaded. Please wait for the graph to render.');
      return;
    }

    try {
      setIsExporting(true);

      // Small delay to ensure UI updates before capture
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Export the graph
      await exportGraphToPNG(graphRef.current);

      toast.success('Graph exported successfully');
    } catch (error) {
      console.error('Graph export error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Graph export failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const isDisabled = disabled || !graphRef?.current || isExporting;

  return (
    <Button variant="outline" onClick={handleExport} disabled={isDisabled}>
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <ImageIcon className="h-4 w-4 mr-2" />
          Export Graph
        </>
      )}
    </Button>
  );
}
