'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, Copy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { paymentsService } from '@/lib/services/payments.service';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { IssueRefundDialog } from '@/components/payments/issue-refund-dialog';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import { BackButton } from '@/components/navigation/back-button';

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: payment, isLoading, error } = useQuery({
    queryKey: ['payment', id],
    queryFn: () => paymentsService.getById(id),
  });

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadReceipt = () => {
    // This would integrate with a PDF generation service or backend endpoint
    console.log('Download receipt for payment:', id);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8 max-w-5xl mx-auto">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8 max-w-5xl mx-auto">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Payments', href: '/payments' },
            { label: 'Payment Details', current: true },
          ]}
        />
        <BackButton href="/payments" label="Back to Payments" />
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-red-500">Failed to load payment</p>
            <p className="text-sm text-muted-foreground mt-2">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canRefund = payment.status === 'succeeded';

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payments', href: '/payments' },
          { label: payment.transactionId, current: true },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <BackButton href="/payments" label="Back to Payments" />
          </div>
          <h1 className="text-3xl font-bold">Payment Details</h1>
          <p className="text-muted-foreground">
            {formatDate(payment.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleDownloadReceipt}>
            <Download className="h-4 w-4 mr-2" />
            Receipt
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          {canRefund && (
            <Button onClick={() => setRefundDialogOpen(true)}>
              Issue Refund
            </Button>
          )}
        </div>
      </div>

      {/* Payment Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-bold">
                {formatCurrency(payment.amount, payment.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-1">
                <PaymentStatusBadge status={payment.status} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Information */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Transaction ID</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-sm">{payment.transactionId}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(payment.transactionId, 'transaction')}
                  className="h-6 w-6 p-0"
                >
                  {copiedField === 'transaction' ? (
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Payment ID</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-sm">{payment.id}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(payment.id, 'payment')}
                  className="h-6 w-6 p-0"
                >
                  {copiedField === 'payment' ? (
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Payment Method</p>
              <p className="font-medium capitalize">
                {payment.paymentMethodType || payment.paymentMethod}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Currency</p>
              <p className="font-medium">{payment.currency.toUpperCase()}</p>
            </div>
          </CardContent>
        </Card>

        {/* Right Column */}
        <Card>
          <CardHeader>
            <CardTitle>Customer & Invoice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payment.customerId && (
              <div>
                <p className="text-sm text-muted-foreground">Customer ID</p>
                <p className="font-mono text-sm">{payment.customerId}</p>
              </div>
            )}
            {payment.customerName && (
              <div>
                <p className="text-sm text-muted-foreground">Customer Name</p>
                <p className="font-medium">{payment.customerName}</p>
              </div>
            )}
            {payment.invoiceId ? (
              <div>
                <p className="text-sm text-muted-foreground">Associated Invoice</p>
                <Button
                  variant="link"
                  className="h-auto p-0 font-mono text-sm"
                  onClick={() => router.push(`/invoices/${payment.invoiceId}`)}
                >
                  {payment.invoiceId}
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">Associated Invoice</p>
                <p className="text-sm">No invoice associated</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Payment Date</p>
              <p className="font-medium">{formatDate(payment.createdAt)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description/Metadata */}
      {(payment.description || payment.metadata) && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payment.description && (
              <div>
                <p className="text-sm text-muted-foreground">Description</p>
                <p className="mt-1">{payment.description}</p>
              </div>
            )}
            {payment.metadata && Object.keys(payment.metadata).length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Metadata</p>
                <div className="bg-muted rounded-md p-3 font-mono text-xs">
                  <pre>{JSON.stringify(payment.metadata, null, 2)}</pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Refund Dialog */}
      <IssueRefundDialog
        open={refundDialogOpen}
        onOpenChange={setRefundDialogOpen}
        payment={payment}
      />
    </div>
  );
}
