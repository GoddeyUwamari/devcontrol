'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Loader2 } from 'lucide-react';
import { refundsService } from '@/lib/services/payments.service';
import type { Payment } from '@/lib/types';
import { useRouter } from 'next/navigation';

interface IssueRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment;
}

export function IssueRefundDialog({ open, onOpenChange, payment }: IssueRefundDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [error, setError] = useState<string>('');

  const maxRefundAmount = payment.amount / 100;

  const mutation = useMutation({
    mutationFn: (data: { paymentId: string; amount?: number; reason?: string }) =>
      refundsService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment', payment.id] });
      queryClient.invalidateQueries({ queryKey: ['refunds'] });
      onOpenChange(false);
      resetForm();
      router.push('/refunds');
    },
    onError: (error: Error) => {
      setError(error.message || 'Failed to issue refund');
    },
  });

  const resetForm = () => {
    setAmount('');
    setReason('');
    setCustomReason('');
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const refundAmount = amount ? parseFloat(amount) : undefined;

    if (refundAmount && (refundAmount <= 0 || refundAmount > maxRefundAmount)) {
      setError(`Refund amount must be between $0.01 and $${maxRefundAmount.toFixed(2)}`);
      return;
    }

    if (!reason) {
      setError('Please select a refund reason');
      return;
    }

    const finalReason = reason === 'other' ? customReason : reason;

    if (!finalReason) {
      setError('Please provide a reason for the refund');
      return;
    }

    mutation.mutate({
      paymentId: payment.id,
      amount: refundAmount ? Math.round(refundAmount * 100) : undefined,
      reason: finalReason,
    });
  };

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Issue Refund</DialogTitle>
          <DialogDescription>
            This is an administrative billing action restricted to organization owners and admins.
            It calls Stripe directly and cannot be undone. Leave amount blank for a full refund.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment Info */}
          <div className="rounded-lg border p-4 space-y-2 bg-muted/50">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Original Payment</span>
              <span className="text-sm font-medium">
                {formatCurrency(payment.amount, payment.currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Transaction ID</span>
              <span className="text-sm font-mono">{payment.transactionId}</span>
            </div>
          </div>

          {/* Refund Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Refund Amount (Optional - leave blank for full refund)
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={maxRefundAmount}
              placeholder={`Max: $${maxRefundAmount.toFixed(2)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Full refund: {formatCurrency(payment.amount, payment.currency)}
            </p>
          </div>

          {/* Refund Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Refund</Label>
            <Select value={reason} onValueChange={setReason} disabled={mutation.isPending}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duplicate">Duplicate Payment</SelectItem>
                <SelectItem value="fraudulent">Fraudulent</SelectItem>
                <SelectItem value="requested_by_customer">Requested by Customer</SelectItem>
                <SelectItem value="service_not_provided">Service Not Provided</SelectItem>
                <SelectItem value="product_defective">Product Defective</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Reason */}
          {reason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="customReason">Custom Reason</Label>
              <Textarea
                id="customReason"
                placeholder="Provide details about the refund reason..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                disabled={mutation.isPending}
                rows={3}
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                resetForm();
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Issue Refund
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
