"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { authService } from "@/lib/services/auth.service";
import { takeUrlCredentials } from "@/lib/url-credentials";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

type VerificationState =
  | "verifying"
  | "verified"
  // No token in the link at all.
  | "missing"
  // The API rejected the token: unknown, already used, or expired (it does
  // not say which).
  | "rejected"
  // Anything else (network failure, server error): the link may still work.
  | "failed";

function VerifyEmailContent() {
  const [state, setState] = useState<VerificationState>("verifying");
  // The link is cleaned on the first run, so a second run (React Strict Mode)
  // would find no token there; it must not start verification again.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // First, before anything else runs: take the token and clean the URL.
    const { token } = takeUrlCredentials(["token"] as const);
    if (!token) {
      setState("missing");
      return;
    }

    authService
      .verifyEmail(token)
      .then(() => setState("verified"))
      .catch((error: { response?: { status?: number } }) => {
        setState(error?.response?.status === 400 ? "rejected" : "failed");
      });
  }, []);

  if (state === "verifying") {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Verifying your email
          </CardTitle>
          <CardDescription>This only takes a moment</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state === "verified") {
    return (
      <Card className="border-border/40 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Email verified
          </CardTitle>
          <CardDescription>Your email address has been verified</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Continue to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const failure = {
    missing: {
      title: "Invalid verification link",
      description: "This verification link is incomplete",
      detail: "Open the link from your verification email again, making sure the whole link is used.",
    },
    rejected: {
      title: "Link invalid or expired",
      description: "This verification link can't be used",
      detail: "Verification links work once and expire 24 hours after they are sent.",
    },
    failed: {
      title: "Couldn't verify your email",
      description: "Something went wrong while verifying your email",
      detail: "Please try the link from your verification email again in a moment.",
    },
  }[state];

  return (
    <Card className="border-border/40 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">{failure.title}</CardTitle>
        <CardDescription>{failure.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{failure.detail}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><Loader2 className="animate-spin" /></div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
