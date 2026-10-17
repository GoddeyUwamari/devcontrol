"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { logError } from "@/lib/safe-log";

/**
 * Validation schema for creating an organization
 */
const createOrgSchema = z.object({
  name: z
    .string()
    .min(3, "Organization name must be at least 3 characters")
    .max(100, "Organization name must not exceed 100 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(50, "Slug must not exceed 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  displayName: z
    .string()
    .max(100, "Display name must not exceed 100 characters")
    .optional()
    .or(z.literal("")),
  description: z
    .string()
    .max(500, "Description must not exceed 500 characters")
    .optional()
    .or(z.literal("")),
});

type CreateOrgFormData = z.infer<typeof createOrgSchema>;

interface CreateOrganizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrganizationModal({
  open,
  onOpenChange,
}: CreateOrganizationModalProps) {
  const { createOrganization } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<CreateOrgFormData>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      name: "",
      slug: "",
      displayName: "",
      description: "",
    },
  });

  const name = watch("name");

  // Auto-generate slug from name
  useEffect(() => {
    if (name && !watch("slug")) {
      const autoSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 50);
      setValue("slug", autoSlug);
    }
  }, [name, setValue, watch]);

  const onSubmit = async (data: CreateOrgFormData) => {
    setIsLoading(true);
    try {
      await createOrganization(
        data.name,
        data.slug || undefined,
        data.displayName || undefined,
        data.description || undefined
      );

      // Reset form and close modal
      reset();
      onOpenChange(false);
    } catch (error) {
      // Error handled by context
      logError("Failed to create organization", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Create a new organization to collaborate with your team.
          </DialogDescription>
        </DialogHeader>

        <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Organization Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Organization name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Acme Corporation"
              disabled={isLoading}
              {...register("name")}
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              placeholder="acme-corporation"
              disabled={isLoading}
              {...register("slug")}
              className={errors.slug ? "border-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">
              URL-friendly identifier (auto-generated from name)
            </p>
            {errors.slug && (
              <p className="text-sm text-destructive">{errors.slug.message}</p>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display name (optional)</Label>
            <Input
              id="displayName"
              placeholder="Acme Corp"
              disabled={isLoading}
              {...register("displayName")}
              className={errors.displayName ? "border-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">
              Shorter name shown in the UI
            </p>
            {errors.displayName && (
              <p className="text-sm text-destructive">
                {errors.displayName.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What does your organization do?"
              rows={3}
              disabled={isLoading}
              {...register("description")}
              className={errors.description ? "border-destructive" : ""}
            />
            {errors.description && (
              <p className="text-sm text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create organization"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
