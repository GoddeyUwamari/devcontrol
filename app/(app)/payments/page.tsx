'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { paymentsService } from '@/lib/services/payments.service';
import { PaymentFiltersComponent } from '@/components/payments/payment-filters';
import { PaymentList } from '@/components/payments/payment-list';
import { PaymentStatsCards } from '@/components/payments/payment-stats-cards';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import type { PaymentFilters } from '@/lib/types';

export default function PaymentsPage() {
  const [filters, setFilters] = useState<PaymentFilters>({
    page: 1,
    limit: 20,
  });

  // Fetch payments using React Query
  const {
    data: payments = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payments', filters],
    queryFn: async () => {
      return await paymentsService.getAll(filters);
    },
  });

  const handleFiltersChange = (newFilters: PaymentFilters) => {
    setFilters({
      ...newFilters,
      page: 1, // Reset to page 1 when filters change
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
    if (!payments || payments.length === 0) {
      return;
    }

    // Prepare CSV headers
    const headers = [
      'Date',
      'Amount',
      'Currency',
      'Status',
      'Payment Method',
      'Invoice ID',
      'Customer',
      'Transaction ID',
    ];

    // Prepare CSV rows
    const rows = payments.map((payment) => [
      new Date(payment.createdAt).toISOString(),
      (payment.amount / 100).toFixed(2),
      payment.currency.toUpperCase(),
      payment.status,
      payment.paymentMethodType || payment.paymentMethod,
      payment.invoiceId || '',
      payment.customerName || payment.customerId || '',
      payment.transactionId,
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
      `payments-${new Date().toISOString().split('T')[0]}.csv`
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculate total pages (assuming backend returns this or we calculate from data length)
  const totalPages = Math.ceil((payments.length || 0) / (filters.limit || 20));

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payments', current: true },
        ]}
      />

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground mt-2">
            View and manage all payment transactions
          </p>
        </div>
        <Button
          onClick={handleExportToCSV}
          variant="outline"
          disabled={!payments || payments.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Export to CSV
        </Button>
      </div>

      {/* Stats Cards */}
      <PaymentStatsCards />

      {/* Filter Controls */}
      <PaymentFiltersComponent
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />

      {/* Payment List */}
      <PaymentList
        payments={payments}
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
