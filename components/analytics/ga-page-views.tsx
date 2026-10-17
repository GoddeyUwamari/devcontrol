"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sendPageView } from "@/lib/gtag";

/**
 * Sends a redacted page view after each client-side navigation, on every
 * route, auth pages included, but only when GA is already loaded on this
 * page (SiteAnalytics); it never loads GA itself. Mounted in the root layout,
 * so its effect runs after the page's own, by which point a page that takes
 * credentials from its URL has already removed them.
 */
export function GaPageViews() {
  const pathname = usePathname();

  useEffect(() => {
    sendPageView();
  }, [pathname]);

  return null;
}
