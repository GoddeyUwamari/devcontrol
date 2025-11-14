"use client";

import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Invoice } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface VoidInvoiceDialogProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoidInvoiceDialog({
  invoice,
  open,
  onOpenChange,
}: VoidInvoiceDialogProps) {
  const queryClient = useQueryClient();

  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/billing/invoices/${id}/void`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Invoice voided successfully");
      onOpenChange(false);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || "Failed to void invoice";
      toast.error(errorMessage);
    },
  });

  const handleVoid = () => {
    if (invoice) {
      voidMutation.mutate(invoice.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Invoice</DialogTitle>
          <DialogDescription>
            Are you sure you want to void this invoice? This action cannot be
            undone. The invoice will be marked as void and will no longer be
            collectible.
          </DialogDescription>
        </DialogHeader>

        {invoice && (
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Invoice Number:</span>
              <span className="text-sm font-mono">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Status:</span>
              <span className="text-sm capitalize">{invoice.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Amount:</span>
              <span className="text-sm font-medium">
                {invoice.currency} {invoice.totalAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Amount Due:</span>
              <span className="text-sm">
                {invoice.currency} {invoice.amountDue.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">
            <strong>Warning:</strong> Voiding this invoice will permanently mark
            it as uncollectible. This action cannot be reversed.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={voidMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={voidMutation.isPending}
          >
            {voidMutation.isPending ? "Voiding..." : "Void Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
