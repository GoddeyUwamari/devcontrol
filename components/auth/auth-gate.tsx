"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { loginPathReturningHere } from "@/lib/login-redirect";

/**
 * The signed-in app's only guard (app/(app)/layout.tsx wraps every app route
 * in it). Children render only for a signed-in user; until then -- and on the
 * server, where auth is always still loading -- a neutral loader stands in, so
 * the app shell never renders signed out and nothing in it fetches.
 *
 * A visitor who arrives signed out is replaced to /login, returning to this
 * page (path and query) once signed in. A session that ends while the app is
 * open is navigated by the auth context instead -- logout to /login, expiry to
 * /login?from= -- so the gate only shows the loader then: one navigation.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const wasSignedIn = useRef(false);
  const redirected = useRef(false);

  useEffect(() => {
    if (isAuthenticated) wasSignedIn.current = true;
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading || isAuthenticated || wasSignedIn.current || redirected.current) return;
    redirected.current = true;
    router.replace(loginPathReturningHere());
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) return <AuthLoader />;
  return <>{children}</>;
}

function AuthLoader() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
