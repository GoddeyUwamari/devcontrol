'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, PauseCircle, ArrowDownCircle, XCircle } from 'lucide-react';
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
  const [showImmediateOption, setShowImmediateOption] = useState(false);

  const getEndDate = () => {
    if (!currentPeriodEnd) return 'the end of your billing period';
    return new Date(currentPeriodEnd * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after dialog animation completes
    setTimeout(() => setShowImmediateOption(false), 200);
  };

  const handleSwitchToFree = async () => {
    setLoading(true);
    try {
      const result = await cancelSubscription(false);
      if (result.success) {
        toast.success('Subscription Cancelled', {
          description: `You'll keep access until ${getEndDate()}, then move to the Free plan.`,
        });
        onSuccess();
        handleClose();
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

  const handleCancelImmediately = async () => {
    setLoading(true);
    try {
      const result = await cancelSubscription(true);
      if (result.success) {
        toast.success('Subscription Cancelled', {
          description: 'Your subscription has been cancelled. Access has ended.',
        });
        onSuccess();
        handleClose();
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/20 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            </div>
            <DialogTitle>Before you cancel…</DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground pt-1">
            Choose what works best for you.
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Option A — Pause (coming soon) */}
          <div className="relative rounded-xl border border-border p-4 opacity-60 cursor-not-allowed select-none">
            <div className="flex items-start gap-3">
              <PauseCircle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold">Pause instead</span>
                  <Badge variant="secondary" className="text-xs px-2 py-0">
                    Coming soon
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Temporarily pause your subscription and resume when ready.
                </p>
              </div>
            </div>
          </div>

          {/* Option B — Switch to Free */}
          <button
            onClick={handleSwitchToFree}
            disabled={loading}
            className="w-full text-left rounded-xl border border-primary/40 hover:border-primary hover:bg-primary/5 p-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-start gap-3">
              <ArrowDownCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-0.5">
                  {loading ? 'Processing…' : 'Switch to Free'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Keep full access until <span className="font-medium text-foreground">{getEndDate()}</span>, then
                  move to the Free plan. No further charges.
                </p>
              </div>
            </div>
          </button>

          {/* Option C — Cancel immediately (revealed by link) */}
          {showImmediateOption && (
            <button
              onClick={handleCancelImmediately}
              disabled={loading}
              className="w-full text-left rounded-xl border border-destructive/40 hover:border-destructive hover:bg-destructive/5 p-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-destructive mb-0.5">
                    {loading ? 'Processing…' : 'Cancel immediately'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Access ends now. You will not receive a refund for the remaining period.
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* Reveal link for Option C */}
          {!showImmediateOption && (
            <div className="pt-1 text-center">
              <button
                onClick={() => setShowImmediateOption(true)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                I still want to cancel immediately
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Keep Subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
