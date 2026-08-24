"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { organizationsService } from "@/lib/services/organizations.service";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated, isLoading: isAuthLoading, refreshOrganizations } =
    useAuth();

  const token = searchParams.get("token");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { status: "idle" }
    | { status: "success"; alreadyMember: boolean }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const returnTo = token
    ? `/accept-invitation?token=${encodeURIComponent(token)}`
    : "/accept-invitation";

  const handleAccept = async () => {
    if (!token || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await organizationsService.acceptInvitation(token);

      // Best-effort: bring the newly joined organization into context before
      // navigating. Failures here are already toast-reported by the auth
      // context and should not block landing the user on the dashboard.
      await refreshOrganizations();

      setResult({ status: "success", alreadyMember: false });
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (error: any) {
      const message: string =
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to accept invitation";

      if (message === "User is already a member of this organization") {
        setResult({ status: "success", alreadyMember: true });
        setTimeout(() => {
          router.push("/dashboard");
        }, 1500);
        return;
      }

      console.error("Accept invitation error:", error);
      setResult({ status: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // No token in the link at all
  if (!token) {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Invalid invitation link
          </CardTitle>
          <CardDescription>
            The invitation link is missing or invalid
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Link Error</AlertTitle>
            <AlertDescription>
              This invitation link is invalid or has been tampered with.
              Please ask whoever invited you to send a new invitation.
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex flex-col gap-3">
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Auth state still resolving
  if (isAuthLoading) {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  // Must be signed in to accept -- follow the existing app convention
  // (ProtectedRoute's /login?from=) rather than inventing a new mechanism.
  // The token is preserved in the return path so it is not lost across the
  // login/register redirect.
  if (!isAuthenticated || !user) {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Sign in to accept invitation
          </CardTitle>
          <CardDescription>
            You need an account to join this organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href={`/login?from=${encodeURIComponent(returnTo)}`}>
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/register?from=${encodeURIComponent(returnTo)}`}>
                Create an account
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Success
  if (result.status === "success") {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {result.alreadyMember
              ? "You're already a member"
              : "Invitation accepted"}
          </CardTitle>
          <CardDescription>
            {result.alreadyMember
              ? "You already belong to this organization"
              : "You've successfully joined the organization"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Redirecting you to your dashboard...
            </AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link href="/dashboard">Continue to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Error (invalid/expired, wrong-email, etc.) -- message comes directly
  // from the backend, never invented here.
  if (result.status === "error") {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Couldn&apos;t accept invitation
          </CardTitle>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Authenticated, token present, awaiting explicit confirmation --
  // never auto-fires the accept on page load, so a prefetched/scanned
  // link can't silently consume the invitation.
  return (
    <Card className="border-border/40 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">
          Join organization
        </CardTitle>
        <CardDescription>
          You&apos;ve been invited to join an organization on DevControl
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full"
          onClick={handleAccept}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Accepting invitation...
            </>
          ) : (
            "Accept invitation"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
          }}
        >
          <Loader2 className="animate-spin" />
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
