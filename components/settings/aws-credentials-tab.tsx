"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save, CheckCircle, Eye, EyeOff, Key } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@/lib/services/organizations.service";
import { organizationsService } from "@/lib/services/organizations.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

const awsCredentialsSchema = z.object({
  accessKeyId: z
    .string()
    .min(16, "Access Key ID must be at least 16 characters")
    .max(128, "Access Key ID is too long")
    .regex(/^AK[A-Z0-9]+$/, "Invalid AWS Access Key ID format"),
  secretAccessKey: z
    .string()
    .min(20, "Secret Access Key must be at least 20 characters")
    .max(128, "Secret Access Key is too long"),
  region: z.string().min(1, "AWS region is required"),
  accountId: z
    .string()
    .regex(/^\d{12}$/, "AWS Account ID must be exactly 12 digits")
    .optional()
    .or(z.literal("")),
});

type AWSCredentialsFormData = z.infer<typeof awsCredentialsSchema>;

const AWS_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-west-2", label: "Europe (London)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
];

interface AWSCredentialsTabProps {
  organization: Organization;
}

export function AWSCredentialsTab({ organization }: AWSCredentialsTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
  } = useForm<AWSCredentialsFormData>({
    resolver: zodResolver(awsCredentialsSchema),
    defaultValues: {
      accessKeyId: "",
      secretAccessKey: "",
      region: "us-east-1",
      accountId: "",
    },
  });

  const selectedRegion = watch("region");

  useEffect(() => {
    checkCredentials();
  }, [organization.id]);

  const checkCredentials = async () => {
    try {
      const exists = await organizationsService.hasAWSCredentials(organization.id);
      setHasCredentials(exists);
    } catch (error) {
      console.error("Failed to check credentials:", error);
    }
  };

  const onSubmit = async (data: AWSCredentialsFormData) => {
    setIsLoading(true);
    try {
      await organizationsService.saveAWSCredentials(organization.id, {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        region: data.region,
        accountId: data.accountId || undefined,
      });

      setHasCredentials(true);

      toast.success("AWS credentials saved!", {
        description: "Your credentials have been encrypted and stored securely.",
      });
    } catch (error: any) {
      console.error("Failed to save credentials:", error);
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to save credentials";
      toast.error("Save failed", {
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    const accessKeyId = watch("accessKeyId");
    const secretAccessKey = watch("secretAccessKey");
    const region = watch("region");

    if (!accessKeyId || !secretAccessKey || !region) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsTesting(true);
    try {
      const result = await organizationsService.testAWSCredentials({
        accessKeyId,
        secretAccessKey,
        region,
        accountId: watch("accountId") || undefined,
      });

      if (result.success) {
        toast.success("Connection successful!", {
          description: result.message || "AWS credentials are valid",
        });
      } else {
        toast.error("Connection failed", {
          description: result.message || "Invalid AWS credentials",
        });
      }
    } catch (error: any) {
      console.error("Test connection failed:", error);
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to test connection";
      toast.error("Test failed", {
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AWS Integration</CardTitle>
        <CardDescription>
          Connect your AWS account to enable infrastructure management and cost tracking
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
          {/* Status Alert */}
          {hasCredentials && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                AWS credentials are configured. Update the form below to change them.
              </AlertDescription>
            </Alert>
          )}

          {/* Security Notice */}
          <Alert>
            <Key className="h-4 w-4" />
            <AlertDescription>
              Your AWS credentials will be encrypted using AES-256-GCM before storage.
              DevControl never logs or displays your secret access key.
            </AlertDescription>
          </Alert>

          {/* Access Key ID */}
          <div className="space-y-2">
            <Label htmlFor="accessKeyId">
              Access Key ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accessKeyId"
              placeholder="AKIAIOSFODNN7EXAMPLE"
              disabled={isLoading}
              {...register("accessKeyId")}
              className={errors.accessKeyId ? "border-destructive" : ""}
            />
            {errors.accessKeyId && (
              <p className="text-sm text-destructive">
                {errors.accessKeyId.message}
              </p>
            )}
          </div>

          {/* Secret Access Key */}
          <div className="space-y-2">
            <Label htmlFor="secretAccessKey">
              Secret Access Key <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="secretAccessKey"
                type={showSecretKey ? "text" : "password"}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                disabled={isLoading}
                {...register("secretAccessKey")}
                className={
                  errors.secretAccessKey ? "border-destructive pr-10" : "pr-10"
                }
              />
              <button
                type="button"
                onClick={() => setShowSecretKey(!showSecretKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showSecretKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.secretAccessKey && (
              <p className="text-sm text-destructive">
                {errors.secretAccessKey.message}
              </p>
            )}
          </div>

          {/* Region */}
          <div className="space-y-2">
            <Label htmlFor="region">
              AWS Region <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedRegion}
              onValueChange={(value) => setValue("region", value)}
              disabled={isLoading}
            >
              <SelectTrigger
                id="region"
                className={errors.region ? "border-destructive" : ""}
              >
                <SelectValue placeholder="Select a region" />
              </SelectTrigger>
              <SelectContent>
                {AWS_REGIONS.map((region) => (
                  <SelectItem key={region.value} value={region.value}>
                    {region.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.region && (
              <p className="text-sm text-destructive">{errors.region.message}</p>
            )}
          </div>

          {/* Account ID (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="accountId">AWS Account ID (optional)</Label>
            <Input
              id="accountId"
              placeholder="123456789012"
              disabled={isLoading}
              {...register("accountId")}
              className={errors.accountId ? "border-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">
              12-digit AWS account number for additional validation
            </p>
            {errors.accountId && (
              <p className="text-sm text-destructive">
                {errors.accountId.message}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={isLoading || isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>

            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {isDirty ? "You have unsaved changes" : ""}
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
                    Save Credentials
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
