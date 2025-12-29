"use client";

import { useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Loader2 } from "lucide-react";
import { GeneralSettingsTab } from "@/components/settings/general-settings-tab";
import { MembersTab } from "@/components/settings/members-tab";
import { AWSCredentialsTab } from "@/components/settings/aws-credentials-tab";
import { DangerZoneTab } from "@/components/settings/danger-zone-tab";

export default function OrganizationSettingsPage() {
  const { organization, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("general");

  return (
    <ProtectedRoute>
      <div className="container max-w-5xl py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Organization Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your organization's settings, members, and integrations
          </p>
        </div>

        {isLoading || !organization ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="aws">AWS Integration</TabsTrigger>
              <TabsTrigger value="danger">Danger Zone</TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <GeneralSettingsTab organization={organization} />
            </TabsContent>

            <TabsContent value="members">
              <MembersTab organization={organization} />
            </TabsContent>

            <TabsContent value="aws">
              <AWSCredentialsTab organization={organization} />
            </TabsContent>

            <TabsContent value="danger">
              <DangerZoneTab organization={organization} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ProtectedRoute>
  );
}
