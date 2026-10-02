"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { organizationsService, type Organization, type OrganizationMember } from "@/lib/services/organizations.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, UserPlus, MoreVertical, Trash2, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { InviteMemberModal } from "@/components/modals/invite-member-modal";
import { toast } from "sonner";

interface MembersTabProps {
  organization: Organization;
}

export function MembersTab({ organization }: MembersTabProps) {
  const { user } = useAuth();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);

  useEffect(() => {
    fetchMembers();
  }, [organization.id]);

  const fetchMembers = async () => {
    setIsLoading(true);
    try {
      const data = await organizationsService.getMembers(organization.id);
      setMembers(data);
    } catch (error) {
      console.error("Failed to fetch members:", error);
      toast.error("Failed to load members");
    } finally {
      setIsLoading(false);
    }
  };

  // member.id is the member's user id -- the id the /members/:userId routes take.
  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await organizationsService.updateMemberRole(
        organization.id,
        memberId,
        newRole as "owner" | "admin" | "member" | "viewer"
      );

      // Update local state
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId ? { ...m, role: newRole as any } : m
        )
      );

      toast.success("Role updated successfully");
    } catch (error: any) {
      console.error("Failed to update role:", error);
      toast.error("Failed to update role", {
        description: error.response?.data?.error || "Please try again",
      });
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;

    try {
      await organizationsService.removeMember(
        organization.id,
        memberToRemove.id
      );

      // Update local state
      setMembers((prev) => prev.filter((m) => m.id !== memberToRemove.id));

      toast.success("Member removed successfully");
      setMemberToRemove(null);
    } catch (error: any) {
      console.error("Failed to remove member:", error);
      toast.error("Failed to remove member", {
        description: error.response?.data?.error || "Please try again",
      });
    }
  };

  // The viewer's own role in this organization. The backend lets an admin
  // grant only member or viewer (organization-authorization canManageRole),
  // so an admin is not offered "Admin".
  const viewerRole = members.find((m) => m.id === user?.id)?.role;
  const canGrantAdmin = viewerRole !== "admin";

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner":
        return "default";
      case "admin":
        return "secondary";
      case "member":
        return "outline";
      case "viewer":
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage who has access to your organization
              </CardDescription>
            </div>
            <Button onClick={() => setShowInviteModal(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No members yet</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setShowInviteModal(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Invite your first member
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isCurrentUser = member.id === user?.id;
                  const isOwner = member.role === "owner";

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                            <AvatarFallback className="text-xs">
                              {member.fullName
                                ? getInitials(member.fullName)
                                : member.email
                                  ? member.email.substring(0, 2).toUpperCase()
                                  : "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {member.fullName || member.email || "Unknown User"}
                              {isCurrentUser && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (You)
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {member.email || "No email"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isOwner || isCurrentUser ? (
                          <Badge variant={getRoleBadgeVariant(member.role)}>
                            {member.role}
                          </Badge>
                        ) : (
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              handleRoleChange(member.id, value)
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Kept when it is the row's current value, so the select still shows it. */}
                              {(canGrantAdmin || member.role === "admin") && <SelectItem value="admin">Admin</SelectItem>}
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isOwner && !isCurrentUser && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Member actions menu">
                                <MoreVertical className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setMemberToRemove(member)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove member
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite Member Modal */}
      <InviteMemberModal
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        organizationId={organization.id}
        onSuccess={fetchMembers}
      />

      {/* Remove Member Confirmation */}
      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium">
                {memberToRemove?.fullName || memberToRemove?.email || "this member"}
              </span>{" "}
              from this organization? They will lose access to all resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
