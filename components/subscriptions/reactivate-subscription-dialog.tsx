"use client";

import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Subscription } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ReactivateSubscriptionDialogProps {
  subscription: Subscription | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReactivateSubscriptionDialog({
  subscription,
  open,
  onOpenChange,
}: ReactivateSubscriptionDialogProps) {
  const queryClient = useQueryClient();

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(
        `/api/billing/subscriptions/${id}/reactivate`
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Subscription reactivated successfully");
      onOpenChange(false);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || "Failed to reactivate subscription";
      toast.error(errorMessage);
    },
  });

  const handleReactivate = () => {
    if (subscription) {
      reactivateMutation.mutate(subscription.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reactivate Subscription</DialogTitle>
          <DialogDescription>
            Are you sure you want to reactivate this subscription? The billing
            cycle will resume from today.
          </DialogDescription>
        </DialogHeader>

        {subscription && (
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Subscription ID:</span>
              <span className="text-sm font-mono">{subscription.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Plan:</span>
              <span className="text-sm">{subscription.plan || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Current Status:</span>
              <span className="text-sm capitalize">{subscription.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Billing Cycle:</span>
              <span className="text-sm capitalize">{subscription.billingCycle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Price:</span>
              <span className="text-sm">
                {subscription.currency} {subscription.currentPrice.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={reactivateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReactivate}
            disabled={reactivateMutation.isPending}
          >
            {reactivateMutation.isPending
              ? "Reactivating..."
              : "Reactivate Subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
