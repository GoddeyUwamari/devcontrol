'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { invoicesService } from '@/lib/services/invoices.service';
import type { Invoice, RecordPaymentPayload } from '@/lib/types';

interface InvoiceActionsProps {
  invoice: Invoice;
}

export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const queryClient = useQueryClient();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<RecordPaymentPayload>({
    defaultValues: {
      paymentAmount: invoice.amountDue || 0,
      paymentMethod: 'card',
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (data: RecordPaymentPayload) => invoicesService.recordPayment(invoice.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Payment recorded successfully');
      setPaymentDialogOpen(false);
      reset();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to record payment');
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () => invoicesService.finalize(invoice.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice finalized successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to finalize invoice');
    },
  });

  const voidMutation = useMutation({
    mutationFn: () => invoicesService.void(invoice.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice voided successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to void invoice');
    },
  });

  const uncollectibleMutation = useMutation({
    mutationFn: () => invoicesService.markUncollectible(invoice.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice marked as uncollectible');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to mark as uncollectible');
    },
  });

  const handleFinalize = () => {
    if (confirm('Are you sure you want to finalize this invoice? This action cannot be undone.')) {
      finalizeMutation.mutate();
    }
  };

  const handleVoid = () => {
    if (confirm('Are you sure you want to void this invoice? This action cannot be undone.')) {
      voidMutation.mutate();
    }
  };

  const handleUncollectible = () => {
    if (
      confirm(
        'Are you sure you want to mark this invoice as uncollectible? This action cannot be undone.'
      )
    ) {
      uncollectibleMutation.mutate();
    }
  };

  const onPaymentSubmit = (data: RecordPaymentPayload) => {
    recordPaymentMutation.mutate(data);
  };

  const isDraft = invoice.status === 'draft';
  const isOpen = invoice.status === 'open';
  const isPaid = invoice.status === 'paid';
  const isVoid = invoice.status === 'void';
  const isUncollectible = invoice.status === 'uncollectible';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => (window.location.href = `/invoices/${invoice.id}`)}>
            View Details
          </DropdownMenuItem>

          {invoice.pdfUrl && (
            <DropdownMenuItem onClick={() => window.open(invoice.pdfUrl, '_blank')}>
              Download PDF
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {isDraft && (
            <DropdownMenuItem onClick={handleFinalize}>
              Finalize Invoice
            </DropdownMenuItem>
          )}

          {isOpen && (
            <DropdownMenuItem onClick={() => setPaymentDialogOpen(true)}>
              Record Payment
            </DropdownMenuItem>
          )}

          {(isDraft || isOpen) && (
            <DropdownMenuItem onClick={handleVoid} className="text-red-600">
              Void Invoice
            </DropdownMenuItem>
          )}

          {isOpen && (
            <DropdownMenuItem onClick={handleUncollectible} className="text-orange-600">
              Mark Uncollectible
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Record Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onPaymentSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="paymentAmount">Payment Amount *</Label>
              <Input
                id="paymentAmount"
                type="number"
                step="0.01"
                {...register('paymentAmount', {
                  required: 'Payment amount is required',
                  valueAsNumber: true,
                  min: { value: 0.01, message: 'Amount must be greater than 0' },
                  max: {
                    value: invoice.amountDue,
                    message: 'Amount cannot exceed amount due',
                  },
                })}
                placeholder="0.00"
              />
              {errors.paymentAmount && (
                <p className="text-sm text-red-500">{errors.paymentAmount.message}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Amount Due: ${invoice.amountDue.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method *</Label>
              <Input
                id="paymentMethod"
                {...register('paymentMethod', { required: 'Payment method is required' })}
                placeholder="e.g., card, bank_transfer, cash"
              />
              {errors.paymentMethod && (
                <p className="text-sm text-red-500">{errors.paymentMethod.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentReference">Payment Reference</Label>
              <Input
                id="paymentReference"
                {...register('paymentReference')}
                placeholder="e.g., transaction ID"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPaymentDialogOpen(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={recordPaymentMutation.isPending}>
                {recordPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
