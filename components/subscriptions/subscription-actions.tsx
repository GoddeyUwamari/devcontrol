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
import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { subscriptionsService } from '@/lib/services/subscriptions.service';
import type { Subscription } from '@/lib/types';
import { SubscriptionFormDialog } from './subscription-form-dialog';

interface SubscriptionActionsProps {
  subscription: Subscription;
}

export function SubscriptionActions({ subscription }: SubscriptionActionsProps) {
  const queryClient = useQueryClient();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: (immediately: boolean) => subscriptionsService.cancel(subscription.id, immediately),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription cancelled successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to cancel subscription');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => subscriptionsService.reactivate(subscription.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription reactivated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reactivate subscription');
    },
  });

  const suspendMutation = useMutation({
    mutationFn: () => subscriptionsService.suspend(subscription.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription suspended successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to suspend subscription');
    },
  });

  const renewMutation = useMutation({
    mutationFn: () => subscriptionsService.renew(subscription.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription renewed successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to renew subscription');
    },
  });

  const handleCancel = (immediately: boolean) => {
    const message = immediately
      ? 'Are you sure you want to cancel this subscription immediately?'
      : 'Are you sure you want to cancel this subscription at the end of the current period?';

    if (confirm(message)) {
      cancelMutation.mutate(immediately);
    }
  };

  const handleReactivate = () => {
    if (confirm('Are you sure you want to reactivate this subscription?')) {
      reactivateMutation.mutate();
    }
  };

  const handleSuspend = () => {
    if (confirm('Are you sure you want to suspend this subscription?')) {
      suspendMutation.mutate();
    }
  };

  const handleRenew = () => {
    if (confirm('Are you sure you want to renew this subscription?')) {
      renewMutation.mutate();
    }
  };

  const isActive = subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled';
  const isSuspended = subscription.status === 'suspended';
  const isExpired = subscription.status === 'expired';

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
          <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
            Edit
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {isActive && (
            <>
              <DropdownMenuItem onClick={() => handleCancel(false)}>
                Cancel at Period End
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCancel(true)}>
                Cancel Immediately
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSuspend}>
                Suspend
              </DropdownMenuItem>
            </>
          )}

          {(isCancelled || isSuspended) && (
            <DropdownMenuItem onClick={handleReactivate}>
              Reactivate
            </DropdownMenuItem>
          )}

          {isExpired && (
            <DropdownMenuItem onClick={handleRenew}>
              Renew
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SubscriptionFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        subscription={subscription}
        mode="edit"
      />
    </>
  );
}
