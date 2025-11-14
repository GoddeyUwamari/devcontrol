"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Invoice, RecordPaymentPayload } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const recordPaymentSchema = z.object({
  paymentAmount: z.coerce.number().positive("Amount must be positive"),
  paymentMethod: z.string().min(1, "Payment method is required"),
  paymentReference: z.string().optional(),
});

type RecordPaymentFormValues = z.infer<typeof recordPaymentSchema>;

interface RecordPaymentDialogProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordPaymentDialog({
  invoice,
  open,
  onOpenChange,
}: RecordPaymentDialogProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<RecordPaymentFormValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      paymentAmount: invoice?.amountDue || 0,
      paymentMethod: "credit_card",
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: RecordPaymentPayload) => {
      const response = await api.post(
        `/api/billing/invoices/${invoice?.id}/payment`,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Payment recorded successfully");
      form.reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || "Failed to record payment";
      toast.error(errorMessage);
    },
  });

  const onSubmit = async (data: RecordPaymentFormValues) => {
    setIsLoading(true);
    try {
      await recordPaymentMutation.mutateAsync(data);
    } finally {
      setIsLoading(false);
    }
  };

  // Reset form when invoice changes
  if (invoice && open) {
    form.setValue("paymentAmount", invoice.amountDue);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Record a payment for this invoice. The invoice status will be
            updated automatically.
          </DialogDescription>
        </DialogHeader>

        {invoice && (
          <div className="p-4 bg-muted rounded-lg space-y-2 mb-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Invoice Number:</span>
              <span className="text-sm font-mono">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Amount:</span>
              <span className="text-sm font-medium">
                {invoice.currency} {invoice.totalAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Amount Paid:</span>
              <span className="text-sm">
                {invoice.currency} {invoice.amountPaid.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-sm font-medium">Amount Due:</span>
              <span className="text-sm font-bold">
                {invoice.currency} {invoice.amountDue.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="paymentAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Amount *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="debit_card">Debit Card</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Reference (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Transaction ID, check number, etc."
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
