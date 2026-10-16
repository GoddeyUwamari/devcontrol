"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@/lib/services/organizations.service";
import { organizationsService } from "@/lib/services/organizations.service";
import { useAuth } from "@/lib/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { logError } from "@/lib/safe-log";

interface DangerZoneTabProps {
  organization: Organization;
}

export function DangerZoneTab({ organization }: DangerZoneTabProps) {
  const router = useRouter();
  const { refreshOrganizations, switchOrganization, organizations } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isConfirmValid = confirmText === organization.name;

  const handleDeleteOrganization = async () => {
    if (!isConfirmValid) {
      toast.error("Please type the organization name correctly");
      return;
    }

    setIsDeleting(true);
    try {
      await organizationsService.delete(organization.id);

      toast.success("Organization deleted", {
        description: "The organization and all its data have been permanently deleted.",
      });

      // Refresh organizations list
      await refreshOrganizations();

      // Switch to another organization if available
      const remainingOrgs = organizations.filter((o) => o.id !== organization.id);
      if (remainingOrgs.length > 0) {
        await switchOrganization(remainingOrgs[0].id);
        router.push("/dashboard");
      } else {
        // No organizations left, redirect to create org or dashboard
        router.push("/dashboard");
      }

      setShowDeleteDialog(false);
      setConfirmText("");
    } catch (error: any) {
      logError("Failed to delete organization", error);
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to delete organization";
      toast.error("Delete failed", {
        description: message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible and destructive actions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> Actions in this section are permanent and
              cannot be undone. Please proceed with caution.
            </AlertDescription>
          </Alert>

          {/* Delete Organization Section */}
          <div className="rounded-lg border border-destructive/50 p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-destructive mb-2">
                Delete Organization
              </h3>
              <p className="text-sm text-muted-foreground">
                Once you delete an organization, there is no going back. This will
                permanently delete:
              </p>
              <ul className="mt-2 text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>All services and deployments</li>
                <li>All infrastructure resources</li>
                <li>All team members and invitations</li>
                <li>All settings and integrations</li>
                <li>All historical data and metrics</li>
              </ul>
            </div>

            <div className="pt-4 border-t border-destructive/20">
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
                className="w-full sm:w-auto"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete this organization
              </Button>
            </div>
          </div>

          {/* Additional Info */}
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Note:</strong> You must be the organization owner to delete
              it.
            </p>
            <p>
              If you want to temporarily disable access, consider removing team
              members instead.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete organization permanently?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  This action <strong>cannot be undone</strong>. This will
                  permanently delete the{" "}
                  <strong className="text-foreground">{organization.name}</strong>{" "}
                  organization and all associated data.
                </p>

                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Warning:</strong> All services, deployments,
                    infrastructure resources, and team member access will be
                    permanently lost.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="confirm">
                    Type <strong>{organization.name}</strong> to confirm
                  </Label>
                  <Input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={organization.name}
                    disabled={isDeleting}
                    className={
                      confirmText && !isConfirmValid
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {confirmText && !isConfirmValid && (
                    <p className="text-sm text-destructive">
                      Organization name doesn't match
                    </p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => setConfirmText("")}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrganization}
              disabled={!isConfirmValid || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Organization
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
