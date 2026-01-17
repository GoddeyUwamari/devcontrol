"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@/lib/services/organizations.service";
import { organizationsService } from "@/lib/services/organizations.service";
import { useAuth } from "@/lib/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const generalSettingsSchema = z.object({
  name: z
    .string()
    .min(3, "Organization name must be at least 3 characters")
    .max(100, "Organization name must not exceed 100 characters"),
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

type GeneralSettingsFormData = z.infer<typeof generalSettingsSchema>;

interface GeneralSettingsTabProps {
  organization: Organization;
}

export function GeneralSettingsTab({ organization }: GeneralSettingsTabProps) {
  const { refreshOrganizations } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<GeneralSettingsFormData>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      name: organization.name,
      displayName: organization.displayName || "",
      description: organization.description || "",
    },
  });

  const onSubmit = async (data: GeneralSettingsFormData) => {
    setIsLoading(true);
    try {
      await organizationsService.update(organization.id, {
        name: data.name,
        displayName: data.displayName || undefined,
        description: data.description || undefined,
      });

      // Refresh organizations to get updated data
      await refreshOrganizations();

      toast.success("Settings saved!", {
        description: "Organization settings have been updated successfully.",
      });
    } catch (error: any) {
      console.error("Failed to update organization:", error);
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to update settings";
      toast.error("Update failed", {
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General Settings</CardTitle>
        <CardDescription>
          Update your organization's basic information
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
          {/* Organization Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Organization Name <span className="text-destructive">*</span>
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

          {/* Slug (Read-only) */}
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={organization.slug}
              disabled
              className="bg-muted cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              Slug cannot be changed after organization creation
            </p>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              placeholder="Acme Corp"
              disabled={isLoading}
              {...register("displayName")}
              className={errors.displayName ? "border-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">
              A shorter name for your organization (shown in UI)
            </p>
            {errors.displayName && (
              <p className="text-sm text-destructive">
                {errors.displayName.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What does your organization do?"
              rows={4}
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

          {/* Save Button */}
          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {isDirty
                ? "You have unsaved changes"
                : "No changes to save"}
            </p>
            <Button type="submit" disabled={isLoading || !isDirty}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
