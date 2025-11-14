"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tantml:react-query";
import api from "@/lib/api";
import { AddInvoiceItemPayload, Invoice } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const addItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  itemType: z.enum(["subscription", "usage", "credit", "fee", "discount"]),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number(),
});

type AddItemFormValues = z.infer<typeof addItemSchema>;

interface AddInvoiceItemDialogProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddInvoiceItemDialog({
  invoice,
  open,
  onOpenChange,
}: AddInvoiceItemDialogProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<AddItemFormValues>({
    resolver: zodResolver(addItemSchema),
    defaultValues: {
      itemType: "subscription",
      quantity: 1,
      unitPrice: 0,
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (data: AddInvoiceItemPayload) => {
      const response = await api.post(
        `/api/billing/invoices/${invoice?.id}/items`,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoice?.id] });
      toast.success("Item added successfully");
      form.reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || "Failed to add item";
      toast.error(errorMessage);
    },
  });

  const onSubmit = async (data: AddItemFormValues) => {
    setIsLoading(true);
    try {
      await addItemMutation.mutateAsync(data);
    } finally {
      setIsLoading(false);
    }
  };

  const quantity = form.watch("quantity");
  const unitPrice = form.watch("unitPrice");
  const amount = quantity * unitPrice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Invoice Item</DialogTitle>
          <DialogDescription>
            Add a line item to this invoice. The invoice totals will be
            recalculated automatically.
          </DialogDescription>
        </DialogHeader>

        {invoice && (
          <div className="p-3 bg-muted rounded-lg mb-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Invoice:</span>
              <span className="font-mono">{invoice.invoiceNumber}</span>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the item or service..."
                      className="resize-none"
                      rows={3}
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
              name="itemType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Type *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select item type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="subscription">Subscription</SelectItem>
                      <SelectItem value="usage">Usage</SelectItem>
                      <SelectItem value="fee">Fee</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                      <SelectItem value="discount">Discount</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        placeholder="1"
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
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit Price *</FormLabel>
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
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Line Total:</span>
                <span className="text-lg font-bold">
                  {invoice?.currency || "USD"} {amount.toFixed(2)}
                </span>
              </div>
            </div>

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
                {isLoading ? "Adding..." : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
