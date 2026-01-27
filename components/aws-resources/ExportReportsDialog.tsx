/**
 * ExportReportsDialog Component
 * Allows Pro+ users to export AWS resource data to CSV or PDF
 */

'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { FileText, Download, FileSpreadsheet } from 'lucide-react';
import { api } from '@/lib/api';

interface ExportReportsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalResources: number;
  filters?: any;
}

type ExportFormat = 'csv' | 'pdf';

const EXPORT_COLUMNS = [
  { id: 'resource_name', label: 'Resource Name', default: true },
  { id: 'resource_type', label: 'Resource Type', default: true },
  { id: 'region', label: 'Region', default: true },
  { id: 'team', label: 'Team', default: true },
  { id: 'service', label: 'Service', default: true },
  { id: 'environment', label: 'Environment', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'cost', label: 'Monthly Cost', default: true },
  { id: 'security', label: 'Security Status', default: true },
  { id: 'compliance', label: 'Compliance Issues', default: true },
  { id: 'tags', label: 'Tags', default: false },
  { id: 'created_at', label: 'Created Date', default: false },
];

export function ExportReportsDialog({
  open,
  onOpenChange,
  totalResources,
  filters,
}: ExportReportsDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    EXPORT_COLUMNS.filter(c => c.default).map(c => c.id)
  );
  const [isExporting, setIsExporting] = useState(false);

  const toggleColumn = (columnId: string) => {
    setSelectedColumns(prev =>
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  };

  const handleExport = async () => {
    if (selectedColumns.length === 0) {
      toast.error('Please select at least one column to export');
      return;
    }

    setIsExporting(true);

    try {
      // Call API with responseType: 'blob'
      const response = await api.post('/api/aws-resources/export', {
        format,
        columns: selectedColumns,
        filters, // Pass filters from props
      }, {
        responseType: 'blob',
      });

      // Create blob and download link
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/pdf',
      });
      const url = window.URL.createObjectURL(blob);

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
      const filename = `aws-resources-${timestamp}.${format}`;

      // Trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Export generated successfully`, {
        description: `${totalResources} resources exported to ${format.toUpperCase()}`,
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Export failed:', error);

      // Handle blob error responses
      let errorMessage = 'Failed to generate export';
      if (error.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // Use default message if parsing fails
        }
      } else {
        errorMessage = error.response?.data?.message || error.message || errorMessage;
      }

      toast.error('Export failed', {
        description: errorMessage,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <Download className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <DialogTitle>Export Resources</DialogTitle>
              <DialogDescription>
                Export {totalResources} AWS resource{totalResources !== 1 ? 's' : ''} to CSV or PDF
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Export Format</Label>
            <RadioGroup value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                    format === 'csv'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setFormat('csv')}
                >
                  <RadioGroupItem value="csv" id="csv" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      <Label htmlFor="csv" className="font-medium cursor-pointer">
                        CSV (Excel)
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Best for data analysis and pivot tables
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                    format === 'pdf'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setFormat('pdf')}
                >
                  <RadioGroupItem value="pdf" id="pdf" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-red-600" />
                      <Label htmlFor="pdf" className="font-medium cursor-pointer">
                        PDF Report
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Best for sharing and compliance audits
                    </p>
                  </div>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Column Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Select Columns</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedColumns(EXPORT_COLUMNS.map(c => c.id))}
                  className="text-xs"
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedColumns([])}
                  className="text-xs"
                >
                  Clear All
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
              {EXPORT_COLUMNS.map((column) => (
                <div
                  key={column.id}
                  className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleColumn(column.id)}
                >
                  <Checkbox
                    id={column.id}
                    checked={selectedColumns.includes(column.id)}
                    onCheckedChange={() => toggleColumn(column.id)}
                  />
                  <Label
                    htmlFor={column.id}
                    className="text-sm cursor-pointer flex-1"
                  >
                    {column.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Format:</span>
              <span className="font-medium">{format.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Columns:</span>
              <span className="font-medium">{selectedColumns.length} selected</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Resources:</span>
              <span className="font-medium">{totalResources} row{totalResources !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || selectedColumns.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? 'Generating...' : `Export ${format.toUpperCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
