'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { cancelSubscription } from '@/lib/services/stripe.service';
import { toast } from 'sonner';

interface CancelSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  currentPeriodEnd?: number;
}

export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  onSuccess,
  currentPeriodEnd,
}: CancelSubscriptionDialogProps) {
  const [loading, setLoading] = useState(false);

  const getEndDate = () => {
    if (!currentPeriodEnd) return 'the end of your billing period';
    return new Date(currentPeriodEnd * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleCancel = async () => {
    setLoading(true);

    try {
      const result = await cancelSubscription(false); // Cancel at period end

      if (result.success) {
        toast.success('Subscription Cancelled', {
          description: `Your subscription will be cancelled on ${getEndDate()}.`,
        });
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error('Error', {
          description: result.error || 'Failed to cancel subscription',
        });
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to cancel subscription',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/20 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            </div>
            <DialogTitle>Cancel Subscription?</DialogTitle>
          </div>
          <DialogDescription className="space-y-3 pt-2">
            <p>Are you sure you want to cancel your subscription?</p>
            <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
              <p className="font-medium text-foreground">What happens next:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>You'll keep access until {getEndDate()}</li>
                <li>No further charges will be made</li>
                <li>You'll be downgraded to the Free plan</li>
                <li>You can reactivate anytime before the end date</li>
              </ul>
            </div>
            <p className="text-sm">
              You can always upgrade again later if you change your mind.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Keep Subscription
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={loading}
          >
            {loading ? 'Cancelling...' : 'Cancel Subscription'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
