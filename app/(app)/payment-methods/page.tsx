'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, CreditCard, AlertCircle } from 'lucide-react';
import { paymentMethodsService } from '@/lib/services/payments.service';
import { PaymentMethodCard } from '@/components/payment-methods/payment-method-card';
import { AddPaymentMethodDialog } from '@/components/payment-methods/add-payment-method-dialog';
import { Breadcrumb } from '@/components/navigation/breadcrumb';

export default function PaymentMethodsPage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const {
    data: paymentMethods = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => paymentMethodsService.getAll(),
  });

  // Loading State
  if (isLoading) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8">
        <Skeleton className="h-5 w-64" />
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-5 w-96 mt-2" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Payment Methods', current: true },
          ]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
            <p className="text-muted-foreground mt-2">
              Manage saved payment methods
            </p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Payment Method
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
          <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <div className="text-center space-y-2">
            <p className="font-medium text-foreground">Failed to load payment methods</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An error occurred'}
            </p>
          </div>
          <Button onClick={() => refetch()} variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Empty State
  if (!paymentMethods || paymentMethods.length === 0) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Payment Methods', current: true },
          ]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
            <p className="text-muted-foreground mt-2">
              Manage your saved payment methods
            </p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Payment Method
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <CreditCard className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center space-y-2">
            <p className="font-medium text-foreground">No payment methods</p>
            <p className="text-sm text-muted-foreground">
              Add your first payment method to get started
            </p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Payment Method
          </Button>
        </div>

        <AddPaymentMethodDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      </div>
    );
  }

  // Payment Methods Grid
  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payment Methods', current: true },
        ]}
      />

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
          <p className="text-muted-foreground mt-2">
            Manage your saved payment methods ({paymentMethods.length})
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Payment Method
        </Button>
      </div>

      {/* Payment Methods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {paymentMethods.map((method) => (
          <PaymentMethodCard key={method.id} paymentMethod={method} />
        ))}
      </div>

      <AddPaymentMethodDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}
