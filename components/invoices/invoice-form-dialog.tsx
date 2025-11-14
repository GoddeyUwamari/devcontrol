'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { Trash2, Plus } from 'lucide-react';
import { invoicesService } from '@/lib/services/invoices.service';
import type { CreateInvoicePayload, AddInvoiceItemPayload } from '@/lib/types';

interface InvoiceFormData extends CreateInvoicePayload {
  items: AddInvoiceItemPayload[];
}

interface InvoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceFormDialog({ open, onOpenChange }: InvoiceFormDialogProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<InvoiceFormData>({
    defaultValues: {
      currency: 'USD',
      items: [
        {
          description: '',
          itemType: 'subscription',
          quantity: 1,
          unitPrice: 0,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const createInvoiceMutation = useMutation({
    mutationFn: invoicesService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice created successfully');
      reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create invoice');
    },
  });

  const addItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AddInvoiceItemPayload }) =>
      invoicesService.addItem(id, data),
  });

  const onSubmit = async (data: InvoiceFormData) => {
    setIsSubmitting(true);
    try {
      // Create invoice first
      const invoice = await createInvoiceMutation.mutateAsync({
        tenantId: data.tenantId,
        subscriptionId: data.subscriptionId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        dueDate: data.dueDate,
        issueDate: data.issueDate,
        currency: data.currency,
        notes: data.notes,
      });

      // Add all line items
      if (invoice && data.items.length > 0) {
        for (const item of data.items) {
          if (item.description && item.unitPrice > 0) {
            await addItemMutation.mutateAsync({
              id: invoice.id,
              data: item,
            });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice with items created successfully');
      reset();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="subscriptionId">Subscription ID (Optional)</Label>
                <Input
                  id="subscriptionId"
                  {...register('subscriptionId')}
                  placeholder="Enter subscription ID"
                />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Dates</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="periodStart">Period Start *</Label>
                <Input
                  id="periodStart"
                  type="date"
                  {...register('periodStart', { required: 'Period start is required' })}
                />
                {errors.periodStart && (
                  <p className="text-sm text-red-500">{errors.periodStart.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="periodEnd">Period End *</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  {...register('periodEnd', { required: 'Period end is required' })}
                />
                {errors.periodEnd && (
                  <p className="text-sm text-red-500">{errors.periodEnd.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="issueDate">Issue Date</Label>
                <Input id="issueDate" type="date" {...register('issueDate')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date *</Label>
                <Input
                  id="dueDate"
                  type="date"
                  {...register('dueDate', { required: 'Due date is required' })}
                />
                {errors.dueDate && (
                  <p className="text-sm text-red-500">{errors.dueDate.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Line Items</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    description: '',
                    itemType: 'subscription',
                    quantity: 1,
                    unitPrice: 0,
                  })
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </div>

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Item {index + 1}</span>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor={`items.${index}.description`}>Description *</Label>
                      <Input
                        {...register(`items.${index}.description`, {
                          required: 'Description is required',
                        })}
                        placeholder="Enter item description"
                      />
                      {errors.items?.[index]?.description && (
                        <p className="text-sm text-red-500">
                          {errors.items[index]?.description?.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`items.${index}.itemType`}>Type *</Label>
                      <Select
                        value={watch(`items.${index}.itemType`)}
                        onValueChange={(value) =>
                          setValue(`items.${index}.itemType`, value as any)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="subscription">Subscription</SelectItem>
                          <SelectItem value="usage">Usage</SelectItem>
                          <SelectItem value="credit">Credit</SelectItem>
                          <SelectItem value="fee">Fee</SelectItem>
                          <SelectItem value="discount">Discount</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`items.${index}.quantity`}>Quantity *</Label>
                      <Input
                        type="number"
                        step="1"
                        {...register(`items.${index}.quantity`, {
                          required: 'Quantity is required',
                          valueAsNumber: true,
                          min: { value: 1, message: 'Quantity must be at least 1' },
                        })}
                      />
                    </div>

                    <div className="space-y-2 col-span-2">
                      <Label htmlFor={`items.${index}.unitPrice`}>Unit Price *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        {...register(`items.${index}.unitPrice`, {
                          required: 'Unit price is required',
                          valueAsNumber: true,
                        })}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Additional Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Additional Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" {...register('currency')} defaultValue="USD" />
              </div>

              <div className="space-y-2 col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  {...register('notes')}
                  className="w-full min-h-[80px] px-3 py-2 text-sm border rounded-md"
                  placeholder="Add any notes for this invoice..."
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
