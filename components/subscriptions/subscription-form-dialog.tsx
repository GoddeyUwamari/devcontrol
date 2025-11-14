'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { subscriptionsService } from '@/lib/services/subscriptions.service';
import type { CreateSubscriptionPayload, Subscription } from '@/lib/types';

interface SubscriptionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: Subscription;
  mode: 'create' | 'edit';
}

export function SubscriptionFormDialog({
  open,
  onOpenChange,
  subscription,
  mode,
}: SubscriptionFormDialogProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<CreateSubscriptionPayload>({
    defaultValues: subscription
      ? {
          tenantId: subscription.tenantId,
          planId: subscription.planId,
          billingCycle: subscription.billingCycle,
          currentPrice: subscription.currentPrice,
          currentPeriodEnd: subscription.currentPeriodEnd.split('T')[0],
          currency: subscription.currency || 'USD',
          autoRenew: subscription.autoRenew,
          isTrial: subscription.isTrial,
        }
      : {
          billingCycle: 'monthly',
          currency: 'USD',
          autoRenew: true,
          isTrial: false,
        },
  });

  const billingCycle = watch('billingCycle');
  const isTrial = watch('isTrial');

  const createMutation = useMutation({
    mutationFn: subscriptionsService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription created successfully');
      reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create subscription');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      subscriptionsService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success('Subscription updated successfully');
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update subscription');
    },
  });

  const onSubmit = async (data: CreateSubscriptionPayload) => {
    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await createMutation.mutateAsync(data);
      } else if (subscription) {
        await updateMutation.mutateAsync({
          id: subscription.id,
          data: {
            billingCycle: data.billingCycle,
            currentPrice: data.currentPrice,
            autoRenew: data.autoRenew,
          },
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create New Subscription' : 'Edit Subscription'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {mode === 'create' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="tenantId">Tenant ID *</Label>
                <Input
                  id="tenantId"
                  {...register('tenantId', { required: 'Tenant ID is required' })}
                  placeholder="Enter tenant ID"
                />
                {errors.tenantId && (
                  <p className="text-sm text-red-500">{errors.tenantId.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="planId">Plan ID *</Label>
                <Input
                  id="planId"
                  {...register('planId', { required: 'Plan ID is required' })}
                  placeholder="Enter plan ID"
                />
                {errors.planId && (
                  <p className="text-sm text-red-500">{errors.planId.message}</p>
                )}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="billingCycle">Billing Cycle *</Label>
              <Select
                value={billingCycle}
                onValueChange={(value) => setValue('billingCycle', value as 'monthly' | 'yearly')}
              >
                <SelectTrigger id="billingCycle">
                  <SelectValue placeholder="Select billing cycle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                {...register('currency')}
                placeholder="USD"
                defaultValue="USD"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentPrice">Price *</Label>
            <Input
              id="currentPrice"
              type="number"
              step="0.01"
              {...register('currentPrice', {
                required: 'Price is required',
                valueAsNumber: true,
                min: { value: 0, message: 'Price must be positive' },
              })}
              placeholder="0.00"
            />
            {errors.currentPrice && (
              <p className="text-sm text-red-500">{errors.currentPrice.message}</p>
            )}
          </div>

          {mode === 'create' && (
            <div className="space-y-2">
              <Label htmlFor="currentPeriodEnd">Current Period End *</Label>
              <Input
                id="currentPeriodEnd"
                type="date"
                {...register('currentPeriodEnd', { required: 'End date is required' })}
              />
              {errors.currentPeriodEnd && (
                <p className="text-sm text-red-500">{errors.currentPeriodEnd.message}</p>
              )}
            </div>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="autoRenew"
              {...register('autoRenew')}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="autoRenew" className="font-normal">
              Auto-renew subscription
            </Label>
          </div>

          {mode === 'create' && (
            <>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isTrial"
                  {...register('isTrial')}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="isTrial" className="font-normal">
                  This is a trial subscription
                </Label>
              </div>

              {isTrial && (
                <div className="space-y-2">
                  <Label htmlFor="trialEndsAt">Trial End Date</Label>
                  <Input id="trialEndsAt" type="date" {...register('trialEndsAt')} />
                </div>
              )}
            </>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? mode === 'create'
                  ? 'Creating...'
                  : 'Updating...'
                : mode === 'create'
                  ? 'Create Subscription'
                  : 'Update Subscription'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
