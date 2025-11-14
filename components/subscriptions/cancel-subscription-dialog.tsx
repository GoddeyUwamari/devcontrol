"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface CancelSubscriptionDialogProps {
  subscription: Subscription | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelSubscriptionDialog({
  subscription,
  open,
  onOpenChange,
}: CancelSubscriptionDialogProps) {
  const queryClient = useQueryClient();
  const [immediately, setImmediately] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(
        `/api/billing/subscriptions/${id}/cancel`,
        { immediately }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Subscription cancelled successfully");
      onOpenChange(false);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || "Failed to cancel subscription";
      toast.error(errorMessage);
    },
  });

  const handleCancel = () => {
    if (subscription) {
      cancelMutation.mutate(subscription.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Subscription</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel this subscription? Choose when the
            cancellation should take effect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                <span className="text-sm text-muted-foreground">Status:</span>
                <span className="text-sm capitalize">{subscription.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Current Period Ends:</span>
                <span className="text-sm">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}

          <RadioGroup
            value={immediately ? "immediately" : "end_of_period"}
            onValueChange={(value) => setImmediately(value === "immediately")}
          >
            <div className="flex items-center space-x-2 p-3 border rounded-lg">
              <RadioGroupItem value="end_of_period" id="end_of_period" />
              <Label htmlFor="end_of_period" className="flex-1 cursor-pointer">
                <div className="font-medium">At end of billing period</div>
                <div className="text-sm text-muted-foreground">
                  Subscription will remain active until{" "}
                  {subscription &&
                    new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2 p-3 border rounded-lg">
              <RadioGroupItem value="immediately" id="immediately" />
              <Label htmlFor="immediately" className="flex-1 cursor-pointer">
                <div className="font-medium">Cancel immediately</div>
                <div className="text-sm text-muted-foreground">
                  Subscription will be cancelled right away
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelMutation.isPending}
          >
            Keep Subscription
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
