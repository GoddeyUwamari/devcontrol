"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { organizationsService } from "@/lib/services/organizations.service";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UpgradeModal } from "@/components/billing/upgrade-modal";

const inviteMemberSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  role: z.enum(["admin", "member", "viewer"], {
    required_error: "Please select a role",
  }),
});

type InviteMemberFormData = z.infer<typeof inviteMemberSchema>;

interface InviteMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

export function InviteMemberModal({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: InviteMemberModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeModalData, setUpgradeModalData] = useState<{
    currentTier: string;
    requiredTier: string;
    currentLimit?: number;
    nextLimit?: number;
    message?: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<InviteMemberFormData>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: {
      email: "",
      role: "member",
    },
  });

  const selectedRole = watch("role");

  const onSubmit = async (data: InviteMemberFormData) => {
    setIsLoading(true);
    try {
      await organizationsService.inviteMember(organizationId, {
        email: data.email,
        role: data.role,
      });

      toast.success("Invitation sent!", {
        description: `An invitation email has been sent to ${data.email}`,
      });

      // Reset form and close modal
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Failed to invite member:", error);

      // Check if this is a resource limit error (402 Payment Required)
      if (error?.response?.status === 402 || error?.code === 'RESOURCE_LIMIT_REACHED') {
        const errorData = error?.response?.data;

        // Close the invite modal first
        onOpenChange(false);
        reset();

        // Show upgrade modal instead of toast
        setUpgradeModalData({
          currentTier: errorData?.details?.tier || 'free',
          requiredTier: errorData?.upgrade?.nextTier || 'pro',
          currentLimit: errorData?.upgrade?.currentLimit,
          nextLimit: errorData?.upgrade?.nextLimit,
          message: errorData?.details?.message || errorData?.error,
        });
        setIsUpgradeModalOpen(true);
        return;
      }

      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to send invitation";
      toast.error("Invitation failed", {
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join your organization
            </DialogDescription>
          </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email Input */}
          <div className="space-y-2">
            <Label htmlFor="email">
              Email Address <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="colleague@example.com"
              autoComplete="email"
              disabled={isLoading}
              {...register("email")}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          {/* Role Selector */}
          <div className="space-y-2">
            <Label htmlFor="role">
              Role <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedRole}
              onValueChange={(value) =>
                setValue("role", value as "admin" | "member" | "viewer")
              }
              disabled={isLoading}
            >
              <SelectTrigger
                id="role"
                className={errors.role ? "border-destructive" : ""}
              >
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Can manage members and settings
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="member">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Member</span>
                    <span className="text-xs text-muted-foreground">
                      Can create and manage resources
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="viewer">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Viewer</span>
                    <span className="text-xs text-muted-foreground">
                      Can only view resources (read-only)
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-sm text-destructive">{errors.role.message}</p>
            )}
          </div>

          {/* Info about invitation */}
          <div className="rounded-lg bg-muted p-4">
            <div className="flex gap-3">
              <Mail className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Invitation Email</p>
                <p className="text-xs text-muted-foreground">
                  An email will be sent with a link to join your organization.
                  The invitation will expire in 7 days.
                </p>
              </div>
            </div>
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
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* Upgrade Modal - shown when user limit is reached */}
    {upgradeModalData && (
      <UpgradeModal
        open={isUpgradeModalOpen}
        onOpenChange={setIsUpgradeModalOpen}
        title="You've reached your team member limit"
        description={upgradeModalData.message}
        currentTier={upgradeModalData.currentTier}
        requiredTier={upgradeModalData.requiredTier}
        currentLimit={upgradeModalData.currentLimit}
        nextLimit={upgradeModalData.nextLimit}
        resourceType="team members"
      />
    )}
    </>
  );
}
