import { GoogleAnalytics } from "@next/third-parties/google";
import { GA_TRACKING_ID } from "@/lib/gtag";

/**
 * Google Analytics for the marketing site, the application and the demo
 * entry point. Rendered by those layouts only -- never by the root layout --
 * so it does not run on authentication pages (app/(auth): login, SSO
 * callback, password reset, invitations) or on the not-found page, whose
 * URLs can carry credentials.
 */
export function SiteAnalytics() {
  return <GoogleAnalytics gaId={GA_TRACKING_ID} />;
}
