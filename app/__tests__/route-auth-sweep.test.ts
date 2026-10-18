/**
 * Every page is either behind AuthGate -- it lives under app/(app), whose
 * layout wraps the whole shell in the gate -- or named below as public.
 *
 * A new page outside app/(app) fails here until it is added to PUBLIC_ROUTES,
 * and a public route must never move under the gate: an invitee, a visitor
 * resetting a password or finishing SSO is signed out by definition.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

const APP_DIR = join(__dirname, "..");

/** Every route reachable signed out, by URL. */
const PUBLIC_ROUTES = [
  // (auth)
  "/accept-invitation",
  "/auth/sso/callback",
  "/forgot-password",
  "/login",
  "/register",
  "/reset-password",
  "/verify-email",
  // (marketing)
  "/",
  "/aws-resources",
  "/blog",
  "/case-studies",
  "/changelog",
  "/community",
  "/contact",
  "/docs",
  "/docs/api",
  "/docs/getting-started",
  "/dora-metrics",
  "/legal/cookies",
  "/legal/privacy",
  "/legal/terms",
  "/platform/costs",
  "/platform/infrastructure",
  "/platform/service-health",
  "/pricing",
  "/solutions/cost-optimization",
  "/solutions/devops",
  "/solutions/enterprise",
  "/solutions/finops",
  "/solutions/mid-market",
  "/solutions/platform-engineering",
  "/solutions/platform-engineers",
  "/solutions/scaleups",
  "/solutions/security",
  "/solutions/startups",
  "/tour",
].sort();

interface Page {
  file: string;
  /** Top-level route group, e.g. "(app)"; null when the page is in none. */
  group: string | null;
  route: string;
}

function pages(): Page[] {
  return (readdirSync(APP_DIR, { recursive: true }) as string[])
    .filter((file) => file.split(sep).pop() === "page.tsx" && !file.split(sep).includes("__tests__"))
    .map((file) => {
      const segments = file.split(sep).slice(0, -1);
      const group = segments[0]?.startsWith("(") ? segments[0] : null;
      const route = "/" + segments.filter((s) => !s.startsWith("(")).join("/");
      return { file, group, route };
    });
}

describe("route auth sweep", () => {
  const all = pages();
  const gated = all.filter((p) => p.group === "(app)");
  const ungated = all.filter((p) => p.group !== "(app)");

  it("finds the pages", () => {
    expect(gated.length).toBeGreaterThan(50);
    expect(gated.map((p) => p.route)).toEqual(expect.arrayContaining(["/dashboard", "/settings/organization"]));
  });

  it("every page outside app/(app) is a named public route, and every named public route exists there", () => {
    expect(ungated.map((p) => p.route).sort()).toEqual(PUBLIC_ROUTES);
  });

  it("public pages live only in (auth) or (marketing), never under the gate", () => {
    for (const page of ungated) {
      expect(["(auth)", "(marketing)"], page.file).toContain(page.group);
    }
    const gatedRoutes = new Set(gated.map((p) => p.route));
    for (const route of PUBLIC_ROUTES) {
      expect(gatedRoutes.has(route), route).toBe(false);
    }
  });

  it("the (auth) and (marketing) layouts have no gate; the (app) layout wraps its shell in it", () => {
    for (const group of ["(auth)", "(marketing)"]) {
      expect(readFileSync(join(APP_DIR, group, "layout.tsx"), "utf8")).not.toMatch(/AuthGate/);
    }
    expect(readFileSync(join(APP_DIR, "layout.tsx"), "utf8")).not.toMatch(/AuthGate/);
    expect(readFileSync(join(APP_DIR, "(app)", "layout.tsx"), "utf8")).toMatch(
      /<AuthGate>\s*<AppShell>\{children\}<\/AppShell>\s*<\/AuthGate>/
    );
  });

  it("the gate is the only guard: no page wraps itself in another", () => {
    for (const page of all) {
      expect(readFileSync(join(APP_DIR, page.file), "utf8"), page.file).not.toMatch(/ProtectedRoute|<AuthGate/);
    }
  });
});
