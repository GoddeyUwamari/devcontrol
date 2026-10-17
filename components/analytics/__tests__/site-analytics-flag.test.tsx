/**
 * NEXT_PUBLIC_GA_ENABLED: unset (every production build) keeps Google
 * Analytics on; only the exact value 'false' -- what `npm run dev:local`
 * sets -- turns it off.
 */
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@next/third-parties/google", () => ({
  GoogleAnalytics: ({ gaId }: { gaId: string }) => <div data-testid="google-analytics" data-ga-id={gaId} />,
}));

import { SiteAnalytics } from "@/components/analytics/site-analytics";
import { GA_TRACKING_ID, isGaEnabled, trackEvent } from "@/lib/gtag";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SiteAnalytics GA flag", () => {
  it("renders GA when NEXT_PUBLIC_GA_ENABLED is unset (production default)", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", undefined);
    expect(process.env.NEXT_PUBLIC_GA_ENABLED).toBeUndefined();
    render(<SiteAnalytics />);
    expect(screen.getByTestId("google-analytics").getAttribute("data-ga-id")).toBe(GA_TRACKING_ID);
  });

  it.each(["true", "1", "", "FALSE"])("renders GA when NEXT_PUBLIC_GA_ENABLED=%j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", value);
    render(<SiteAnalytics />);
    expect(screen.getByTestId("google-analytics")).toBeTruthy();
  });

  it("renders nothing when NEXT_PUBLIC_GA_ENABLED=false", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", "false");
    const { container } = render(<SiteAnalytics />);
    expect(screen.queryByTestId("google-analytics")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("trackEvent sends nothing when GA is off, and still sends when unset", () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);

    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", "false");
    expect(isGaEnabled()).toBe(false);
    trackEvent("qualify_lead");
    expect(gtag).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", undefined);
    expect(isGaEnabled()).toBe(true);
    trackEvent("qualify_lead");
    expect(gtag).toHaveBeenCalledWith("event", "qualify_lead", undefined);
  });
});
