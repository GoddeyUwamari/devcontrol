"use client";

import { useEffect } from "react";
import Script from "next/script";
import { GA_TRACKING_ID, initGa, isGaEnabled } from "@/lib/gtag";

/**
 * Google Analytics for the marketing site, the application and the demo
 * entry point. Rendered by those layouts only -- never by the root layout --
 * so it does not load on authentication pages (app/(auth): login, SSO
 * callback, password reset, invitations) or on the not-found page, whose
 * URLs can carry credentials. Once loaded, GA stays loaded across client-side
 * navigation, so every page view it gets is sent by lib/gtag with a redacted
 * URL (initGa here, GaPageViews after navigation), never automatically. Off
 * when NEXT_PUBLIC_GA_ENABLED=false (the local stack); on otherwise.
 */
export function SiteAnalytics() {
  useEffect(() => {
    initGa();
  }, []);

  if (!isGaEnabled()) return null;
  return (
    <Script
      id="_next-ga"
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
    />
  );
}
