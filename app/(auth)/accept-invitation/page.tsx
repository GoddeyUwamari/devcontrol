"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { organizationsService } from "@/lib/services/organizations.service";
import { Button } from "@/components/marketing-ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/marketing-ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/marketing-ui/alert";
import { logError } from "@/lib/safe-log";
import { takeUrlCredentials } from "@/lib/url-credentials";
import {
  clearPendingInvitation,
  readPendingInvitation,
  savePendingInvitation,
} from "@/lib/pending-invitation";

/**
 * Where a signed-out invitee is sent back to after signing in or registering.
 * The token is not part of it: it waits in the pending invitation instead.
 */
const RETURN_PATH = "/accept-invitation";

/**
 * Whether a failed acceptance means this invitation can never be accepted as
 * it stands (invalid, expired, sent to another address...), so it should be
 * forgotten. Network errors, rate limits and server errors can be retried.
 */
function isTerminalAcceptError(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

function AcceptInvitationContent() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: isAuthLoading, refreshOrganizations } =
    useAuth();

  // The invitation token lives only in this component's state and the pending
  // invitation once it has been taken from the link; it is not kept in the URL.
  const [token, setToken] = useState<string | null>(null);
  // False until the link (or a pending invitation) has been read, so the
  // invalid-link state is not shown before there was a chance to find a token.
  const [linkRead, setLinkRead] = useState(false);
  const tokenTaken = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { status: "idle" }
    | { status: "success"; alreadyMember: boolean }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    // The link is cleaned on the first run, so a second run (React Strict
    // Mode) would find no token there; keep what the first run took.
    if (tokenTaken.current) return;
    tokenTaken.current = true;

    // #token= is the link's form; ?token= is accepted for invitation emails
    // sent before the link moved to the fragment, until they expire.
    const { token: linkToken } = takeUrlCredentials(["token"] as const, {
      legacyQuery: ["token"],
    });
    if (linkToken) {
      // Kept for this tab, so it survives a sign-in, registration or reload.
      savePendingInvitation(linkToken);
      setToken(linkToken);
    } else {
      setToken(readPendingInvitation());
    }
    setLinkRead(true);
  }, []);

  const handleAccept = async () => {
    if (!token || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await organizationsService.acceptInvitation(token);
      clearPendingInvitation();

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
        clearPendingInvitation();
        setResult({ status: "success", alreadyMember: true });
        setTimeout(() => {
          router.push("/dashboard");
        }, 1500);
        return;
      }

      logError("Accept invitation error", error);
      if (isTerminalAcceptError(error)) {
        clearPendingInvitation();
      }
      setResult({ status: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Link not read yet (first render, before the effect)
  if (!linkRead) {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Reading invitation link...</p>
        </CardContent>
      </Card>
    );
  }

  // No token in the link at all, and no pending invitation
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
  // (AuthGate's /login?from=) rather than inventing a new mechanism.
  // The return path carries no token: the pending invitation keeps it across
  // the login/register redirect.
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
              <Link href={`/login?from=${encodeURIComponent(RETURN_PATH)}`}>
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/register?from=${encodeURIComponent(RETURN_PATH)}`}>
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
