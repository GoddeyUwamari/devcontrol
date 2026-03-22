"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export default function SSOCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refreshToken");
    const orgId = searchParams.get("orgId");

    if (!token || !refreshToken) {
      setError("SSO authentication failed — missing tokens.");
      return;
    }

    try {
      // Store tokens exactly as the standard login flow does
      localStorage.setItem("auth-token", token);
      localStorage.setItem("refresh-token", refreshToken);
      if (orgId) localStorage.setItem("organization-id", orgId);

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
  }, [searchParams, router]);

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
