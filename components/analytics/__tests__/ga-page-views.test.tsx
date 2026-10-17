/**
 * With gtag loaded by a marketing or app page, client-side navigation into
 * routes whose URL carries a credential or identifier sends page views and
 * events with the redacted URL only: no call to gtag ever contains the
 * secret. Without gtag loaded, nothing is sent and gtag is not created.
 * Placeholder values only.
 */
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
}));

// The GA script itself never loads in tests.
vi.mock("next/script", () => ({ default: () => null }));

const SECRET = "PLACEHOLDER-secret-value-0123456789";
const DISABLE_FLAG = "ga-disable-G-Q799EVB9BT";

// lib/gtag keeps per-page-load state (initialized, last page view): load a
// fresh copy for each test, like a new page load.
async function load() {
  const { SiteAnalytics } = await import("@/components/analytics/site-analytics");
  const { GaPageViews } = await import("@/components/analytics/ga-page-views");
  const gtagLib = await import("@/lib/gtag");
  return { SiteAnalytics, GaPageViews, gtagLib };
}

function navigate(url: string) {
  window.history.pushState(null, "", url);
}

let gtag: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  gtag = vi.fn();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as any).gtag;
  delete (window as any).dataLayer;
  delete (window as any)[DISABLE_FLAG];
  window.history.replaceState(null, "", "/");
});

const pageViews = () => gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view");

describe("GA with client-side navigation", () => {
  it("initial load: config has automatic page views off, one redacted page view", async () => {
    (window as any).gtag = gtag;
    navigate(`/pricing?utm_source=news&token=${SECRET}#token=${SECRET}`);
    const { SiteAnalytics, GaPageViews } = await load();

    render(
      <>
        <SiteAnalytics />
        <GaPageViews />
      </>
    );

    const config = gtag.mock.calls.find((c) => c[0] === "config");
    expect(config?.[2]).toMatchObject({ send_page_view: false });
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0][2]).toMatchObject({
      page_location: `${window.location.origin}/pricing?utm_source=news`,
    });
    expect(JSON.stringify(gtag.mock.calls)).not.toContain(SECRET);
  });

  it("navigating into credential-bearing routes sends origin + path only", async () => {
    (window as any).gtag = gtag;
    const { SiteAnalytics, GaPageViews, gtagLib } = await load();
    const tree = () => (
      <>
        <SiteAnalytics />
        <GaPageViews />
      </>
    );
    const { rerender } = render(tree());

    const routes = [
      `/accept-invitation?token=${SECRET}`,
      `/reset-password#token=${SECRET}`,
      `/verify-email?token=${SECRET}#token=${SECRET}`,
      `/auth/sso/callback#token=${SECRET}&refreshToken=${SECRET}`,
      `/login?email=user%40example.test&password=${SECRET}&from=%2Fdashboard`,
      `/register?password=${SECRET}&confirmPassword=${SECRET}`,
      `/billing/success?session_id=cs_test_${SECRET}`,
    ];
    for (const route of routes) {
      navigate(route);
      rerender(tree());
      const last = pageViews().at(-1)!;
      expect(last[2].page_location).toBe(window.location.origin + window.location.pathname);
    }
    expect(pageViews()).toHaveLength(1 + routes.length);

    // Events on a redacted page carry the redacted location too.
    gtagLib.trackPurchase(49, "pro", "org-1");
    const purchase = gtag.mock.calls.find((c) => c[0] === "event" && c[1] === "purchase");
    expect(purchase?.[2]).toMatchObject({ page_location: `${window.location.origin}/billing/success` });

    // The referrer of each page view is the previous redacted location.
    expect(pageViews()[2][2].page_referrer).toBe(`${window.location.origin}/accept-invitation`);

    expect(JSON.stringify(gtag.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("cs_test_");
  });

  it("GA not loaded (an auth page opened directly): nothing sent, gtag not created", async () => {
    navigate(`/accept-invitation?token=${SECRET}`);
    const { GaPageViews, gtagLib } = await load();

    render(<GaPageViews />);
    gtagLib.trackEvent("qualify_lead");

    expect((window as any).gtag).toBeUndefined();
    expect((window as any).dataLayer).toBeUndefined();
    expect(DISABLE_FLAG in window).toBe(false);
  });

  it("with no gtag of its own, init queues `arguments` objects on dataLayer, none with the secret", async () => {
    navigate(`/register?password=${SECRET}`);
    const { SiteAnalytics } = await load();

    render(<SiteAnalytics />);

    const queue: unknown[] = (window as any).dataLayer;
    expect(queue.length).toBeGreaterThan(0);
    for (const entry of queue) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
    }
    expect(JSON.stringify(queue.map((a) => Array.from(a as ArrayLike<unknown>)))).not.toContain(SECRET);
  });

  it("the ga-disable flag reads true only while the URL carries a credential", async () => {
    (window as any).gtag = gtag;
    const { SiteAnalytics } = await load();
    render(<SiteAnalytics />);

    expect((window as any)[DISABLE_FLAG]).toBe(false);
    navigate(`/reset-password#token=${SECRET}`);
    expect((window as any)[DISABLE_FLAG]).toBe(true);
    navigate(`/accept-invitation?token=${SECRET}`);
    expect((window as any)[DISABLE_FLAG]).toBe(true);
    navigate("/accept-invitation");
    expect((window as any)[DISABLE_FLAG]).toBe(false);
    // Not a credential: purchase tracking on this page keeps working.
    navigate("/billing/success?session_id=cs_test_1");
    expect((window as any)[DISABLE_FLAG]).toBe(false);
  });

  it("GA off: no init, no page views, even with gtag present", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", "false");
    (window as any).gtag = gtag;
    const { SiteAnalytics, GaPageViews } = await load();

    render(
      <>
        <SiteAnalytics />
        <GaPageViews />
      </>
    );
    navigate("/pricing");

    expect(gtag).not.toHaveBeenCalled();
    expect(DISABLE_FLAG in window).toBe(false);
  });
});
