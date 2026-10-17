/**
 * NEXT_PUBLIC_GA_ENABLED: unset (every production build) keeps Google
 * Analytics on; only the exact value 'false' -- what `npm run dev:local`
 * sets -- turns it off.
 */
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => <div data-testid="ga-script" data-src={src} />,
}));

import { SiteAnalytics } from "@/components/analytics/site-analytics";
import { GA_TRACKING_ID, isGaEnabled, trackEvent } from "@/lib/gtag";

beforeEach(() => {
  vi.stubGlobal("gtag", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SiteAnalytics GA flag", () => {
  it("loads GA when NEXT_PUBLIC_GA_ENABLED is unset (production default)", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", undefined);
    expect(process.env.NEXT_PUBLIC_GA_ENABLED).toBeUndefined();
    render(<SiteAnalytics />);
    expect(screen.getByTestId("ga-script").getAttribute("data-src")).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`
    );
  });

  it.each(["true", "1", "", "FALSE"])("loads GA when NEXT_PUBLIC_GA_ENABLED=%j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", value);
    render(<SiteAnalytics />);
    expect(screen.getByTestId("ga-script")).toBeTruthy();
  });

  it("renders nothing when NEXT_PUBLIC_GA_ENABLED=false", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ENABLED", "false");
    const { container } = render(<SiteAnalytics />);
    expect(screen.queryByTestId("ga-script")).toBeNull();
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
    expect(gtag).toHaveBeenCalledWith("event", "qualify_lead", {
      page_location: `${window.location.origin}/`,
    });
  });
});
