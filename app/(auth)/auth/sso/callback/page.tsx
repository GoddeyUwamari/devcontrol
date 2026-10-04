"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { tokenManager } from "@/lib/services/auth.service";
import { takeUrlCredentials } from "@/lib/url-credentials";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/** Parameters the backend's SAML callback hands over (in the URL fragment). */
const SSO_URL_PARAMS = ["token", "refreshToken", "orgId"] as const;

function SSOCallbackContent() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // The URL is cleaned on the first run, so a second run (React Strict Mode)
  // would find nothing there; it must not start the flow again.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // First, before anything else runs: take the tokens and clean the URL.
    // (The legacy query-string form has a removal date; see lib/url-credentials.ts.)
    const { token, refreshToken } = takeUrlCredentials(SSO_URL_PARAMS);

    if (!token || !refreshToken) {
      setError("SSO authentication failed — missing tokens.");
      return;
    }

    try {
      // Store tokens exactly as the standard login flow does
      tokenManager.setAccessToken(token);
      tokenManager.setRefreshToken(refreshToken);
      tokenManager.setAuthCookie(token);

      // Fetch user info then navigate to dashboard
      fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.data) {
            localStorage.setItem("user", JSON.stringify(data.data));
          }
        })
        .catch(() => {
          // Non-fatal — auth context will fetch user on mount
        })
        .finally(() => {
          router.replace("/dashboard");
        });
    } catch {
      setError("Failed to complete SSO sign-in. Please try again.");
    }
  }, [router]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16 }}>
        <p style={{ color: "#EF4444", fontSize: "0.9rem" }}>{error}</p>
        <a href="/login" style={{ color: "#7C3AED", fontSize: "0.85rem", textDecoration: "underline" }}>
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 12 }}>
      <Loader2 style={{ width: 32, height: 32, color: "#7C3AED", animation: "spin 1s linear infinite" }} />
      <p style={{ color: "#6B7280", fontSize: "0.9rem" }}>Completing sign-in&hellip;</p>
    </div>
  );
}

export default function SSOCallbackPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><Loader2 className="animate-spin" /></div>}>
      <SSOCallbackContent />
    </Suspense>
  );
}
