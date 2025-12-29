'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { refundsService } from '@/lib/services/payments.service';
import { RefundFiltersComponent } from '@/components/refunds/refund-filters';
import { RefundList } from '@/components/refunds/refund-list';
import { Breadcrumb } from '@/components/navigation/breadcrumb';

interface RefundFilters {
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export default function RefundsPage() {
  const [filters, setFilters] = useState<RefundFilters>({
    page: 1,
    limit: 20,
  });

  // Fetch refunds using React Query
  const {
    data: refunds = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['refunds', filters],
    queryFn: async () => {
      // Note: The refunds service doesn't support filters yet,
      // but we're setting it up for future enhancement
      return await refundsService.getAll();
    },
  });

  const handleFiltersChange = (newFilters: RefundFilters) => {
    setFilters({
      ...newFilters,
      page: 1,
      limit: filters.limit,
    });
  };

  const handlePageChange = (page: number) => {
    setFilters({
      ...filters,
      page,
    });
  };

  const handleExportToCSV = () => {
    if (!refunds || refunds.length === 0) {
      return;
    }

    // Prepare CSV headers
    const headers = [
      'Date',
      'Amount',
      'Currency',
      'Status',
      'Reason',
      'Payment ID',
      'Refund ID',
    ];

    // Prepare CSV rows
    const rows = refunds.map((refund) => [
      new Date(refund.createdAt).toISOString(),
      (refund.amount / 100).toFixed(2),
      refund.currency.toUpperCase(),
      refund.status,
      refund.reason || '',
      refund.paymentId,
      refund.id,
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `refunds-${new Date().toISOString().split('T')[0]}.csv`
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculate total pages
  const totalPages = Math.ceil((refunds.length || 0) / (filters.limit || 20));

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Refunds', current: true },
        ]}
      />

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Refunds</h1>
          <p className="text-muted-foreground mt-2">
            View and manage all refund transactions
          </p>
        </div>
        <Button
          onClick={handleExportToCSV}
          variant="outline"
          disabled={!refunds || refunds.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Export to CSV
        </Button>
      </div>

      {/* Filter Controls */}
      <RefundFiltersComponent
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      {/* Refund List */}
      <RefundList
        refunds={refunds}
        isLoading={isLoading}
        error={error as Error | null}
        onRefetch={refetch}
        page={filters.page || 1}
        onPageChange={handlePageChange}
        totalPages={totalPages}
      />
    </div>
  );
}
