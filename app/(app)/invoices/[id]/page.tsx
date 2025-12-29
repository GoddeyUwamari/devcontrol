'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { invoicesService } from '@/lib/services/invoices.service';
import { InvoiceActions } from '@/components/invoices/invoice-actions';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import { BackButton } from '@/components/navigation/back-button';

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesService.getWithItems(id),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-10 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="space-y-6 px-4 md:px-6 lg:px-8">
        <Breadcrumb
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Invoices', href: '/invoices' },
            { label: 'Invoice Details', current: true },
          ]}
        />
        <BackButton href="/invoices" label="Back to Invoices" />
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-red-500">Failed to load invoice</p>
            <p className="text-sm text-muted-foreground mt-2">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: invoice.currency || 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      paid: 'bg-green-100 text-green-700',
      open: 'bg-blue-100 text-blue-700',
      void: 'bg-red-100 text-red-700',
      uncollectible: 'bg-orange-100 text-orange-700',
    };

    return (
      <Badge className={variants[status] || 'bg-gray-100'} variant="secondary">
        {status.toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Invoices', href: '/invoices' },
          { label: invoice.invoiceNumber, current: true },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <BackButton href="/invoices" label="Back to Invoices" />
          </div>
          <h1 className="text-3xl font-bold">{invoice.invoiceNumber}</h1>
          <p className="text-muted-foreground">
            Created on {formatDate(invoice.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {invoice.pdfUrl && (
            <Button variant="outline" onClick={() => window.open(invoice.pdfUrl, '_blank')}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <InvoiceActions invoice={invoice} />
        </div>
      </div>

      {/* Invoice Details */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-1">{getStatusBadge(invoice.status)}</div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tenant</p>
              <p className="font-medium">{invoice.tenantName || invoice.tenantId}</p>
            </div>
            {invoice.subscriptionId && (
              <div>
                <p className="text-sm text-muted-foreground">Subscription ID</p>
                <p className="font-mono text-sm">{invoice.subscriptionId}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column */}
        <Card>
          <CardHeader>
            <CardTitle>Dates & Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Issue Date</p>
              <p className="font-medium">{formatDate(invoice.issueDate)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Due Date</p>
              <p className="font-medium">{formatDate(invoice.dueDate)}</p>
            </div>
            {invoice.paidAt && (
              <div>
                <p className="text-sm text-muted-foreground">Paid On</p>
                <p className="font-medium">{formatDate(invoice.paidAt)}</p>
              </div>
            )}
            {invoice.paymentMethod && (
              <div>
                <p className="text-sm text-muted-foreground">Payment Method</p>
                <p className="font-medium capitalize">{invoice.paymentMethod}</p>
              </div>
            )}
            {invoice.paymentReference && (
              <div>
                <p className="text-sm text-muted-foreground">Payment Reference</p>
                <p className="font-mono text-sm">{invoice.paymentReference}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing Period */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Period</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
          </p>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items && invoice.items.length > 0 ? (
                invoice.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {item.itemType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No line items added yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium">
                  Subtotal
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(invoice.subtotal)}
                </TableCell>
              </TableRow>
              {invoice.taxAmount > 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-medium">
                    Tax
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(invoice.taxAmount)}
                  </TableCell>
                </TableRow>
              )}
              {invoice.discountAmount > 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-medium">
                    Discount
                  </TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    -{formatCurrency(invoice.discountAmount)}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell colSpan={4} className="text-right text-lg font-bold">
                  Total
                </TableCell>
                <TableCell className="text-right text-lg font-bold">
                  {formatCurrency(invoice.totalAmount)}
                </TableCell>
              </TableRow>
              {invoice.amountPaid > 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-medium">
                    Amount Paid
                  </TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    {formatCurrency(invoice.amountPaid)}
                  </TableCell>
                </TableRow>
              )}
              {invoice.amountDue > 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-right text-lg font-bold">
                    Amount Due
                  </TableCell>
                  <TableCell className="text-right text-lg font-bold text-red-600">
                    {formatCurrency(invoice.amountDue)}
                  </TableCell>
                </TableRow>
              )}
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* Notes */}
      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
