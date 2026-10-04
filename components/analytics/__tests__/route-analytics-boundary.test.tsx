/**
 * Google Analytics must not run on pages whose URLs can carry credentials:
 * everything under app/(auth) (login, SSO callback, password reset,
 * invitations) and the not-found page, which renders inside the root layout
 * only. It is rendered by the marketing, application and /demo layouts.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/analytics/site-analytics", () => ({
  SiteAnalytics: () => <div data-testid="site-analytics" />,
}));
// Catches a layout that renders GA directly instead of through SiteAnalytics.
vi.mock("@next/third-parties/google", () => ({
  GoogleAnalytics: () => <div data-testid="google-analytics-direct" />,
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));
vi.mock("@/app/providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// (marketing) layout chrome
vi.mock("@/components/layout/MarketingNav", () => ({ MarketingNav: () => null }));
vi.mock("@/components/footer", () => ({ Footer: () => null }));

// (app) layout chrome and hooks
vi.mock("@/components/layout/top-nav", () => ({ TopNav: () => null }));
vi.mock("@/components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/ConnectionIndicator", () => ({ ConnectionIndicator: () => null }));
vi.mock("@/components/onboarding/welcome-modal", () => ({ WelcomeModal: () => null }));
vi.mock("@/components/ui/breadcrumb", () => ({ Breadcrumb: () => null }));
vi.mock("@/components/demo/DemoBanner", () => ({ DemoBanner: () => null }));
vi.mock("@/components/ai/AIChatWidget", () => ({ AIChatWidget: () => null }));
vi.mock("@/components/demo/demo-mode-toggle", () => ({ useDemoMode: () => false }));
vi.mock("@/lib/stores/onboarding-store", () => ({
  useOnboardingStore: (select: (s: { fetchStatus: () => void }) => unknown) => select({ fetchStatus: () => {} }),
}));
vi.mock("@/lib/hooks/useBreadcrumbs", () => ({ useBreadcrumbs: () => [] }));
vi.mock("@/lib/hooks/use-plan", () => ({ usePlan: () => ({ isPro: false }) }));
vi.mock("@/lib/demo/sales-demo-data", () => ({ useSalesDemo: () => ({ enabled: false }) }));

import RootLayout from "@/app/layout";
import AuthLayout from "@/app/(auth)/layout";
import MarketingLayout from "@/app/(marketing)/layout";
import AppLayout from "@/app/(app)/layout";
import DemoLayout from "@/app/demo/layout";

const page = <p>page</p>;

function analyticsCount() {
  return (
    screen.queryAllByTestId("site-analytics").length +
    screen.queryAllByTestId("google-analytics-direct").length
  );
}

/** Every element in a tree, without rendering function components. */
function elementTypes(node: React.ReactNode, out: unknown[] = []): unknown[] {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    out.push(child.type);
    elementTypes((child.props as { children?: React.ReactNode }).children, out);
  });
  return out;
}

describe("analytics route boundaries (rendered layouts)", () => {
  it("the root layout -- the only layout above the not-found page -- renders no analytics", async () => {
    const { SiteAnalytics } = await import("@/components/analytics/site-analytics");
    const { GoogleAnalytics } = await import("@next/third-parties/google");
    const types = elementTypes(RootLayout({ children: page }));
    expect(types).not.toContain(SiteAnalytics);
    expect(types).not.toContain(GoogleAnalytics);
  });

  it("the (auth) layout renders no analytics", () => {
    render(<AuthLayout>{page}</AuthLayout>);
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(analyticsCount()).toBe(0);
  });

  it.each([
    ["(marketing)", MarketingLayout],
    ["(app)", AppLayout],
    ["/demo", DemoLayout],
  ])("the %s layout renders analytics exactly once", (_name, Layout) => {
    render(<Layout>{page}</Layout>);
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.getAllByTestId("site-analytics")).toHaveLength(1);
    expect(screen.queryAllByTestId("google-analytics-direct")).toHaveLength(0);
  });
});

describe("analytics route boundaries (source guard)", () => {
  const root = path.resolve(__dirname, "../../..");
  const appDir = path.join(root, "app");

  function filesUnder(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : filesUnder(full);
      return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
    });
  }

  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
  const importsAnalytics = (f: string) =>
    /from\s+["']@next\/third-parties\/google["']|from\s+["']@\/components\/analytics\/site-analytics["']/.test(
      fs.readFileSync(f, "utf8")
    );

  it("only the marketing, application and /demo layouts include analytics", () => {
    const including = filesUnder(appDir).filter(importsAnalytics).map(rel).sort();
    expect(including).toEqual(["app/(app)/layout.tsx", "app/(marketing)/layout.tsx", "app/demo/layout.tsx"]);
  });

  it("nothing under app/(auth), and no root-level layout/not-found/error file, includes analytics", () => {
    const authFiles = filesUnder(path.join(appDir, "(auth)"));
    expect(authFiles.length).toBeGreaterThan(0);
    const rootLevel = ["layout", "not-found", "error", "global-error", "template"]
      .flatMap((name) => [".tsx", ".ts", ".jsx", ".js"].map((ext) => path.join(appDir, name + ext)))
      .filter((f) => fs.existsSync(f));
    expect(rootLevel.map(rel)).toContain("app/layout.tsx");
    expect([...authFiles, ...rootLevel].filter(importsAnalytics).map(rel)).toEqual([]);
  });

  it("GoogleAnalytics itself is used only by SiteAnalytics", () => {
    const sources = ["app", "components", "lib"].flatMap((d) => filesUnder(path.join(root, d)));
    const direct = sources
      .filter((f) => /from\s+["']@next\/third-parties\/google["']/.test(fs.readFileSync(f, "utf8")))
      .map(rel);
    expect(direct).toEqual(["components/analytics/site-analytics.tsx"]);
  });
});
