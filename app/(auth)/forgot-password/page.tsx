"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from "lucide-react";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormData,
} from "@/lib/validations/auth.schema";
import { authService } from "@/lib/services/auth.service";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { logError } from "@/lib/safe-log";

export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  // Submit stays disabled until hydrated: see useHydrated.
  const hydrated = useHydrated();
  const [isSuccess, setIsSuccess] = useState(false);
  const [emailSent, setEmailSent] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      await authService.forgotPassword({ email: data.email });
      setEmailSent(data.email);
      setIsSuccess(true);
      toast.success("Password reset email sent", {
        description: `Check your inbox at ${data.email}`,
      });
    } catch (error: any) {
      logError("Forgot password error", error);
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to send reset email";
      toast.error("Failed to send email", {
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Check your email
          </CardTitle>
          <CardDescription>
            We&apos;ve sent a password reset link to
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-muted p-4 text-center">
            <p className="font-medium text-foreground">{emailSent}</p>
          </div>

          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              Click the link in the email to reset your password. The link will
              expire in 1 hour.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t receive the email?
            </p>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSuccess(false)}
                className="w-full"
              >
                Try another email
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsLoading(true);
                  authService
                    .forgotPassword({ email: emailSent })
                    .then(() => {
                      toast.success("Email sent again");
                    })
                    .catch(() => {
                      toast.error("Failed to resend email");
                    })
                    .finally(() => {
                      setIsLoading(false);
                    });
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Resend email
              </Button>
            </div>
          </div>

          <div className="pt-4 text-center">
            <Link
              href="/login"
              className="inline-flex items-center text-sm text-primary hover:underline"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40 shadow-xl">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Reset your password
        </CardTitle>
        <CardDescription>
          Enter your email address and we&apos;ll send you a link to reset your
          password
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              autoFocus
              disabled={isLoading}
              {...register("email")}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          {/* Info Alert */}
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              We&apos;ll send a password reset link to this email address if it
              exists in our system.
            </AlertDescription>
          </Alert>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isLoading || !hydrated}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending email...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Send reset link
              </>
            )}
          </Button>

          {/* Back to Login Link */}
          <div className="pt-2 text-center">
            <Link
              href="/login"
              className="inline-flex items-center text-sm text-primary hover:underline"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
